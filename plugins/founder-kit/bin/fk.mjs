#!/usr/bin/env node
// fk: founder-kit project CLI. init | doctor [--hooks] | audit | config set | kickoff protect|release | uninstall [--system]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readJson, writeJson, takeSnapshot, refreshSnapshot, readSnapshot, listProtected, log, DEFAULT_CONFIG, RUNTIME,
  stateDir, readLog, readOverrides, omcPlugin, omcStatus, fetchOmcLatest, cmpVer, OMC_UPDATE, hooksPathStatus, CHAIN_MARK, fromKit, fkHome, loadConfig } from '../hooks/lib.mjs';
import { GATE_KEYS, softening, takeApproval, norm } from '../hooks/directives/gates.mjs';
import { claudeAncestor } from './cmd/steward/proc.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = path.join(KIT, 'templates', 'project');

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32', ...opts });
const say = (s = '') => process.stdout.write(s + '\n');

function repoRoot(cwd = process.cwd()) {
  const r = run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, shell: false });
  if (r.status !== 0) return null;
  return path.dirname(path.resolve(r.stdout.trim()));
}
function needRoot() {
  const root = repoRoot();
  if (!root) { say('fk: this folder is not inside a git repository. Run `git init` first.'); process.exit(1); }
  return root;
}

// core.hooksPath: set to .githooks when unset; never overwrite another one (husky, a global hooks dir). With --chain,
// the kit's pre-commit call goes into that dir's pre-commit (right after the shebang) unless it is already there.
function hooksPath(root, chain) {
  const hp = run('git', ['config', '--get', 'core.hooksPath'], { cwd: root, shell: false }).stdout.trim();
  if (!hp || path.resolve(root, hp) === path.resolve(root, '.githooks')) {
    if (!hp) run('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root, shell: false });
    return say(`${hp ? 'kept   ' : 'set    '} git core.hooksPath = .githooks`);
  }
  const file = path.join(path.resolve(root, hp), 'pre-commit');
  let text = null;
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* none yet */ }
  if (text?.includes(CHAIN_MARK)) return say(`kept    ${hp}/pre-commit (already runs the kit's pre-commit checks)`);
  if (!chain) {
    say(`kept    git core.hooksPath = ${hp} (this repo's own git hooks; fk does not replace them)`);
    return say(`fk: the kit's pre-commit checks are not wired in yet. To add them to ${hp}/pre-commit, run: fk init --chain`);
  }
  const call = `# ${CHAIN_MARK}\nsh "$(git rev-parse --show-toplevel)/.githooks/pre-commit" || exit 1\n`;
  const lines = (text ?? '#!/bin/sh\n').split('\n');
  const at = lines[0].startsWith('#!') ? 1 : 0;
  lines.splice(at, 0, call.trimEnd());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n'));
  fs.chmodSync(file, 0o755);
  say(`chained ${hp}/pre-commit -> .githooks/pre-commit`);
}

async function init(chain = false) {
  const root = needRoot();
  const fk = path.join(root, '.fk');
  const seed = {
    'config.json': { runner: DEFAULT_CONFIG.runner, check: null, stack: null, fast_gates: null, paths: DEFAULT_CONFIG.paths, protected_extra: [] },
    'toolchain.json': { approved: [] },
    'budgets.json': { providers: {} },
  };
  for (const [f, v] of Object.entries(seed)) {
    const p = path.join(fk, f);
    if (fs.existsSync(p)) say(`kept    .fk/${f}`); else { writeJson(p, v); say(`created .fk/${f}`); }
  }
  fs.writeFileSync(path.join(fk, '.gitignore'), RUNTIME.join('\n') + '\n');
  const hooksSrc = path.join(TEMPLATE, '.githooks');
  // Adopting a repo with work in progress: the founder's index is left alone (no git update-index), only a hint.
  const st = run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, shell: false });
  const dirty = st.status === 0 && st.stdout.trim() !== '';
  for (const f of fs.readdirSync(hooksSrc)) {
    const dst = path.join(root, '.githooks', f);
    if (fs.existsSync(dst)) { say(`kept    .githooks/${f} (already present)`); continue; }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(hooksSrc, f), dst);
    fs.chmodSync(dst, 0o755);
    say(`created .githooks/${f}`);
    if (dirty) say(`fk: uncommitted changes, so .githooks/${f} was not staged. When you commit it, run: git add --chmod=+x .githooks/${f}`);
    else run('git', ['update-index', '--add', '--chmod=+x', `.githooks/${f}`], { cwd: root, shell: false }); // exec bit on Windows too
  }
  hooksPath(root, chain);
  // Claude Code's own rules keep agents away from the kit folder in the home directory (fully only with its sandbox).
  const { addGuardSettings } = await import('./cmd/setup/sandbox.mjs');
  const g = addGuardSettings(root);
  if (g === null) say('fk: .claude/settings.json is not valid JSON, so the deny rules for ~/.fk were not added. Fix it, then run fk init again.');
  else say(`${g ? 'added  ' : 'kept   '} .claude/settings.json deny rules for ~/.fk (fk doctor shows the guard strength)`);
  takeSnapshot(root);
  // The kit state records this project's folder (fk uninstall --system lists the projects still set up).
  (await import('./cmd/update/migrations.mjs')).migrateDir(stateDir(root), root);
  say('fk: ready. Guards are active for this project. Set the pre-commit gates with: fk config set fast_gates "<command>"');
}

