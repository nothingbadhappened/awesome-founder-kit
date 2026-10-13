#!/usr/bin/env node
// founder-kit hook dispatcher: one process per event. Inert unless the project has a .fk/ folder.
// Never blocks Stop, SubagentStop or UserPromptSubmit; never manages tasks; never touches .omc/.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findRoot, loadConfig, log, activeOverride, addOverride, takeSnapshot, refreshSnapshot, relPath, sanctionedJson, writeJson,
  protectedClass, shellTool, GUARDS, FAIL_CLOSED, omcLatestCached, omcPlugin, omcStatus, readOmcCache, writeOmcCache, OMC_UPDATE } from './lib.mjs';

const FK_CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'fk.mjs');

// Guards load only when the project has opted in, so the inert path stays tiny.
let pointer, gate, PRE_GUARDS;
async function loadGuards() {
  const [p, git, secret, g, install, cloud] = await Promise.all(['pointer', 'git', 'secret', 'gate', 'install', 'cloud']
    .map((n) => import(`./guards/${n}.mjs`)));
  pointer = p.pointer; gate = g; PRE_GUARDS = [git, secret, g, install, cloud];
}
const out = (obj) => { if (obj) process.stdout.write(JSON.stringify(obj)); };
const context = (event, text) => ({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });

function preToolUse(ctx) {
  const { root, input, tool } = ctx;
  let ask = null;
  for (const g of PRE_GUARDS) {
    let r;
    try { r = g.check(ctx); } catch (e) {
      log(root, { event: 'PreToolUse', guard: g.name, decision: FAIL_CLOSED.has(g.name) ? 'deny' : 'allow', tool, agent_type: input.agent_type, error: String(e?.message || e) });
      if (FAIL_CLOSED.has(g.name)) return deny(`fk ${g.name}: guard error, see \`fk doctor\`.`);
      continue;
    }
    if (!r) continue;
    const entry = { event: 'PreToolUse', guard: g.name, decision: r.decision, tool, agent_type: input.agent_type, reason: r.reason };
    if ((r.decision === 'deny' || r.decision === 'ask') && !r.noOverride) {
      const o = activeOverride(root, g.name);
      if (o) { log(root, { ...entry, decision: 'allow-override', override: o.reason }); continue; }
    }
    log(root, entry);
    if (r.decision === 'deny') return deny(r.reason);
    if (r.decision === 'ask') ask ??= r.reason;
  }
  return ask ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: ask } } : null;
}
const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

function postToolUse({ root, input, tool, ti }) {
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const rel = relPath(root, ti.file_path || ti.notebook_path || '');
    if (protectedClass(root, rel)) refreshSnapshot(root, [rel]); // sanctioned by PreToolUse
    return null;
  }
  if (!shellTool(tool) && !tool.startsWith('mcp__')) return null;
  const r = gate.tamper(root, !!activeOverride(root, 'gate-guard'));
  if (!r) return null;
  log(root, { event: 'PostToolUse', guard: 'gate-guard', decision: r.decision === 'block' ? 'tamper' : r.decision, tool, agent_type: input.agent_type, changed: r.changed });
  return r.decision === 'block' ? { decision: 'block', reason: r.reason } : null;
}

// Founder-typed lines (UserPromptSubmit is the human). Never blocks; a line it cannot read just gets a note.
// A directive counts only when it is the whole message (at most 3 lines, every line a directive): pasted text
// that merely contains one (a log, a doc, an agent's output) never approves anything.
const TOOL_SPEC = /^(?:mcp:|plugin:)\S+$|^@?[^@\s]+@v?\d+(?:\.\d+)*(?:[-+][\w.]+)?$/i;
const DIRECTIVE = /^fk-(?:approve|override)\b/i;
const PASTED = 'fk: an fk-approve/fk-override line inside pasted text was ignored. Type it alone as your whole message to approve.';

