#!/usr/bin/env node
// fk: founder-kit project CLI. init | doctor [--hooks] | audit | config set | kickoff protect|release | uninstall
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, takeSnapshot, refreshSnapshot, readSnapshot, listProtected, log, DEFAULT_CONFIG,
  omcPlugin, omcStatus, fetchOmcLatest, cmpVer, OMC_UPDATE } from '../hooks/lib.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = path.join(KIT, 'templates', 'project');
const RUNTIME = ['compliance.jsonl', 'overrides.json', 'snapshots.json', 'ledger.jsonl'];

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

function init() {
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
  for (const f of fs.readdirSync(hooksSrc)) {
    const dst = path.join(root, '.githooks', f);
    if (fs.existsSync(dst)) { say(`kept    .githooks/${f} (already present)`); continue; }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(hooksSrc, f), dst);
    fs.chmodSync(dst, 0o755);
    run('git', ['update-index', '--add', '--chmod=+x', `.githooks/${f}`], { cwd: root, shell: false }); // exec bit on Windows too
    say(`created .githooks/${f}`);
  }
  run('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root, shell: false });
  say('set     git core.hooksPath = .githooks');
  takeSnapshot(root);
  say('fk: ready. Guards are active for this project. Set the pre-commit gates with: fk config set fast_gates "<command>"');
}

const OMC_INSTALL = '/plugin marketplace add Yeachan-Heo/oh-my-claudecode, /plugin install oh-my-claudecode@omc';

async function omcRows(add) {
  const plugin = omcPlugin();
  const npm = plugin ? null : run('omc', ['--version']);
  const npmVer = npm?.status === 0 ? (/\d+\.\d+\.\d+/.exec(npm.stdout) || ['?'])[0] : null;
  if (!plugin && !npmVer) return add('oh-my-claudecode', false, `not found: the kit relies on OMC for the workflow (run: ${OMC_INSTALL})`);
  if (!plugin) add('OMC install mode', 'yellow', `OMC plugin mode required (run: ${OMC_INSTALL})`);
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
  const root = repoRoot();
  const hasFk = !!(root && fs.existsSync(path.join(root, '.fk')));
  add('project .fk/', hasFk || 'yellow', hasFk ? root : `${root ? 'absent' : 'not in a git repo'} (expected before fk init)`);
  if (withHooks) {
    const { runSuite } = await import('../hooks/selftest.mjs');
    for (const r of runSuite()) add(`planted: ${r.name}`, r.ok, `expected ${r.expected}, got ${r.got}`);
  }
  print(rows);
}

const LABEL = { green: '\x1b[32mgreen \x1b[0m', yellow: '\x1b[33myellow\x1b[0m', red: '\x1b[31mred   \x1b[0m' };
function print(rows) {
  const w = Math.max(...rows.map((r) => r[1].length));
  for (const [s, item, note] of rows) say(`${LABEL[s]}  ${item.padEnd(w)}  ${note}`);
  if (rows.some((r) => r[0] === 'red')) process.exitCode = 1;
}

function audit() {
  const root = needRoot();
  const file = path.join(root, '.fk', 'compliance.jsonl');
  if (!fs.existsSync(file)) return say('fk audit: nothing logged yet.');
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const count = (pred) => rows.filter(pred).length;
  say(`fk audit: ${rows.length} entries since ${rows[0]?.ts ?? '-'}.`);
  say(`- ${count((r) => r.decision === 'deny')} actions were blocked, ${count((r) => r.decision === 'ask')} were sent to you for a yes/no.`);
  say(`- ${count((r) => r.decision === 'would-deny')} installs would have been blocked (the install guard only logs until you approve a first tool or type: fk-approve tool enforce <reason>).`);
  say(`- ${count((r) => r.decision === 'tamper')} times a command changed gate files without approval.`);
  say(`- ${count((r) => r.decision === 'override-set')} overrides you approved; ${count((r) => r.decision === 'allow-override')} actions went through on them.`);
  say(`- ${count((r) => r.guard === 'pointer')} times agents were pointed at the agreements.`);
  say(`- ${count((r) => r.error)} guard errors${count((r) => r.error) ? ' (run `fk doctor`)' : ''}.`);
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

function kickoff(action, quiet = false) {
  const root = needRoot();
  const out = quiet ? () => {} : say;
  if (!['protect', 'release'].includes(action)) { say('usage: fk kickoff protect | fk kickoff release'); process.exitCode = 1; return; }
  if (!fs.existsSync(path.join(root, '.fk'))) { out('fk: run `fk init` first.'); process.exitCode = 1; return; }
  const file = path.join(root, '.claude', 'omc.jsonc');
  const stateFile = path.join(root, '.fk', 'kickoff.json');
  const existed = fs.existsSync(file);
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
const AGENT_KEYS = ['runner', 'check', 'stack', 'fast_gates', 'protected_extra'];
function config(sub, key, ...rest) {
  const root = needRoot();
  const value = rest.join(' ').trim();
  if (sub !== 'set' || !AGENT_KEYS.includes(key) || !value) {
    say(`usage: fk config set <${AGENT_KEYS.join('|')}> <value>   (protected_extra adds one glob; it never removes)`);
    process.exitCode = 1; return;
  }
  const file = path.join(root, '.fk', 'config.json');
  if (!fs.existsSync(file)) { say('fk: run `fk init` first.'); process.exitCode = 1; return; }
  const before = new Set(Object.keys(readSnapshot(root).files));
  const cfg = readJson(file, {});
  if (key === 'protected_extra') cfg.protected_extra = [...new Set([...(cfg.protected_extra || []), value])];
  else cfg[key] = value;
  writeJson(file, cfg);
  refreshSnapshot(root, ['.fk/config.json', ...listProtected(root).filter((r) => !before.has(r))]);
  log(root, { event: 'cli', guard: 'fk', decision: 'config-set', reason: `${key} = ${value}` });
  say(`set     ${key} = ${value}`);
}

function uninstall() {
  const root = needRoot();
  kickoff('release', true);
  process.exitCode = 0;
  const hp = run('git', ['config', '--get', 'core.hooksPath'], { cwd: root, shell: false }).stdout.trim();
  if (hp === '.githooks') { run('git', ['config', '--unset', 'core.hooksPath'], { cwd: root, shell: false }); say('unset   git core.hooksPath'); }
  const tdir = path.join(TEMPLATE, '.githooks');
  for (const f of fs.readdirSync(tdir)) {
    const p = path.join(root, '.githooks', f);
    if (fs.existsSync(p) && fs.readFileSync(p, 'utf8') === fs.readFileSync(path.join(tdir, f), 'utf8')) { fs.rmSync(p); say(`removed .githooks/${f}`); }
    else if (fs.existsSync(p)) say(`kept    .githooks/${f} (edited by the project)`);
  }
  try { fs.rmdirSync(path.join(root, '.githooks')); } catch { /* not empty or absent */ }
  fs.rmSync(path.join(root, '.fk'), { recursive: true, force: true });
  say('removed .fk/');
  say('fk: uninstalled. docs/ and .omc/ were left untouched.');
}

const [cmd, ...args] = process.argv.slice(2);
const commands = {
  init, audit, uninstall,
  doctor: () => doctor(args.includes('--hooks')),
  config: () => config(...args),
  kickoff: () => kickoff(args[0]),
  'omc-refresh': () => fetchOmcLatest(), // background refresh started by the SessionStart hook
};
if (commands[cmd]) commands[cmd]();
else say('usage: fk init | fk doctor [--hooks] | fk audit | fk config set <key> <value> | fk kickoff protect|release | fk uninstall');