const OMC_INSTALL = '/plugin marketplace add Yeachan-Heo/oh-my-claudecode, /plugin install oh-my-claudecode@omc';

async function omcRows(add) {
  const plugin = omcPlugin();
  const npm = plugin ? null : run('omc', ['--version']);
  const npmVer = npm?.status === 0 ? (/\d+\.\d+\.\d+/.exec(npm.stdout) || ['?'])[0] : null;
  if (!plugin && !npmVer) return add('oh-my-claudecode', false, `not found: the kit relies on OMC for the workflow (run: ${OMC_INSTALL})`);
  if (!plugin) add('OMC install mode', 'yellow', 'npm install: supported; plugin mode optional. Do not add the plugin copy on top: OMC hooks would fire twice until `omc setup` removes the npm copies from settings.json');
  const be = process.env.OMC_BUDGET_ENFORCE;
  add('OMC token budget', be === 'active' || 'yellow', be === 'active' ? 'OMC_BUDGET_ENFORCE=active: OMC warns at 90% of the budget and stops at 100%'
    : `OMC_BUDGET_ENFORCE is ${be || 'not set (shadow)'}: OMC only logs overruns. For unattended runs set OMC_BUDGET_ENFORCE=active; headless runs (claude -p) can also cap spend with --max-budget-usd <usd>`);
  const mode = plugin ? 'plugin' : 'npm';
  const installed = plugin?.version || npmVer;
  const st = omcStatus(installed, await fetchOmcLatest());
  if (!st) return add('oh-my-claudecode', true, `${installed} (${mode}); latest unknown (offline)`);
  if (st.level === 'green') return add('oh-my-claudecode', true, `${installed} (${mode}), the latest`);
  const below = st.level === 'red' ? `, below the supported floor ${st.floor}` : '';
  add('oh-my-claudecode', st.level, `${installed} (${mode})${below}; ${st.latest} is out. Update when you are ready: ${OMC_UPDATE[mode]}`);
}