function directive(root, line, notes) {
  const m = /^fk-override[ \t]+(\S+)[ \t]+(\S.*)$/i.exec(line);
  if (m) {
    let guard = m[1].toLowerCase();
    if (!guard.endsWith('-guard')) guard += '-guard';
    if (!GUARDS.includes(guard)) return notes.push(`fk: unknown guard "${m[1]}". Known: ${GUARDS.join(', ')}. No override recorded.`);
    const o = addOverride(root, guard, m[2].trim());
    log(root, { event: 'UserPromptSubmit', guard, decision: 'override-set', reason: o.reason, expires: o.expires });
    return notes.push(`fk: founder approved an override of ${guard} until ${o.expires} (reason: ${o.reason}). It is logged in .fk/compliance.jsonl.`);
  }
  const t = /^fk-approve[ \t]+tool[ \t]+(\S+)[ \t]+(\S.*)$/i.exec(line);
  if (t) {
    const enforce = t[1].toLowerCase() === 'enforce';
    const spec = t[1].toLowerCase().replace(/==/, '@');
    if (!enforce && !TOOL_SPEC.test(spec)) return notes.push(`fk: "${t[1]}" is not name@exact-version, mcp:<name> or plugin:<id>. Nothing approved.`);
    const file = path.join(root, '.fk', 'toolchain.json');
    const tc = sanctionedJson(root, '.fk/toolchain.json', { approved: [], enforce: true });
    if (enforce) tc.enforce = true; else tc.approved = [...new Set([...(tc.approved || []), spec])];
    writeJson(file, tc);
    refreshSnapshot(root, ['.fk/toolchain.json']);
    log(root, { event: 'UserPromptSubmit', guard: 'install-guard', decision: enforce ? 'enforce-tools' : 'approve-tool', reason: `${enforce ? 'enforce' : spec}: ${t[2].trim()}` });
    return notes.push(enforce ? 'fk: founder switched the install guard to enforce: installs outside .fk/toolchain.json are now blocked.'
      : `fk: founder approved ${spec} for the toolchain (.fk/toolchain.json); unapproved installs are now blocked.`);
  }
  const b = /^fk-approve[ \t]+budget[ \t]+(\S+)[ \t]+\$?(\d+(?:\.\d+)?)(?:[ \t]+(hard-cap))?[ \t]*$/i.exec(line);
  if (b) {
    const file = path.join(root, '.fk', 'budgets.json');
    const bj = sanctionedJson(root, '.fk/budgets.json', {});
    const provider = b[1].toLowerCase();
    bj.providers = { ...(bj.providers || {}), [provider]: { monthly_usd: Number(b[2]), hard_cap: !!b[3], approved: new Date().toISOString().slice(0, 10) } };
    writeJson(file, bj);
    refreshSnapshot(root, ['.fk/budgets.json']);
    log(root, { event: 'UserPromptSubmit', guard: 'cloud-guard', decision: 'approve-budget', reason: `${provider} $${b[2]}/month${b[3] ? ' hard cap' : ''}` });
    return notes.push(`fk: founder recorded a ${provider} budget of $${b[2]}/month${b[3] ? ' with a hard cap' : ' (alert only)'} in .fk/budgets.json.`);
  }
  if (/^fk-approve[ \t]+budget\b/i.test(line)) return notes.push('fk: budget line not understood. Format: fk-approve budget <provider> <usd/month> [hard-cap]. Nothing recorded.');
  return notes.push(`fk: "${line.slice(0, 60)}" not understood. Formats: fk-override <guard> <reason> | fk-approve tool <name@version|enforce> <reason> | fk-approve budget <provider> <usd/month> [hard-cap]. Nothing recorded.`);
}

function userPromptSubmit({ root, input }) {
  const lines = String(input.prompt || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.some((l) => DIRECTIVE.test(l))) return null;
  if (lines.length > 3 || !lines.every((l) => DIRECTIVE.test(l))) {
    log(root, { event: 'UserPromptSubmit', guard: 'dispatch', decision: 'directive-ignored' });
    return { systemMessage: PASTED, ...context('UserPromptSubmit', `${PASTED} Nothing was approved or overridden; do not act as if it were.`) };
  }
  const notes = [];
  for (const l of lines) directive(root, l, notes);
  return { systemMessage: notes.join('\n'), ...context('UserPromptSubmit', notes.join('\n')) };
}

// At most once a day: tell the agent an OMC update exists. Reads the cache only; a stale cache refreshes in the background.
function omcNotice() {
  const { latest, stale } = omcLatestCached();
  if (stale) { try { spawn(process.execPath, [FK_CLI, 'omc-refresh'], { detached: true, stdio: 'ignore' }).unref(); } catch { /* best effort */ } }
  const st = omcStatus(omcPlugin()?.version, latest);
  if (!st || st.level === 'green' || Date.now() - (readOmcCache().notified || 0) < 24 * 60 * 60 * 1000) return null;
  writeOmcCache({ notified: Date.now() });
  const below = st.level === 'red' ? `, below the supported floor ${st.floor}` : '';
  return `fk: oh-my-claudecode ${st.installed} is installed${below}; ${st.latest} is out. Ask the founder in plain words (AskUserQuestion) whether to update now (${OMC_UPDATE.plugin}, then restart). Never update without a yes.`;
}

async function main() {
  const event = process.argv[2];
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { /* no stdin */ }
  let input = {};
  try { input = raw ? JSON.parse(raw) : {}; } catch { input = null; }
  const found = findRoot(input?.cwd || process.cwd());
  if (!found) return;
  const { root, gitDir } = found;
  if (!input) {
    log(root, { event, guard: 'dispatch', decision: event === 'PreToolUse' ? 'deny' : 'allow', error: 'unreadable hook input' });
    if (event === 'PreToolUse') out(deny('fk: guard error (unreadable hook input), see `fk doctor`.'));
    return;
  }
  const ctx = { root, gitDir, input, tool: String(input.tool_name || ''), ti: input.tool_input || {} };
  try {
    await loadGuards();
    switch (event) {
      case 'PreToolUse': return out(preToolUse(ctx));
      case 'PostToolUse': return out(postToolUse(ctx));
      case 'UserPromptSubmit': return out(userPromptSubmit(ctx));
      case 'SubagentStart': {
        const text = pointer(loadConfig(root), input.agent_type);
        log(root, { event, guard: 'pointer', decision: 'inject', agent_type: input.agent_type });
        return out(context(event, text));
      }
      case 'SessionStart':
        if (input.source === 'startup' || input.source === 'clear') {
          takeSnapshot(root);
          const note = omcNotice();
          return note ? out(context(event, note)) : undefined;
        }
        if (input.source === 'compact' || input.source === 'resume') {
          log(root, { event, guard: 'pointer', decision: 'inject', agent_type: input.agent_type, source: input.source });
          return out(context(event, pointer(loadConfig(root), input.agent_type)));
        }
        return;
      default: return; // Stop, SubagentStop and anything else: never act
    }
  } catch (e) {
    log(root, { event, guard: 'dispatch', decision: event === 'PreToolUse' ? 'deny' : 'allow', tool: ctx.tool, error: String(e?.message || e) });
    if (event === 'PreToolUse') out(deny('fk: guard error, see `fk doctor`.'));
  }
}

main();
