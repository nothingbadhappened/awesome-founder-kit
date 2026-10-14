// C2: agreed gates cannot be quietly weakened. PreToolUse checks file edits; tamper() checks shell/MCP writes after the fact.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOOK_OWNED, relPath, protectedClass, gateText, quickDiff, readSnapshot, writeJson, shellTool, segments, tokens, globToRegex, fkHome, stateFile } from '../lib.mjs';

export const name = 'gate-guard';

const APPROVAL = 'loosening an agreed gate needs founder approval (the founder types: fk-override gate-guard <reason>)';
// Always a loosening word in an added gate line.
const LOOSEN = /\b(?:ignored?|ignores|disabled?|skip|allow(?:ed)?|nocheck|noqa|continue-on-error)\b|exit\s+0|\|\|\s*true/i;
// Ordinary values (`"semi": false`, `"exclude": [...]`, `"no-console": "warn"`): loosening only on a strictness key, or
// when a rule the old text had at "error" now reads warn/off/0/1.
const KEYED_LOOSEN = /\b(?:off|warn|exclude[sd]?|false)\b|:\s*["']?[01]["']?\s*,?\s*$/i;
const STRICT_KEY = /strict|noImplicit|noUnused|noFallthrough|lint|test|check|audit|scan|coverage|typecheck|failOn|verify/i;
const STRICTNESS = /strict|noImplicit|lint|\btest|\bcheck\b|audit|scan|fail|coverage|typecheck/i; // \bcheck\b: not "checkout"
// Soft files (tsconfig, CI): inheriting another config or skipping CI for some branches/paths can drop checks without
// removing a line (dropped push/pull_request triggers: ciTriggers).
const SOFT_LOOSEN = /\bextends\b|branches-ignore|paths-ignore/i;
const keyOf = (l) => /^-?\s*["']?([\w@/.$-]+)["']?\s*[:=]/.exec(l)?.[1] ?? null;
const ERROR_LEVEL = /:\s*\[?\s*["']?(?:error|2)["']?/i;
function loosens(line, oldLines) {
  if (LOOSEN.test(line)) return true;
  if (!KEYED_LOOSEN.test(line)) return false;
  const key = keyOf(line);
  if (!key) return false;
  if (STRICT_KEY.test(key)) return true;
  return oldLines.some((l) => keyOf(l) === key && ERROR_LEVEL.test(l));
}
// .fk JSON by path (`.fk/...json`); after `cd .fk`, or with the shell started inside .fk/, any JSON name.
const FK_JSON = /\.fk[\\/](?:[\w.*?-]+[\\/])*[\w.*?-]*(?:\.jsonc?\b|[*?])/i;
// After `cd .fk` (pushd, Set-Location), or in a shell started inside .fk/, any JSON name is a .fk file: config.json, baseline.json, ...
const INTO_FK = /^(?:cd|pushd|chdir|set-location|sl)\s+["']?(?:\.[\\/])?\.fk(?:[\\/]|["']?$)/i;
const ANY_JSON = /[\w.-]+\.jsonc?\b/i;
// Shell may read .fk JSON (cat/type/Get-Content without a redirect), use git, or go through the fk CLI; nothing else writes it.
const FK_JSON_OK = (seg) => /^(?:cat|type|get-content|gc|git|fk|fk\.cmd)\s|^node\s+["']?[^"']*fk\.mjs["']?\s/i.test(seg)
  && !/>|\b(?:tee|set-content|out-file|add-content)\b/i.test(seg);
// Looking is always fine: read-only commands on .fk files, the kit state or the kit source.
const READ_ONLY = (seg) => /^(?:tail|head|grep|egrep|fgrep|rg|less|more|ls|dir|cat|type|get-content|gc|select-string|sls|wc|git\s+(?:log|show|diff|status|blame))(?:\s|$)/i.test(seg)
  && !/>|--pre\b|\b(?:tee|set-content|out-file|add-content)\b/i.test(seg);
// C1: the hooks take approvals from stdin and keep their state in <home>/.fk/state. Only kit-anchored references count
// (the plugin's own hooks dir, a founder-kit/.../hooks/ path, the state dir), so a project's own src/hooks/session or a
// takeSnapshot() helper is ordinary code. Hard stops (no override): feeding a hook event to a node script that is the
// kit dispatcher (or a glob that could be), setting CLAUDE_PLUGIN_ROOT, writing into the state dir, removing .fk.
const norm = (s) => s.replace(/\\/g, '/').toLowerCase();
const HOOKS_DIR = norm(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const KIT_PATH = /founder-kit[\\/](?:[^\s"'`\\/]+[\\/]){0,4}hooks[\\/]/i;
const KIT_IDENT = /\b(?:addOverride|refreshSnapshot|takeSnapshot|sanctionedJson|sessionSnapshot|stateDir|stateFile)\b/;
const HOOK_EVENT = /\bnode(?:\.exe)?["']?\s[^;&|]*?(?:dispatch\.mjs|\S*[*?]\S*\.mjs|founder-kit\S*)["']?\s+["']?(?:UserPromptSubmit|PreToolUse|PostToolUse|SessionStart|SubagentStart)\b/i;
const PLUGIN_ROOT_SET = /\bCLAUDE_PLUGIN_ROOT\s*=|\$env:CLAUDE_PLUGIN_ROOT\s*=/i;
const STATE_REF = /\.fk[\\/]state\b/i;
const DECODE_RUN = /\bbase64\s+(?:-d|--decode|-D)\b[^;&]*\|\s*node\b|\bnode\s+(?:[^|;&]*\s)?--input-type\b(?![^|;&]*\s(?:-e|--eval|-p|--print)\b)|FromBase64String[\s\S]*\bnode\b/i;
const DOC = /\.(?:md|mdx|markdown|txt)$/i;
const INTERNAL = 'fk gate-guard: the kit hooks run only inside Claude Code; nothing invokes, imports, copies or edits them, or their state, from a command or a file.';
const KIT_OVERRIDE = ' If this is ordinary project work that only looks like it, the founder types: fk-override gate-guard <reason>.';
// Kit-anchored text: the resolved hooks dir, a founder-kit/.../hooks/ path, or a kit identifier next to "founder-kit".
const kitPath = (text) => norm(text).includes(HOOKS_DIR) || KIT_PATH.test(text);
const kitRef = (text) => kitPath(text) || (KIT_IDENT.test(text) && /founder-kit/i.test(text));
// The kit's own lib path together with a state-writing kit function is writing the kit state: a hard stop.
const kitStateCall = (text) => kitPath(text) && KIT_IDENT.test(text);
// .fk/ (and <home>/.fk) goes away only through `fk uninstall`: deleting or moving it would reset every guard.
const REMOVE = /^(?:rm|rmdir|del|erase|rd|remove-item|ri|mv|move|move-item|mi|ren|rename|rename-item|rni)$/i;
// A literal .fk anywhere in the path; a glob (.f*, .??) only as the first component (dist/.* is build output, not .fk).
const isFk = (tok) => {
  const c = tok.replace(/^(?:\.[\\/])+/, '').split(/[\\/]/);
  return c.some((x) => x.toLowerCase() === '.fk') || (/^\.[^\\/]*[*?[]/.test(c[0]) && globToRegex(c[0]).test('.fk'));
};
const removesFk = (seg) => { const t = tokens(seg); return REMOVE.test(t[0] || '') && t.slice(1).some((a) => !a.startsWith('-') && isFk(a)); };

const lines = (t) => String(t || '').split(/\r?\n/).map((l) => l.trim().replace(/,$/, '')).filter(Boolean);

// Lines of `a` that are not in `b` (multiset difference).
function missing(a, b) {
  const pool = new Map();
  for (const l of b) pool.set(l, (pool.get(l) || 0) + 1);
  return a.filter((l) => { const n = pool.get(l) || 0; if (n) pool.set(l, n - 1); return !n; });
}

function applyEdit(old, ti) {
  if (!ti.old_string || !old.includes(ti.old_string)) return null;
  if (ti.replace_all) return old.split(ti.old_string).join(ti.new_string ?? '');
  const i = old.indexOf(ti.old_string);
  return old.slice(0, i) + (ti.new_string ?? '') + old.slice(i + ti.old_string.length);
}

// Ignoring build output, dependencies, lockfiles or generated code is not loosening a gate (dist/**, *.lock, __pycache__).
const BUILD_DIR = /^(?:dist|build|out|coverage|node_modules|\.next|\.nuxt|\.turbo|\.cache|target|vendor|generated|__generated__|__pycache__|\.venv|venv)$/i;
const LOCKFILE = /(?:^|\.)lock$|^(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|bun\.lockb)$/i;
function buildPattern(p) {
  const c = String(p).trim().replace(/^["']|["']$/g, '').replace(/^!/, '').split('/').filter((x) => x && x !== '.' && !/^\*+$/.test(x));
  const base = (c[c.length - 1] || '').replace(/^\*\.?/, '');
  return c.length > 0 && (c.some((x) => BUILD_DIR.test(x)) || LOCKFILE.test(base) || /\.(?:generated|gen)\.\w+$/i.test(base));
}
// Per-file ignores for test code (S101 under tests/) are ordinary.
const TEST_GLOB = /(?:^|[\/*])(?:tests?|__tests__|specs?|fixtures|testdata|e2e)(?:[\/*]|$)|\.(?:test|spec)\.|(?:^|\/)test_|_test\.\w+$|conftest\.py$/i;
const PER_FILE = /per[-_]?file[-_]?ignores/i;
const PATH_ENTRY = /^["']([^"']+)["']\s*[:=]/;
const quoted = (s) => [...s.matchAll(/["']([^"']*)["']/g)].map((m) => m[1]);
// An added line that only ignores build output, or only relaxes rules for test files.
function harmless(l, added, b) {
  if (PER_FILE.test(l)) {
    const paths = quoted(l).filter((v) => /[\/*.]/.test(v));
    const entries = added.map((x) => PATH_ENTRY.exec(x)?.[1]).filter((p) => p && /[/*.]/.test(p));
    return [...paths, ...entries].every((p) => TEST_GLOB.test(p));
  }
  const eq = /[:=]/.exec(l.replace(/["'][^"']*["']/g, (m) => '_'.repeat(m.length)));
  const vals = quoted(eq ? l.slice(eq.index + 1) : l);
  if (vals.length) return vals.every(buildPattern);
  // `ignores: [` opening a block: harmless when every pattern up to the closing `]` is build output.
  if (!/[:=]\s*\[$/.test(l) || !/ignor|exclud/i.test(l)) return false;
  const block = [];
  for (let i = b.indexOf(l) + 1; i < b.length && !b[i].startsWith(']'); i++) block.push(b[i]);
  return block.length > 0 && block.every(buildPattern);
}
// CI triggers that run the checks; dropping one stops CI from running them. Restructuring `on:` otherwise is fine.
function ciTriggers(ls) {
  const s = new Set();
  for (const l of ls) {
    const m = /^["']?on["']?:\s*(.*)$/.exec(l);
    const t = m ? m[1] : /^-?\s*(?:push|pull_request)\s*:?\s*(?:\{.*\}|\[.*\])?$/.test(l) ? l : '';
    for (const x of t.matchAll(/\b(push|pull_request)\b/g)) s.add(x[1]);
  }
  return s;
}

export function judge(cls, rel, oldText, newText) {
  const a = lines(gateText(rel, oldText)), b = lines(gateText(rel, newText));
  if (cls === 'strict') return a.join('\n') === b.join('\n') ? null : 'this file is part of the agreed harness';
  const removed = missing(a, b), added = missing(b, a);
  if (cls === 'exceptions') return added.some((l) => !l.startsWith('#') && !buildPattern(l)) ? 'adding gate exceptions weakens a gate' : null;
  const loose = (l) => !harmless(l, added, b) && loosens(l, a);
  if (cls === 'soft') {
    // A strictness line rewritten under the same key (strict: false -> true, npm test -> npm run test:ci) is not removed.
    if (removed.some((l) => STRICTNESS.test(l) && !added.some((n) => keyOf(n) && keyOf(n) === keyOf(l) && STRICTNESS.test(n)))) {
      return 'the change removes a strictness, test or check line';
    }
    const before = ciTriggers(a), after = ciTriggers(b);
    if ([...before].some((t) => !after.has(t))) return 'the change removes a push or pull_request trigger, so CI stops running the checks';
    return added.some((l) => !harmless(l, added, b) && (loosens(l, a) || SOFT_LOOSEN.test(l))) ? 'an added line turns a rule off or widens an exception' : null;
  }
  // Rewrites under the same key are fine (printWidth 80 -> 100, "warn" -> "error"), unless an error-level rule drops below error.
  const addedByKey = new Map(added.map((l) => [keyOf(l), l]));
  for (const l of removed) {
    const k = keyOf(l), n = k && addedByKey.get(k);
    if (!n) return 'the change removes existing gate lines';
    if (/^(?:select|extend-select|plugins|extends)$/i.test(k) && quoted(l).some((v) => !quoted(n).includes(v))) return 'the change drops rules from a selected set';
    if (ERROR_LEVEL.test(l) && !ERROR_LEVEL.test(n)) return 'a rule drops below error';
  }
  if (added.some(loose)) return 'an added line turns a rule off or widens an exception';
  return null;
}

const under = (file, dir) => { const r = path.relative(dir, file); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };

export function check({ root, input, tool, ti }) {
  if (shellTool(tool)) {
    const cmd = String(ti.command || '');
    const segs = segments(cmd).filter((seg) => !READ_ONLY(seg));
    const state = norm(path.join(fkHome(), 'state'));
    if (PLUGIN_ROOT_SET.test(cmd) || segs.some((seg) => HOOK_EVENT.test(seg) || STATE_REF.test(seg) || norm(seg).includes(state) || kitStateCall(seg))) {
      return { decision: 'deny', reason: INTERNAL, noOverride: true };
    }
    if (DECODE_RUN.test(cmd) || segs.some(kitRef)) return { decision: 'deny', reason: INTERNAL + KIT_OVERRIDE };
    if (segs.some(removesFk)) {
      return { decision: 'deny', reason: 'fk gate-guard: .fk/ is removed or moved only by `fk uninstall` (the founder runs it).', noOverride: true };
    }
    let inFk = !!input?.cwd && (path.resolve(input.cwd) === path.join(root, '.fk') || under(path.resolve(input.cwd), path.join(root, '.fk')));
    if (segs.some((seg) => { inFk ||= INTO_FK.test(seg); return (FK_JSON.test(seg) || (inFk && ANY_JSON.test(seg))) && !FK_JSON_OK(seg); })) {
      return { decision: 'deny', reason: 'fk gate-guard: .fk/*.json changes only through the founder\'s fk-approve lines or the fk CLI (fk config set). Reading it with cat is fine.' };
    }
    return null;
  }
  if (!['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) return null;
  const file = ti.file_path || ti.notebook_path || '';
  const text = [ti.content, ti.new_string, ti.new_source, ...(ti.edits || []).map((e) => e.new_string)].filter(Boolean).join('\n');
  if (file && (under(path.resolve(root, file), path.join(fkHome(), 'state')) || (!DOC.test(file) && kitStateCall(text)))) {
    return { decision: 'deny', reason: INTERNAL, noOverride: true };
  }
  if (file && (under(norm(path.resolve(root, file)), HOOKS_DIR) || (!DOC.test(file) && kitRef(text)))) {
    return { decision: 'deny', reason: INTERNAL + KIT_OVERRIDE };
  }
  const rel = relPath(root, file);
  if (rel && HOOK_OWNED.has(rel)) {
    return { decision: 'deny', reason: `fk gate-guard: ${rel} is written only by the kit.`, noOverride: true };
  }
  const cls = protectedClass(root, rel);
  if (!cls) return null;
  let old = null;
  try { old = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { /* new file */ }
  // A brand-new config or CI file (never snapshotted) is the project setting itself up: allowed, then snapshotted by
  // PostToolUse. The harness files (.fk, Claude settings, MCP, git hooks) and gate-exception lists are judged as before.
  if (old === null && (cls === 'config' || cls === 'soft') && !/^\.(?:githooks|husky)\//i.test(rel) && !(rel in readSnapshot(root).files)) {
    return { decision: 'allow', reason: `${rel}: new file` };
  }
  old ??= '';
  let next;
  if (tool === 'Write') next = ti.content;
  else if (tool === 'Edit') next = applyEdit(old, ti);
  else if (tool === 'MultiEdit') next = (ti.edits || []).reduce((t, e) => (t == null ? null : applyEdit(t, e)), old);
  if (next == null && tool !== 'NotebookEdit') return null; // the edit cannot apply; the tool will fail on its own
  const why = tool === 'NotebookEdit' ? 'notebook edits to gate files are not checked' : judge(cls, rel, old, next);
  return why ? { decision: 'deny', reason: `fk gate-guard: ${rel}: ${why}. ${APPROVAL}.` }
    : { decision: 'allow', reason: `${rel}: no gate loosened` };
}

// Claude Code itself writes these (a permission grant lands in settings.local.json): absorbed, never reported.
// Agent Write/Edit on them is still checked up front.
const EXTERNAL_WRITTEN = new Set(['.claude/settings.local.json']);

// PostToolUse on Bash/PowerShell/MCP: compare protected files with the snapshot.
export function tamper(root, overridden) {
  const { snap, now, changed: all } = quickDiff(root);
  // A scaffolder (create-next-app, tsc --init, uv init) creating a config or CI file the snapshot never knew is the project
  // setting itself up, as a new-file Write is: absorbed. New git hooks and harness files are still reported.
  const fresh = all.filter((r) => !(r in snap.files) && now[r] && ['config', 'soft'].includes(protectedClass(root, r)) && !/^\.(?:githooks|husky)\//i.test(r));
  for (const r of fresh) snap.files[r] = now[r];
  const changed = all.filter((r) => !EXTERNAL_WRITTEN.has(r) && !fresh.includes(r));
  for (const r of all) if (EXTERNAL_WRITTEN.has(r)) { if (now[r]) snap.files[r] = now[r]; else delete snap.files[r]; }
  const snapFile = stateFile(root, 'snapshots.json');
  if (!changed.length) { if (all.length) writeJson(snapFile, snap); return null; }
  const key = changed.map((r) => `${r}:${now[r] ?? '-'}`).join('|');
  if (overridden || snap.reported === key) {
    writeJson(snapFile, overridden ? { files: now, reported: null } : snap);
    return { decision: overridden ? 'allow-override' : 'tamper-repeat', changed };
  }
  writeJson(snapFile, { ...snap, reported: key });
  return {
    decision: 'block', changed,
    reason: `fk gate-guard: that command changed agreed gate files without founder approval: ${changed.join(', ')}. ` +
      `Revert them (for example git checkout -- <file>), or ${APPROVAL}.`,
  };
}