async function doctor(withHooks) {
  const rows = [];
  const add = (item, level, note) => rows.push([level === true ? 'green' : level === false ? 'red' : level, item, note]);
  const major = Number(process.versions.node.split('.')[0]);
  add('node >= 20', major >= 20, process.version);
  const t0 = Date.now();
  const probe = spawnSync(process.execPath, [path.join(KIT, 'hooks', 'dispatch.mjs'), 'SessionStart'], { input: '{"source":"resume","cwd":"' + os.tmpdir().replace(/\\/g, '\\\\') + '"}', encoding: 'utf8' });
  add('hook runtime', probe.status === 0, probe.status === 0 ? `dispatcher runs (${Date.now() - t0} ms incl. node start)` : 'dispatcher failed: guards are OFF. ' + (probe.stderr || '').split('\n')[0]);
  const ss = run('skillspector', ['--version']);
  add('SkillSpector', ss.status === 0, ss.status === 0 ? ss.stdout.trim() : 'not found (needed from 0.4 for install scans)');
  const gl = run('gitleaks', ['version']);
  const glv = /\d+\.\d+\.\d+/.exec(gl.stdout || '')?.[0];
  const glOk = !!glv && cmpVer(glv, '8.19.0') >= 0; // the pre-commit hook uses `gitleaks git` (8.19+)
  if (gl.status === 0) add('gitleaks >= 8.19', glOk, glOk ? glv : `${glv || gl.stdout.trim()}: too old for \`gitleaks git\` in the pre-commit hook. Update gitleaks.`);
  else add('gitleaks', 'yellow', 'not found: commits are not scanned for secrets. Install a pinned version: winget install Gitleaks.Gitleaks, brew install gitleaks, or a release binary from github.com/gitleaks/gitleaks/releases');
  await omcRows(add);
  const { doctorRows } = await import('./cmd/setup/core.mjs');
  for (const [level, item, note] of doctorRows()) add(item, level, note);
  const root = repoRoot();
  const hasFk = !!(root && fs.existsSync(path.join(root, '.fk')));
  add('project .fk/', hasFk || 'yellow', hasFk ? root : `${root ? 'absent' : 'not in a git repo'} (expected before fk init)`);
  if (hasFk) add('kit state', true, `${stateDir(root)} (snapshots, overrides, log; outside the repo)`);
  const gs = (await import('./cmd/setup/sandbox.mjs')).guardStrength(hasFk ? root : null);
  add('guard strength', gs.level === 'green' || gs.level, gs.note);
  const hs = hasFk && hooksPathStatus(root);
  if (hs) add('pre-commit checks', hs.on || 'yellow', hs.on ? `on (core.hooksPath = ${hs.hp})`
    : hs.hp ? `off in this clone: git uses hooks from ${hs.hp}. Run fk init --chain to add the kit's pre-commit call there`
      : 'off in this clone (core.hooksPath is not .githooks); run fk init to restore');
  if (withHooks) {
    const { runSuite } = await import('../hooks/selftest.mjs');
    for (const r of runSuite()) add(r.name.startsWith('clean: ') ? r.name : `planted: ${r.name}`, r.ok, `expected ${r.expected}, got ${r.got}`);
  }
  print(rows);
}

const LABEL = { green: '\x1b[32mgreen \x1b[0m', yellow: '\x1b[33myellow\x1b[0m', red: '\x1b[31mred   \x1b[0m' };
function print(rows) {
  const w = Math.max(...rows.map((r) => r[1].length));
  for (const [s, item, note] of rows) say(`${LABEL[s]}  ${item.padEnd(w)}  ${note}`);
  if (rows.some((r) => r[0] === 'red')) process.exitCode = 1;
}

// Overrides and approvals the kit holds, each matched to the founder-typed line (UserPromptSubmit) that recorded it.
// Only lines the installed plugin wrote count as typed (fromKit, hooks/lib.mjs): runtime: plugin and a plugin_root that is
// this kit or an installed founder-kit version. A copied or command-started dispatcher has no marker, or another folder.
function untyped(root, rows) {
  rows = rows.filter(fromKit);
  const typed = (decision, prefix, session) => rows.some((r) => r.event === 'UserPromptSubmit' && r.decision === decision
    && String(r.reason ?? '').startsWith(prefix) && (!session || r.session === session));
  const out = [];
  for (const o of readOverrides(root)) {
    if (!rows.some((r) => r.decision === 'override-set' && r.event === 'UserPromptSubmit' && r.guard === o.guard && r.expires === o.expires && r.session === o.session)) out.push(`override of ${o.guard} (${o.reason})`);
  }
  const tc = readJson(path.join(root, '.fk', 'toolchain.json'), {});
  const byProposal = new Set((tc.entries || []).filter((e) => typed('approve-proposal', `${e.proposal}:`)).flatMap((e) => e.specs || []));
  for (const spec of tc.approved || []) if (!byProposal.has(spec) && !typed('approve-tool', `${spec}:`, tc.approvals?.[spec]?.session)) out.push(`tool ${spec}`);
  if (tc.enforce && !typed('enforce-tools', 'enforce:', tc.approvals?.enforce?.session)) out.push('install-guard enforce');
  const providers = readJson(path.join(root, '.fk', 'budgets.json'), {}).providers || {};
  for (const [p, b] of Object.entries(providers)) if (!typed('approve-budget', `${p} $`, b?.session)) out.push(`budget ${p}`);
  return out;
}

// Task records (fk task): closed on an override, risk declared below what the change shows, reviews written by
// implementers, and open tasks whose id already appears in a commit on main/master.
async function auditTasks(root) {
  const { readTasks } = await import('../hooks/authorship.mjs');
  const tasks = Object.entries(readTasks(root).tasks || {});
  if (!tasks.length) return;
  const R = ['R0', 'R1', 'R2', 'R3'];
  const closed = tasks.filter(([, t]) => t.done);
  const lines = [];
  for (const [id, t] of closed) if (t.override) lines.push(`${id} was closed without a passing fk task check, on your override (${t.override.reason}).`);
  for (const [id, t] of closed) {
    const c = t.last_check;
    if (c && R.indexOf(c.proposed) > R.indexOf(c.declared)) lines.push(`${id} was declared ${c.declared}, but the change looked like ${c.proposed}.`);
    for (const i of (c?.invalid || []).filter((x) => /also wrote code|not a reviewer agent/.test(x))) lines.push(`${id}: a review was written by an implementer: ${i}.`);
  }
  const main = ['main', 'master'].find((b) => run('git', ['rev-parse', '--verify', '-q', b], { cwd: root, shell: false }).status === 0);
  const subjects = main ? run('git', ['log', '-n', '1000', '--format=%s', main], { cwd: root, shell: false }).stdout : '';
  for (const [id] of tasks.filter(([, t]) => !t.done)) if (new RegExp(`\\b${id}\\b`).test(subjects)) lines.push(`${id} is in a commit on ${main} but was never closed with fk task done.`);
  for (const c of (await import('./cmd/task.mjs')).changedAfterClose(root)) {
    const files = `${c.files.slice(0, 5).join(', ')}${c.files.length > 5 ? ` and ${c.files.length - 5} more` : ''}`;
    lines.push(c.main ? `${c.id} was closed ${c.done.slice(0, 10)}, but ${c.main} has ${files} different from what was reviewed (merged as something else, outside any task).`
      : `${c.id} was closed ${c.done.slice(0, 10)}, but ${files} changed afterwards outside any task (no review saw it).`);
  }
  say(`fk audit: ${tasks.length} tasks (${closed.length} closed).${lines.length ? '' : ' Every closed task passed fk task check.'}`);
  for (const l of lines) say(`- ${l}`);
}

// Gate-command changes (fk config set check|fast_gates|runner), and a check or fast_gates that differs from the last
// logged value: edited outside fk config set. Such an edit that is not a pure extension is flagged.
const HOW = { 'first-set': 'first set', extension: 'only added steps', approved: 'founder-approved' };
function auditGates(root, rows) {
  const all = rows.filter((r) => r.decision === 'gate-change');
  const lines = [];
  for (const r of all.filter((x) => x.how !== 'unchanged')) {
    const typed = r.how !== 'approved' || rows.some((t) => t.event === 'UserPromptSubmit' && t.decision === 'approve-gates' && fromKit(t)
      && t.session === r.approval?.session && String(t.reason ?? '').startsWith(`${r.key}: ${norm(r.to)} (`));
    lines.push(`${r.ts.slice(0, 16).replace('T', ' ')}  ${r.key}: "${r.from ?? ''}" -> "${r.to}" (${HOW[r.how] || r.how})${typed ? '' : ' NOT typed by you: review it'}`);
  }
  const cfg = readJson(path.join(root, '.fk', 'config.json'), {});
  for (const key of ['check', 'fast_gates']) {
    const last = all.filter((r) => r.key === key).at(-1);
    if (!last || norm(last.to) === norm(cfg[key])) continue;
    const why = cfg[key] ? softening(last.to, cfg[key]) : 'it was removed';
    lines.push(`${key} was changed outside fk config set: "${last.to}" -> "${cfg[key] ?? ''}"${why ? `, NOT approved and not just added steps (${why}). Restore it (git checkout -- .fk/config.json)` : ' (only added steps)'}.`);
  }
  if (!lines.length) return;
  say('fk audit: gate command changes:');
  for (const l of lines) say(`- ${l}`);
}

async function audit() {
  const root = needRoot();
  const rows = readLog(root);
  const forged = untyped(root, rows);
  if (forged.length) say(`fk audit: NOT typed by you, review: ${forged.join('; ')}. Remove what you did not approve (git checkout -- .fk/<file>).`);
  auditGates(root, rows);
  await auditTasks(root);
  const { drift } = await import('./cmd/index.mjs');
  const d = await drift(root);
  if (d.lines.length) { say('fk audit: decisions, lessons and the bible have drifted:'); for (const l of d.lines) say(`- ${l}`); }
  else if (d.checked) say('fk audit: decisions, lessons and the bible are in step with the work.');
  const kc = await (await import('./cmd/knowledge.mjs')).check(root);
  if (kc.clusters?.length) say(`fk audit: ${kc.clusters.length} statement(s) in docs changed since the knowledge consolidation may contradict accepted decisions or standards (fk knowledge check).`);
  if (!rows.length) return say('fk audit: nothing logged yet.');
  const count = (pred) => rows.filter(pred).length;
  say(`fk audit: ${rows.length} entries since ${rows[0]?.ts ?? '-'}.`);
  say(`- ${count((r) => r.decision === 'deny')} actions were blocked, ${count((r) => r.decision === 'ask')} were sent to you for a yes/no.`);
  say(`- ${count((r) => r.decision === 'would-deny')} installs would have been blocked (the install guard only logs until you approve a first tool or type: fk-approve tool enforce <reason>).`);
  say(`- ${count((r) => r.decision === 'tamper')} times a command changed gate files without approval.`);
  say(`- ${count((r) => r.decision === 'override-set')} overrides you approved; ${count((r) => r.decision === 'allow-override')} actions went through on them.`);
  say(`- ${count((r) => r.guard === 'pointer')} times agents were pointed at the agreements.`);
  say(`- ${count((r) => r.error)} guard errors${count((r) => r.error) ? ' (run `fk doctor`)' : ''}.`);
  const unmarked = count((r) => r.event === 'UserPromptSubmit' && /^(?:override-set|approve-|enforce-)/.test(r.decision || '') && !fromKit(r));
  const untrusted = count((r) => r.decision === 'directive-untrusted-runtime');
  if (unmarked || untrusted) say(`- ${unmarked} approval lines lack the plugin runtime marker (or came from another plugin folder) and ${untrusted} directives came from outside the installed plugin: review them.`);
  const byGuard = {};
  for (const r of rows) if (r.decision === 'deny' || r.decision === 'tamper') byGuard[r.guard] = (byGuard[r.guard] || 0) + 1;
  if (Object.keys(byGuard).length) say('Blocked by guard: ' + Object.entries(byGuard).map(([g, n]) => `${g} ${n}`).join(', ') + '.');
  const recent = rows.filter((r) => ['deny', 'tamper', 'override-set'].includes(r.decision)).slice(-10);
  if (recent.length) { say('Most recent:'); for (const r of recent) say(`  ${r.ts.slice(0, 16).replace('T', ' ')}  ${r.decision.padEnd(12)} ${r.reason || (r.changed || []).join(', ')}`); }
}

// ---- kickoff protection: OMC's autopilot/ralph keywords stay off until the constraints are agreed ----
const KICKOFF_OFF = ['autopilot', 'ralph'];
function parseJsonc(text) {
  try { return JSON.parse(text); } catch { /* comments or trailing commas */ }
  return JSON.parse(text.replace(/("(?:\\.|[^"\\])*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m, str) => str ?? '').replace(/,(\s*[}\]])/g, '$1'));
}

// A founder-typed fk-override <guard> line, unexpired, recorded by the installed plugin (the CLI has no session id).
function typedOverride(root, guard) {
  const typed = readLog(root).filter((r) => r.event === 'UserPromptSubmit' && r.decision === 'override-set' && r.guard === guard && fromKit(r));
  return readOverrides(root).find((o) => o.guard === guard && Date.parse(o.expires) > Date.now() && typed.some((r) => r.expires === o.expires)) || null;
}

function kickoff(action, quiet = false, uninstalling = false) {
  const root = needRoot();
  const out = quiet ? () => {} : say;
  if (!['protect', 'release'].includes(action)) { say('usage: fk kickoff protect | fk kickoff release'); process.exitCode = 1; return; }
  if (!fs.existsSync(path.join(root, '.fk'))) { out('fk: run `fk init` first.'); process.exitCode = 1; return; }
  const file = path.join(root, '.claude', 'omc.jsonc');
  const stateFile = path.join(root, '.fk', 'kickoff.json');
  const existed = fs.existsSync(file);
  // Releasing turns autopilot/ralph back on: only once the non-negotiables are written down and committed.
  if (action === 'release' && !uninstalling) {
    const c = loadConfig(root).paths.constraints;
    const committed = run('git', ['cat-file', '-e', `HEAD:${c}`], { cwd: root, shell: false }).status === 0;
    const o = !committed && typedOverride(root, 'kickoff');
    if (!committed && !o) {
      say(`fk: kickoff protection stays on: ${c} is ${fs.existsSync(path.join(root, c)) ? 'not committed yet' : 'missing'}. Finish the kickoff (the agreed non-negotiables in ${c}), commit it, then run this again.`);
      say('To release it anyway, the founder types this line alone as a message: fk-override kickoff <reason>');
      process.exitCode = 1; return;
    }
    if (o) log(root, { event: 'cli', guard: 'kickoff', decision: 'allow-override', reason: o.reason });
  }
  if (action === 'release' && !existed) {
    fs.rmSync(stateFile, { force: true });
    refreshSnapshot(root, ['.fk/kickoff.json']);
    return out('fk: no kickoff protection to release.');
  }
  let cfg;
  try { cfg = existed ? parseJsonc(fs.readFileSync(file, 'utf8')) : {}; }
  catch { say('fk: .claude/omc.jsonc is not valid JSON; left unchanged. Fix it, then run this again.'); process.exitCode = 1; return; }
  const kd = (cfg.keywordDetector ||= {});
  const disabled = new Set(kd.disabled || []);
  if (action === 'protect') {
    const added = KICKOFF_OFF.filter((k) => !disabled.has(k));
    kd.disabled = [...disabled, ...added];
    writeJson(file, cfg);
    if (!fs.existsSync(stateFile)) writeJson(stateFile, { created: !existed, added }); // a repeat keeps the first record
    out('fk: kickoff protection on: OMC autopilot and ralph keywords are off in .claude/omc.jsonc.');
  } else {
    const state = readJson(stateFile, { created: false, added: KICKOFF_OFF });
    for (const k of state.added) disabled.delete(k);
    if (disabled.size) kd.disabled = [...disabled]; else delete kd.disabled;
    if (!Object.keys(kd).length) delete cfg.keywordDetector;
    if (!Object.keys(cfg).length && state.created) fs.rmSync(file); else writeJson(file, cfg);
    fs.rmSync(stateFile, { force: true });
    out('fk: kickoff protection released: OMC autopilot and ralph keywords work again.');
  }
  refreshSnapshot(root, ['.claude/omc.jsonc', '.fk/kickoff.json']);
  log(root, { event: 'cli', guard: 'fk', decision: `kickoff-${action}` });
}

// ---- config keys agents may set: the sanctioned door; the rest of .fk/ is founder or hook territory ----
const AGENT_KEYS = ['runner', 'check', 'stack', 'fast_gates', 'protected_extra', 'risk_r3', 'reviewer_extra', 'parent'];
async function config(sub, key, ...rest) {
  const root = needRoot();
  const value = rest.join(' ').trim();
  if (sub !== 'set' || !AGENT_KEYS.includes(key) || !value) {
    say(`usage: fk config set <${AGENT_KEYS.join('|')}> <value>   (protected_extra and risk_r3 add one glob, reviewer_extra one reviewer agent; they never remove. parent: a folder or URL)`);
    process.exitCode = 1; return;
  }
  if (key === 'reviewer_extra') {
    const { implementerAgents, agentName, pluginAgent } = await import('./cmd/task.mjs');
    if (!/^[\w.:-]+$/.test(value) || implementerAgents().includes(agentName(value))) {
      say(`fk: ${value} is not a reviewer agent name (agents that build, such as executor, cannot review).`);
      process.exitCode = 1; return;
    }
    // Only an agent an installed plugin ships: a project agent (.claude/agents/) could be written by the implementer.
    if (!pluginAgent(value)) {
      say(`fk: no installed plugin has an agent named ${value}. A reviewer_extra must come from an installed plugin (its agents/ folder), not from this project.`);
      process.exitCode = 1; return;
    }
  }
  if (key === 'parent') { // the umbrella project: a local folder (its docs/PROJECT.md joins the read-first note) or a URL
    const local = !/^(?:https?:\/\/|ssh:\/\/|git@)\S+$/i.test(value);
    const abs = path.resolve(root, value);
    if (local && (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory() || abs === path.resolve(root))) {
      say(`fk: parent "${value}" is not an https/ssh/git URL or an existing folder outside this project.`);
      process.exitCode = 1; return;
    }
    // A local parent is the top folder of a git repository with a committed docs/PROJECT.md; only its Mission line
    // (shortened) joins the read-first note, never other text.
    const top = local && run('git', ['rev-parse', '--show-toplevel'], { cwd: abs, shell: false });
    const same = (a, b) => { try { return fs.realpathSync.native(a) === fs.realpathSync.native(b); } catch { return false; } };
    if (local && (top.status !== 0 || !same(top.stdout.trim(), abs) || run('git', ['cat-file', '-e', 'HEAD:docs/PROJECT.md'], { cwd: abs, shell: false }).status !== 0)) {
      say(`fk: parent "${value}" must be the top folder of a git repository whose docs/PROJECT.md is committed.`);
      process.exitCode = 1; return;
    }
    if (local) say('fk: the parent bible\'s Mission line joins the session read-first note.');
  }
  const file = path.join(root, '.fk', 'config.json');
  if (!fs.existsSync(file)) { say('fk: run `fk init` first.'); process.exitCode = 1; return; }
  const before = new Set(Object.keys(readSnapshot(root).files));
  const cfg = readJson(file, {});
  // Gate commands may only grow without the founder (the old command stays a whole && step); anything else needs a
  // typed `fk-approve gates` line, used once. runner counts only while no check is set (the gate is then `<runner> check`).
  let gate = null;
  if (GATE_KEYS.includes(key) && !(key === 'runner' && cfg.check)) {
    const prev = key === 'runner' && cfg.runner === DEFAULT_CONFIG.runner ? null : cfg[key];
    const why = softening(prev, value);
    gate = { from: cfg[key] ?? null, how: !norm(prev) ? 'first-set' : norm(prev) === norm(value) ? 'unchanged' : why ? 'approved' : 'extension' };
    if (why) {
      const typed = readLog(root).filter((r) => r.event === 'UserPromptSubmit' && r.decision === 'approve-gates' && fromKit(r));
      const a = takeApproval(root, key, value, (x) => typed.some((r) => r.expires === x.expires && r.session === x.session));
      if (!a) {
        say(`fk: ${key} is already "${norm(prev)}". This change was not made: ${why}.`);
        say(`A gate command may only grow (${norm(prev)} && <another check>). To change it anyway, the founder types this line alone as a message:`);
        say(`fk-approve gates ${key} "${norm(value)}" <reason>`);
        say('Then run this command again.');
        log(root, { event: 'cli', guard: 'gate-guard', decision: 'gate-change-refused', key, from: gate.from, to: value });
        process.exitCode = 1; return;
      }
      gate.approval = { ts: a.ts, reason: a.reason, session: a.session };
    }
  }
  if (key === 'protected_extra') cfg.protected_extra = [...new Set([...(cfg.protected_extra || []), value])];
  else if (key === 'reviewer_extra') cfg.reviewer_extra = [...new Set([...(cfg.reviewer_extra || []), value])];
  else if (key === 'risk_r3') cfg.risk = { ...(cfg.risk || {}), r3: [...new Set([...(cfg.risk?.r3 || []), value])] };
  else cfg[key] = value;
  writeJson(file, cfg);
  refreshSnapshot(root, ['.fk/config.json', ...listProtected(root).filter((r) => !before.has(r))]);
  log(root, { event: 'cli', guard: 'fk', decision: 'config-set', reason: `${key} = ${value}` });
  if (gate) log(root, { event: 'cli', guard: 'gate-guard', decision: 'gate-change', key, from: gate.from, to: value, how: gate.how, ...(gate.approval ? { approval: gate.approval } : {}) });
  say(`set     ${key} = ${value}${gate?.approval ? ' (founder-approved)' : ''}`);
}

// Only the founder takes the kit out, in a terminal: Claude Code sets CLAUDE_CODE_CHILD_SESSION=1 for the commands its
// Bash/PowerShell tools run (code.claude.com/docs/en/env-vars; CLAUDECODE is also set in IDE terminals, so it is not
// used), and gate-guard hard-stops the command text as well. The variable can be unset (env -u), so a Claude Code
// process among fk's parents also counts; a process started so that its parent chain no longer reaches Claude Code is
// not seen (only Claude Code's sandbox stops a determined agent, fk doctor).
export const agentShell = () => process.env.CLAUDE_CODE_CHILD_SESSION === '1' || claudeAncestor();
export const AGENT_REFUSED = 'only you can take the kit out. Run it yourself in a terminal outside Claude Code.';

async function uninstall() {
  if (agentShell()) { say(`fk uninstall${args.includes('--system') ? ' --system' : ''}: refused: ${AGENT_REFUSED}`); process.exitCode = 1; return; }
  // --system: what the kit put on this computer (tools, plugins, settings, data), from the install ledger.
  if (args.includes('--system')) { process.exitCode = await (await import('./cmd/setup/remove.mjs')).runSystemUninstall(args); return; }
  const root = needRoot();
  kickoff('release', true, true);
  process.exitCode = 0;
  const hp = run('git', ['config', '--get', 'core.hooksPath'], { cwd: root, shell: false }).stdout.trim();
  if (hp === '.githooks') { run('git', ['config', '--unset', 'core.hooksPath'], { cwd: root, shell: false }); say('unset   git core.hooksPath'); }
  else if (hp) {
    const pc = path.join(path.resolve(root, hp), 'pre-commit');
    const text = fs.existsSync(pc) ? fs.readFileSync(pc, 'utf8') : '';
    if (text.includes(CHAIN_MARK)) {
      fs.writeFileSync(pc, text.split('\n').filter((l, i, a) => !l.includes(CHAIN_MARK) && !a[i - 1]?.includes(CHAIN_MARK)).join('\n'));
      say(`unchained ${hp}/pre-commit`);
    }
  }
  const tdir = path.join(TEMPLATE, '.githooks');
  for (const f of fs.readdirSync(tdir)) {
    const p = path.join(root, '.githooks', f);
    if (fs.existsSync(p) && fs.readFileSync(p, 'utf8') === fs.readFileSync(path.join(tdir, f), 'utf8')) { fs.rmSync(p); say(`removed .githooks/${f}`); }
    else if (fs.existsSync(p)) say(`kept    .githooks/${f} (edited by the project)`);
  }
  try { fs.rmdirSync(path.join(root, '.githooks')); } catch { /* not empty or absent */ }
  // Take back out exactly what `fk memory setup` added (.fk/memory.json); the project's own settings stay.
  const mem = readJson(path.join(root, '.fk', 'memory.json'), null);
  const sfile = path.join(root, '.claude', 'settings.json');
  const s = mem && readJson(sfile, null);
  if (s) {
    const deny = (s.permissions?.deny || []).filter((t) => !(mem.deny_added || []).includes(t));
    if (s.permissions?.deny) { if (deny.length) s.permissions.deny = deny; else delete s.permissions.deny; }
    if (s.permissions && !Object.keys(s.permissions).length) delete s.permissions;
    for (const p of mem.plugins_disabled || []) if (s.enabledPlugins?.[p] === false) delete s.enabledPlugins[p];
    if (s.enabledPlugins && !Object.keys(s.enabledPlugins).length) delete s.enabledPlugins;
    writeJson(sfile, s);
    say('cleaned .claude/settings.json (memory tool limits the kit added)');
  }
  if ((await import('./cmd/setup/sandbox.mjs')).removeGuardSettings(root)) say('cleaned .claude/settings.json (the deny rules for ~/.fk the kit added)');
  fs.rmSync(stateDir(root), { recursive: true, force: true });
  fs.rmSync(path.join(root, '.fk'), { recursive: true, force: true });
  say('removed .fk/ and the kit state for this project');
  say('fk: uninstalled. docs/ and .omc/ were left untouched.');
}

const [cmd, ...args] = process.argv.slice(2);
const commands = {
  audit, uninstall,
  init: () => init(args.includes('--chain')),
  doctor: () => doctor(args.includes('--hooks')),
  config: () => config(...args),
  kickoff: () => kickoff(args[0]),
  'omc-refresh': () => fetchOmcLatest(), // background refresh started by the SessionStart hook
};
// Extra commands live in bin/cmd/<name>.mjs (default export: async (args) => void), so features stay in their own files.
const CMD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cmd');
const extra = cmd && /^[a-z][\w-]*$/.test(cmd) ? path.join(CMD_DIR, `${cmd}.mjs`) : '';
if (commands[cmd]) commands[cmd]();
else if (extra && fs.existsSync(extra)) import(pathToFileURL(extra).href).then((m) => m.default(args));
else {
  const more = fs.readdirSync(CMD_DIR).filter((n) => n.endsWith('.mjs')).map((n) => `fk ${n.slice(0, -4)}`).sort();
  say(`usage: fk init [--chain] | fk doctor [--hooks] | fk audit | fk config set <key> <value> | fk kickoff protect|release | fk uninstall [--system]\nmore:  ${more.join(' | ')}`);
}
