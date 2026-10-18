// Install ledger, fk uninstall --system, fk update, state migrations, the update session note and the release changelog.
// No network, no real installs or removals: home, FK_HOME and Claude's config are temp folders; commands go through
// recording fakes; the installers run only in dry-run or refusal paths, or with every tool faked on a private PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const KIT = path.join(import.meta.dirname, '..');
const REPO = path.join(KIT, '..', '..');
const FK = path.join(KIT, 'bin', 'fk.mjs');
const WIN = process.platform === 'win32';
const LOCK = JSON.parse(fs.readFileSync(path.join(KIT, 'compat.lock.json'), 'utf8'));
const { describe, itemStates, readLedger, notePreExisting, appendLedger, untilde } = await import('../bin/cmd/setup/ledger.mjs');
const { installSteps, pluginSteps, machineSteps, palaceInitStep } = await import('../bin/cmd/setup/recipes.mjs');
const { runSystemUninstall, buildItems } = await import('../bin/cmd/setup/remove.mjs');
const { runUpdate } = await import('../bin/cmd/update.mjs');
const { fetchKitLatest, parseChangelog, sliceChangelog, kitLatestCached } = await import('../bin/cmd/update/release.mjs');
const { migrateDir, migrateAll, kitProjects, STATE_VERSION } = await import('../bin/cmd/update/migrations.mjs');
const { default: kitUpdateNote } = await import('../hooks/session/15-fk-update.mjs');
const gate = await import('../hooks/guards/gate.mjs');
const { runHook } = await import('../hooks/selftest.mjs');
const { founderRun } = await import('./founder-shell.mjs'); // fk uninstall refuses below Claude Code: run it as the founder's terminal would

// A private home for in-process calls: HOME, USERPROFILE, FK_HOME and CLAUDE_CONFIG_DIR point into it.
async function withHome(fn, { plugins = {}, marketplaces = {} } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-life-'));
  const claude = path.join(home, '.claude');
  fs.mkdirSync(path.join(claude, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(claude, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins }));
  fs.writeFileSync(path.join(claude, 'plugins', 'known_marketplaces.json'), JSON.stringify(marketplaces));
  const keys = ['HOME', 'USERPROFILE', 'FK_HOME', 'CLAUDE_CONFIG_DIR', 'FK_LATEST', 'CLAUDE_CODE_CHILD_SESSION'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { HOME: home, USERPROFILE: home, FK_HOME: path.join(home, '.fk'), CLAUDE_CONFIG_DIR: claude });
  delete process.env.FK_LATEST; delete process.env.CLAUDE_CODE_CHILD_SESSION;
  try { return await fn(home); } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    fs.rmSync(home, { recursive: true, force: true });
  }
}
const lines = () => { const l = []; return { out: (s = '') => l.push(s), text: () => l.join('\n') }; };
const reg = (keys) => Object.fromEntries(keys.map((k) => [k, [{ scope: 'user', installPath: '/x', version: '1.0.0' }]]));
const SRC = { plugin: 'founder-kit@awesome-founder-kit', name: 'awesome-founder-kit', repo: 'owner/awesome-founder-kit', dir: null };

// ---------- A. the ledger ----------
const ALL_TOOLS = ['git', 'git-lfs', 'node', 'uv', 'mise', 'just', 'gh', 'podman', 'podman-compose', 'claude-code', 'codebase-memory-mcp', 'mempalace', 'skillspector', 'gitleaks'];
function everyStep(o, has) {
  const out = [];
  for (const id of ALL_TOOLS) for (const s of installSteps(id, LOCK, o, { has })) out.push({ tool: id, action: 'install', ...s });
  for (const id of ['oh-my-claudecode', 'mempalace', 'founder-kit']) for (const s of pluginSteps(LOCK.tools[id], { marketplaceAdded: false, pluginInstalled: false })) out.push({ tool: id, action: 'install', ...s });
  for (const s of machineSteps(LOCK)) out.push({ tool: 'podman', ...s });
  out.push({ tool: 'mempalace', action: 'configure', ...palaceInitStep(LOCK, o, path.join(os.homedir(), '.fk', 'palace-home')) });
  out.push({ tool: 'git-lfs', action: 'configure', cmd: 'git lfs install', rollback: 'git lfs uninstall' });
  out.push({ tool: 'codebase-memory-mcp', action: 'configure', cmd: 'codebase-memory-mcp config set auto_index false', rollback: 'codebase-memory-mcp config set auto_index true' });
  return out;
}
const PATHS = { win: [], mac: ['brew'], linux: ['apt-get'], 'linux-dnf': ['dnf'], 'linux-none': [] };

test('A: every install path records item, kind, how, scope and an exact undo (or home-relative paths); nothing personal', () => {
  for (const [name, bins] of Object.entries(PATHS)) {
    const o = name.split('-')[0];
    for (const s of everyStep(o, (b) => bins.includes(b) || b === 'mise')) {
      const m = describe({ tool: s.tool, action: s.action, cmd: s.cmd, rollback: s.rollback, fn: s.fn }, o);
      const where = `${name}: ${s.cmd.slice(0, 70)}`;
      assert.ok(m.item && m.kind && m.how && m.scope, where);
      if (['installed', 'configured', 'data'].includes(m.kind) && m.how !== 'xcode-select') assert.ok(m.undo || m.fn, `${where}: undo`);
      if (m.paths) for (const p of m.paths) assert.match(p, /^~\//, `${where}: home-relative path`);
      if (m.undo) assert.doesNotMatch(m.undo, /ask the founder|<the previous version>|reinstall the previous/, `${where}: an undo is a command`);
      assert.ok(!JSON.stringify(m).includes(os.homedir()), `${where}: no home folder name`);
    }
  }
  const d = (cmd, o = 'linux', action = 'install', tool = 'x') => describe({ tool, action, cmd, rollback: '' }, o);
  assert.deepEqual([d('winget install --id Git.Git -e', 'win').undo, d('winget install --id Git.Git -e', 'win').scope], ['winget uninstall --id Git.Git -e', 'machine']);
  assert.equal(d('winget install --id jdx.mise -e', 'win').scope, 'user');
  assert.equal(d('sudo apt-get update && sudo apt-get install -y git-lfs').undo, 'sudo apt-get remove -y git-lfs');
  assert.equal(d('mise use -g just@1.58.0').undo, 'mise unuse -g just');
  assert.deepEqual(d('podman machine init --cpus 2 --memory 2048', 'mac', 'configure', 'podman').item, 'podman:machine');
  assert.equal(d('podman machine start', 'mac', 'configure', 'podman').kind, 'runtime');
  assert.equal(d('winget install --id Git.Git -e', 'win', 'upgrade').kind, 'upgraded', 'an update of a tool that was there');
  assert.equal(d('winget install --id Git.Git -e', 'win', 'upgrade').undo, null);
});

test('A: latest state per item: pre-existing stays pre-existing through updates; removed is gone; failures do not count', () => {
  const rows = [
    { item: 'git', kind: 'pre-existing', ok: true }, { item: 'git', kind: 'upgraded', ok: true, version: '2.55.0' },
    { item: 'uv', kind: 'installed', ok: false }, { item: 'gh', kind: 'upgraded', ok: true },
    { item: 'node', kind: 'installed', ok: true, undo: 'u' }, { item: 'node', kind: 'pre-existing', ok: true },
    { item: 'just', kind: 'installed', ok: true }, { item: 'just', kind: 'removed', ok: true },
    { item: 'mise', kind: 'installed', ok: true }, { item: 'mise', kind: 'removed', ok: true }, { item: 'mise', kind: 'installed', ok: true },
  ];
  const s = itemStates(rows);
  assert.equal(s.get('git').state, 'pre-existing');
  assert.equal(s.get('uv'), undefined, 'a failed install is not an item');
  assert.equal(s.get('gh').state, 'pre-existing', 'an upgrade alone means it was already there');
  assert.equal(s.get('node').state, 'installed', 'ours stays ours');
  assert.equal(s.get('just').state, 'removed');
  assert.equal(s.get('mise').state, 'installed', 'installed again after a removal: ours');
  // Lines written before items existed are classified from their command.
  const legacy = itemStates([{ tool: 'gitleaks', action: 'install', command: 'winget install --id Gitleaks.Gitleaks -e', rollback: 'winget uninstall --id Gitleaks.Gitleaks', ok: true, via: 'install.ps1' }].map((r) => ({ ...r, ...describe({ tool: r.tool, action: r.action, cmd: r.command, rollback: r.rollback }, 'win') })));
  assert.equal(legacy.get('gitleaks').undo, 'winget uninstall --id Gitleaks.Gitleaks -e');
});

test('A: pre-existing items are recorded once, never over an item the ledger already knows', () => withHome(() => {
  appendLedger({ tool: 'uv', item: 'uv', kind: 'installed', ok: true, undo: 'uv' });
  notePreExisting([{ item: 'uv' }, { item: 'git', version: '2.55.0' }, { item: 'git' }]);
  const r = readLedger();
  assert.deepEqual(r.map((x) => [x.item, x.kind]), [['uv', 'installed'], ['git', 'pre-existing']]);
}));

const gitBash = WIN ? ['C:\\Program Files\\Git\\bin\\bash.exe'].find((p) => fs.existsSync(p)) : 'bash';
const sh = (dir, name, body) => fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
const MOCKED = ['podman', 'podman-compose', 'docker', 'docker-compose', 'gh', 'git', 'git-lfs', 'mise', 'just', 'uv', 'uvx', 'claude', 'gitleaks', 'skillspector', 'codebase-memory-mcp', 'mempalace', 'brew', 'wsl', 'winget', 'curl', 'wget', 'sudo', 'apt-get', 'dnf', 'pacman', 'node', 'npm', 'omc'];
function sysbin(root) {
  if (WIN) return 'C:\\Program Files\\Git\\usr\\bin';
  const dir = path.join(root, 'sysbin');
  fs.mkdirSync(dir, { recursive: true });
  for (const src of ['/usr/bin', '/bin']) {
    let names = [];
    try { names = fs.readdirSync(src); } catch { continue; }
    for (const n of names) { if (MOCKED.includes(n) || fs.existsSync(path.join(dir, n))) continue; try { fs.symlinkSync(path.join(src, n), path.join(dir, n)); } catch { /* skip */ } }
  }
  return dir;
}
// A simulated machine for install.sh: a temp home, a PATH with only fakes (every installer command succeeds and does
// nothing; curl prints nothing), plus the system utilities bash needs.
function shBox({ present = {}, plugins = {}, marketplaces = {}, palace = false, node = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-sh-'));
  const home = path.join(root, 'home'), bin = path.join(root, 'bin');
  fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins }));
  fs.writeFileSync(path.join(home, '.claude', 'plugins', 'known_marketplaces.json'), JSON.stringify(marketplaces));
  if (palace) fs.mkdirSync(path.join(home, '.config', 'mempalace', 'palace'), { recursive: true });
  for (const n of ['curl', 'wget', 'sudo', 'apt-get', 'claude', 'uv', 'mise', 'codebase-memory-mcp', 'mempalace']) if (!present[n]) sh(bin, n, n === 'mise' ? '[ "$1" = exec ] && exit 1\nexit 0' : 'exit 0');
  for (const [n, text] of Object.entries(present)) sh(bin, n, n === 'git' ? `[ "$1" = config ] && { echo lfs; exit 0; }\necho "${text}"` : `echo "${text}"`);
  if (node) sh(bin, 'node', `exec "${process.execPath.replace(/\\/g, '/')}" "$@"`);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(path|fk_home|claude_code_child_session|claude_config_dir|xdg_config_home|mempalace_config_dir|gh_token|github_token|fk_uninstall|fk_yes|fk_dry_run)$/i.test(k)));
  Object.assign(env, { PATH: `${bin}${path.delimiter}${sysbin(root)}`, HOME: home, USERPROFILE: home, FK_OMC_LATEST: '5.7.2', GH_CONFIG_DIR: path.join(home, '.config', 'gh') });
  return { root, home, bin, env, ledger: path.join(home, '.fk', 'install-ledger.jsonl'), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
// Git for Windows' bin\bash.exe puts its own mingw64/bin (real git, curl) first on PATH; usr\bin\bash.exe keeps ours.
// Elsewhere, install.sh prepends /usr/local/bin and /opt/homebrew/bin when they exist: a run that executes steps is
// only safe where neither exists.
const rawBash = WIN ? ['C:\\Program Files\\Git\\usr\\bin\\bash.exe'].find((p) => fs.existsSync(p)) : 'bash';
const stepsSafe = WIN ? !!rawBash : !['/usr/local/bin', '/opt/homebrew/bin'].some((d) => fs.existsSync(d));
const shRun = (b, args, extra = {}) => spawnSync(rawBash, [path.join(REPO, 'install', 'install.sh'), ...args], { env: { ...b.env, ...extra }, cwd: b.root, encoding: 'utf8', timeout: 120000 });
const ledgerOf = (file) => { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

test('A: install.sh --yes (every tool faked, Linux with apt): each step has a complete ledger line; what was there is pre-existing', { skip: !stepsSafe && 'a system folder install.sh puts first on PATH exists here' }, () => {
  const b = shBox({ present: { git: 'git version 2.55.0', 'git-lfs': 'git-lfs/3.8.0 (GitHub; linux amd64)', gitleaks: '8.30.1' },
    plugins: reg(['mempalace@mempalace']), marketplaces: { mempalace: { source: { source: 'github', repo: 'MemPalace/mempalace' } } }, palace: true });
  try {
    // Every command a step can run resolves to a fake in the sandbox (nothing real is downloaded or installed).
    const which = spawnSync(rawBash, ['-c', 'for c in curl wget sudo apt-get git git-lfs claude uv mise codebase-memory-mcp mempalace; do command -v "$c" || echo "MISSING $c"; done'], { env: b.env, encoding: 'utf8' });
    for (const l of which.stdout.trim().split('\n')) assert.ok(!/MISSING/.test(l) && l.includes(`${path.basename(b.root)}/bin/`), `not a fake: ${l}`);
    const r = shRun(b, ['--yes', '--all']);
    assert.ok(fs.existsSync(b.ledger), r.stdout + r.stderr);
    const rows = ledgerOf(b.ledger);
    const steps = rows.filter((e) => e.kind !== 'pre-existing');
    assert.ok(steps.length >= 10, `steps: ${steps.length}\n${r.stdout}`);
    for (const e of steps) {
      assert.ok(e.item && e.kind && e.how && e.scope && e.command && e.ts && 'undo' in e, JSON.stringify(e));
      if (['installed', 'configured', 'data'].includes(e.kind)) assert.ok(e.undo || e.fn, `undo for ${e.item}: ${JSON.stringify(e)}`);
      for (const p of e.paths || []) assert.match(p, /^~\//);
    }
    const pre = rows.filter((e) => e.kind === 'pre-existing').map((e) => e.item);
    for (const it of ['git', 'gitleaks', 'git-lfs:config', 'mempalace:plugin', 'mempalace:marketplace', 'mempalace:palace']) assert.ok(pre.includes(it), `${it} pre-existing: ${pre}`);
    for (const it of ['uv', 'oh-my-claudecode:plugin', 'oh-my-claudecode:marketplace', 'founder-kit:plugin', 'founder-kit:marketplace', 'codebase-memory-mcp:auto_index']) assert.ok(steps.some((e) => e.item === it), `${it} installed/configured`);
    for (const e of rows) assert.ok(!JSON.stringify([e.undo, e.paths, e.file, e.item]).includes(b.home), `${e.item}: undo and paths are home-relative`);
    // Describe and the bash rules agree on every line.
    for (const e of steps) {
      const m = describe({ tool: e.tool, action: e.action, cmd: e.command, rollback: e.rollback }, 'linux');
      for (const k of ['item', 'kind', 'how', 'scope', 'undo']) assert.equal(e[k] ?? null, m[k] ?? null, `${k} of ${e.command.slice(0, 60)}`);
    }
    const again = shRun(b, ['--dry-run']);
    assert.equal(again.status === 0 || again.status === 1, true);
    assert.equal(ledgerOf(b.ledger).length, rows.length, 'a dry run writes nothing');
  } finally { b.cleanup(); }
});

test('A: install.ps1 Get-LedgerMeta agrees with the kit on every Windows command', { skip: !WIN && 'Windows only' }, () => {
  const steps = everyStep('win', (x) => x === 'mise').concat([{ tool: 'mempalace', action: 'configure', cmd: `set hooks.silent_save = true in ${path.join(os.homedir(), '.config', 'mempalace', 'config.json')}`, rollback: 'r' },
    { tool: 'git', action: 'upgrade', cmd: 'winget install --id Git.Git -e', rollback: 'winget uninstall --id Git.Git' }]);
  const data = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fk-ps-')), 'steps.json');
  fs.writeFileSync(data, JSON.stringify(steps));
  const file = path.join(REPO, 'install', 'install.ps1');
  const ps = `$ast = [System.Management.Automation.Language.Parser]::ParseFile('${file}', [ref]$null, [ref]$null); `
    + "foreach ($f in $ast.FindAll({ $args[0] -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $args[0].Name -in 'ConvertTo-Tilde', 'Get-LedgerMeta' }, $false)) { . ([scriptblock]::Create($f.Extent.Text)) }; "
    + `$out = foreach ($s in (Get-Content -Raw '${data}' | ConvertFrom-Json)) { Get-LedgerMeta $s.tool $s.action $s.cmd $s.rollback | ConvertTo-Json -Compress }; '[' + ($out -join ',') + ']'`;
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  const got = JSON.parse(r.stdout);
  steps.forEach((s, i) => {
    const m = describe({ tool: s.tool, action: s.action, cmd: s.cmd, rollback: s.rollback, fn: s.fn }, 'win');
    for (const k of ['item', 'kind', 'how', 'scope', 'undo', 'paths', 'file']) assert.deepEqual(got[i][k] ?? null, m[k] ?? null, `${k} of ${s.cmd.slice(0, 60)}`);
  });
  fs.rmSync(path.dirname(data), { recursive: true, force: true });
  const src = fs.readFileSync(file, 'utf8');
  assert.match(src, /\$meta = Get-LedgerMeta \$tool \$step\.action \$step\.cmd \$step\.rollback/);
  assert.match(src, /Write-Found \$rows\r?\n\s+foreach \(\$r in \$todo\)/, 'pre-existing recorded before the first step');
});

// ---------- B. fk uninstall --system ----------
const ROWS = [
  { tool: 'git', item: 'git', kind: 'pre-existing', ok: true },
  { tool: 'uv', item: 'uv', kind: 'installed', how: 'script', scope: 'user', undo: 'remove ~/.local/bin/uv ~/.local/bin/uvx', paths: ['~/.local/bin/uv', '~/.local/bin/uvx'], ok: true },
  { tool: 'gitleaks', item: 'gitleaks', kind: 'installed', how: 'winget', scope: 'user', undo: 'winget uninstall --id Gitleaks.Gitleaks -e', ok: true },
  { tool: 'mise', item: 'mise', kind: 'installed', how: 'winget', scope: 'user', undo: 'winget uninstall --id jdx.mise -e', ok: true },
  { tool: 'just', item: 'just', kind: 'installed', how: 'mise', scope: 'user', undo: 'mise unuse -g just', ok: true },
  { tool: 'mempalace', item: 'mempalace', kind: 'installed', how: 'uv', scope: 'user', undo: 'uv tool uninstall mempalace', ok: true },
  { tool: 'oh-my-claudecode', item: 'oh-my-claudecode:plugin', kind: 'installed', how: 'claude plugin', undo: 'claude plugin uninstall oh-my-claudecode@omc', ok: true },
  { tool: 'oh-my-claudecode', item: 'oh-my-claudecode:marketplace', kind: 'installed', how: 'claude plugin', undo: 'claude plugin marketplace remove omc', ok: true },
  { tool: 'mempalace', item: 'mempalace:plugin', kind: 'pre-existing', ok: true },
  { tool: 'git-lfs', item: 'git-lfs:config', kind: 'configured', how: 'git config', undo: 'git lfs uninstall', ok: true },
  { tool: 'codebase-memory-mcp', item: 'codebase-memory-mcp:auto_index', kind: 'configured', how: 'codebase-memory-mcp config', undo: 'codebase-memory-mcp config set auto_index true', value: 'false', ok: true },
  { tool: 'podman', item: 'podman:machine', kind: 'configured', how: 'podman machine', undo: 'podman machine rm -f podman-machine-default', name: 'podman-machine-default', ok: true },
  { tool: 'mempalace', item: 'mempalace:palace', kind: 'data', how: 'mempalace init', undo: 'delete the folder ~/.fk/palace-home', paths: ['~/.fk/palace-home'], ok: true },
  { tool: 'node', item: 'node', kind: 'pre-existing', ok: true },
];
const KIT_REG = reg(['founder-kit@awesome-founder-kit', 'fk-practice-web@awesome-founder-kit', 'mempalace@mempalace', 'oh-my-claudecode@omc', 'someone-else@other']);
const KIT_MKT = { 'awesome-founder-kit': { source: { source: 'github', repo: 'owner/awesome-founder-kit' } }, omc: {}, mempalace: {} };

// Runs fk uninstall --system with fakes: present() is a set the recording exec shrinks (fail: commands that "fail").
async function system(args, { rows = ROWS, answers = [], tty = false, fail = [], projects = [], gone = [], fkFail = [], home } = {}) {
  fs.mkdirSync(path.join(process.env.FK_HOME, 'palace-home'), { recursive: true }); // the palace the ledger names
  fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true }); // uv, installed by its script at these paths
  if (!gone.includes('uv')) for (const f of ['uv', 'uvx']) fs.writeFileSync(path.join(home, '.local', 'bin', f), 'x');
  const { items } = buildItems({ rows, home, src: SRC });
  const onDisk = (it) => !it.paths || it.paths.some((p) => fs.existsSync(untilde(p, home)));
  const left = new Set(items.map((it) => it.id).filter((id) => !gone.includes(id)));
  const ran = [];
  const o = lines();
  const code = await runSystemUninstall(args, {
    out: o.out, rows, src: SRC, home, isTTY: tty, projects: () => projects, cbmList: () => [],
    ask: tty ? async () => answers.shift() ?? '' : undefined,
    present: (it) => left.has(it.id) && onDisk(it),
    exec: ({ cmd }) => { ran.push(cmd); const it = items.find((x) => x.undo === cmd); if (it && !fail.includes(it.id)) left.delete(it.id); return { ok: true }; },
    // The kit's own CLI in a project: recorded in the same order as the removals ("fk <args> @<project folder name>").
    runFk: (a, cwd) => { const c = `fk ${a.join(' ')} @${path.basename(cwd)}`; ran.push(c); return { ok: !fkFail.includes(c), tail: fkFail.includes(c) ? 'boom' : '' }; },
  });
  // Path-based removals happen in-process (fs.rm): reflect them for the fake presence.
  return { code, out: o.text(), ran, left };
}

test('B: plan groups: installed and settings preselected, data not; never pre-existing, never foreign plugins; dry run changes nothing', () => withHome(async (home) => {
  const r = await system(['--system', '--dry-run'], { home });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.ran, []);
  const inst = r.out.indexOf('Installed by Founder Kit'), set = r.out.indexOf('Settings Founder Kit changed'), data = r.out.indexOf('Data Founder Kit created');
  assert.ok(inst >= 0 && inst < set && set < data, r.out);
  const line = (id) => r.out.split('\n').find((l) => l.endsWith(`id: ${id}`)) || '';
  for (const id of ['founder-kit:plugin', 'fk-practice-web:plugin', 'founder-kit:marketplace', 'oh-my-claudecode:plugin', 'uv', 'gitleaks', 'just', 'git-lfs:config', 'podman:machine']) assert.match(line(id), /\[x\]/, id);
  for (const id of ['mempalace:palace', 'fk-home']) assert.match(line(id), /\[ \]/, `${id}: data is not preselected`);
  for (const id of ['git', 'node', 'mempalace:plugin', 'someone-else']) assert.equal(line(id), '', `${id} is never listed`);
  assert.match(r.out, /Dry run: nothing was changed/);
}, { plugins: KIT_REG, marketplaces: KIT_MKT }));

test('B: removal order: kit plugins, kit marketplace, OMC, settings, machine, tools newest first (mise after just), data last; ledger marks removed', () => withHome(async (home) => {
  const r = await system(['--system', '--yes', '--only', 'founder-kit,fk-practice-web,oh-my-claudecode,git-lfs,podman,just,mise,gitleaks,uv,mempalace'], { home });
  assert.equal(r.code, 0, r.out);
  const order = ['claude plugin uninstall founder-kit@awesome-founder-kit', 'claude plugin uninstall fk-practice-web@awesome-founder-kit', 'claude plugin marketplace remove awesome-founder-kit',
    'claude plugin uninstall oh-my-claudecode@omc', 'claude plugin marketplace remove omc', 'git lfs uninstall', 'podman machine rm -f podman-machine-default',
    'winget uninstall --id Gitleaks.Gitleaks -e', 'uv tool uninstall mempalace', 'mise unuse -g just', 'winget uninstall --id jdx.mise -e'];
  assert.deepEqual(r.ran, order);
  assert.equal(fs.existsSync(path.join(home, '.local', 'bin', 'uv')), false, 'script install removed at its recorded path');
  assert.equal(fs.existsSync(path.join(home, '.local', 'bin', 'uvx')), false);
  const removed = readLedger().filter((e) => e.kind === 'removed').map((e) => e.item);
  assert.ok(removed.includes('gitleaks') && removed.includes('founder-kit:plugin'), removed.join(','));
  assert.equal(itemStates([...ROWS, ...readLedger()]).get('gitleaks').state, 'removed');
}, { plugins: KIT_REG, marketplaces: KIT_MKT }));

test('B: --plugin-only, --keep and --only; unknown ids are refused', () => withHome(async (home) => {
  const p = await system(['--system', '--yes', '--plugin-only'], { home });
  assert.deepEqual(p.ran, ['claude plugin uninstall founder-kit@awesome-founder-kit', 'claude plugin uninstall fk-practice-web@awesome-founder-kit', 'claude plugin marketplace remove awesome-founder-kit']);
  const k = await system(['--system', '--yes', '--keep', 'oh-my-claudecode,podman:machine,gitleaks'], { home });
  assert.ok(!k.ran.some((c) => /omc|podman machine|Gitleaks/.test(c)), k.ran.join('\n'));
  assert.ok(k.ran.includes('mise unuse -g just'));
  assert.ok(fs.existsSync(path.join(process.env.FK_HOME, 'palace-home')) && fs.existsSync(process.env.FK_HOME), 'data stays unless chosen');
  const o = await system(['--system', '--yes', '--only', 'mempalace:palace'], { home });
  assert.deepEqual(o.ran, [], 'the palace is a folder, removed in-process');
  assert.match(o.out, /MemPalace memory store/);
  const bad = await system(['--system', '--yes', '--only', 'nope'], { home });
  assert.equal(bad.code, 2);
  assert.match(bad.out, /unknown id\(s\): nope/);
}, { plugins: KIT_REG, marketplaces: KIT_MKT }));

test('B: interactive: numbers toggle, a/n/p, Enter; one final yes; the Podman machine asks separately', () => withHome(async (home) => {
  // p = plugin only, then add item 1 back off and on (toggle twice), Enter, then the final yes.
  const r = await system(['--system'], { home, tty: true, answers: ['p', '1', '1', '', 'y'] });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.ran, ['claude plugin uninstall founder-kit@awesome-founder-kit', 'claude plugin uninstall fk-practice-web@awesome-founder-kit', 'claude plugin marketplace remove awesome-founder-kit']);
  assert.match(r.out, /a = all, n = none, p = the Founder Kit plugin only/);
  const none = await system(['--system'], { home, tty: true, answers: ['n', ''] });
  assert.match(none.out, /Nothing selected; nothing was changed/);
  assert.deepEqual(none.ran, []);
  const no = await system(['--system'], { home, tty: true, answers: ['', 'n', 'n'] });
  assert.ok(!no.ran.length && /Nothing was changed/.test(no.out), 'machine kept, then a no at the final question');
  const keepMachine = await system(['--system'], { home, tty: true, answers: ['', 'n', 'y'] });
  assert.ok(!keepMachine.ran.some((c) => /podman machine rm/.test(c)), 'the machine is removed only on its own yes');
  assert.ok(keepMachine.ran.includes('git lfs uninstall'));
  const nonTty = await system(['--system'], { home });
  assert.equal(nonTty.code, 1);
  assert.deepEqual(nonTty.ran, []);
  assert.match(nonTty.out, /fk uninstall --system --yes/);
}, { plugins: KIT_REG, marketplaces: KIT_MKT }));

test('B: Podman machine only when the kit created it; items already gone are skipped', () => withHome(async (home) => {
  const rows = ROWS.map((r) => (r.item === 'podman:machine' ? { ...r, kind: 'pre-existing' } : r));
  const r = await system(['--system', '--dry-run'], { home, rows, gone: ['gitleaks'] });
  assert.doesNotMatch(r.out, /podman:machine/);
  assert.doesNotMatch(r.out, /id: gitleaks/, 'already gone: not listed');
}, { plugins: KIT_REG, marketplaces: KIT_MKT }));

test('B: a failed removal is reported with the manual command, not retried; the rest continues; exit 1', () => withHome(async (home) => {
  const r = await system(['--system', '--yes', '--only', 'gitleaks,just'], { home, fail: ['gitleaks'] });
  assert.equal(r.code, 1);
  assert.deepEqual(r.ran, ['winget uninstall --id Gitleaks.Gitleaks -e', 'mise unuse -g just'], 'no retry');
  assert.match(r.out, /could not remove it\. To do it yourself: winget uninstall --id Gitleaks\.Gitleaks -e/);
  assert.match(r.out, /Removed 1 of 2/);
}, { plugins: KIT_REG, marketplaces: KIT_MKT }));

test('B: kit projects still set up are named before and after; the kit folder goes last', () => withHome(async (home) => {
  const proj = path.join(home, 'app');
  fs.mkdirSync(path.join(proj, '.fk'), { recursive: true });
  fs.mkdirSync(process.env.FK_HOME, { recursive: true });
  // a = all, Enter, machine yes, skip the project's fk uninstall, final yes.
  const r = await system(['--system'], { home, tty: true, projects: [proj], answers: ['a', '', 'y', 's', 'y'] });
  assert.match(r.out, /Projects set up for the kit[^\n]*\n\s+\S*app\n[\s\S]*comes out with: fk uninstall, in that project/);
  assert.ok(!r.ran.some((c) => c.startsWith('fk ')), 'skipped: no project step ran');
  assert.match(r.out, /Projects still set up for the kit \(their \.fk\/ folder\): .*app/);
  assert.equal(fs.existsSync(process.env.FK_HOME), false, 'the kit folder was chosen and removed');
  assert.ok(r.out.lastIndexOf('The kit\'s own folder') > r.out.lastIndexOf('MemPalace memory store'), 'last');
}, { plugins: KIT_REG, marketplaces: KIT_MKT }));

// A kit project with a fk provision ledger: game-mcp still installed, old-cli rolled back, unity-skill installed.
function provisionedProject(home, name, lines = [
  { kind: 'install', name: 'game-mcp', version: '1.2.0' }, { kind: 'install', name: 'old-cli' },
  { kind: 'rollback', name: 'old-cli' }, { kind: 'install', name: 'unity-skill' }]) {
  const proj = path.join(home, name);
  fs.mkdirSync(path.join(proj, '.fk'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.fk', 'ledger.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\nnot json\n');
  return proj;
}

test('B: kit projects: provisioned tools listed from the project ledger; rollbacks then fk uninstall per project, before any removal', () => withHome(async (home) => {
  const a = provisionedProject(home, 'game'), b = provisionedProject(home, 'sensor', [{ kind: 'install', name: 'pio' }]);
  const dry = await system(['--system', '--dry-run'], { home, projects: [a, b] });
  assert.match(dry.out, /Tools added with fk provision: game-mcp 1\.2\.0, unity-skill \(each comes back out with: fk provision rollback <name>, in that project\)/);
  assert.doesNotMatch(dry.out, /old-cli/, 'a rolled-back tool is not listed');
  assert.match(dry.out, /add --rollbacks to roll the tools above back; add --projects to run fk uninstall in each project/);
  assert.deepEqual(dry.ran, []);
  // Plugin only; game: roll back yes, uninstall yes; sensor: roll back skip, uninstall yes; final yes.
  const r = await system(['--system'], { home, tty: true, projects: [a, b], answers: ['p', '', 'y', 'y', 's', 'y', 'y'] });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.ran, ['fk provision rollback game-mcp @game', 'fk provision rollback unity-skill @game', 'fk uninstall @game', 'fk uninstall @sensor',
    'claude plugin uninstall founder-kit@awesome-founder-kit', 'claude plugin uninstall fk-practice-web@awesome-founder-kit', 'claude plugin marketplace remove awesome-founder-kit']);
  // a = yes for every project (asked once per question), n = no for every project.
  const all = await system(['--system'], { home, tty: true, projects: [a, b], answers: ['p', '', 'a', 'n', 'y'] });
  assert.deepEqual(all.ran.filter((c) => c.startsWith('fk ')), ['fk provision rollback game-mcp @game', 'fk provision rollback unity-skill @game', 'fk provision rollback pio @sensor']);
  // A final no runs nothing, project steps included.
  const no = await system(['--system'], { home, tty: true, projects: [a, b], answers: ['p', '', 'a', 'a', 'n'] });
  assert.deepEqual(no.ran, []);
  // Not offered when the kit plugin stays.
  const keep = await system(['--system'], { home, tty: true, projects: [a], answers: ['n', '4', '', 'y'] });
  assert.deepEqual(keep.ran, ['claude plugin uninstall oh-my-claudecode@omc'], keep.out);
  assert.doesNotMatch(keep.out, /Roll back the tools/);
}, { plugins: KIT_REG, marketplaces: KIT_MKT }));

test('B: kit projects with --yes: only on --rollbacks / --projects; a failed rollback keeps that project\'s kit setup; unreadable ledger is said', () => withHome(async (home) => {
  const a = provisionedProject(home, 'game');
  const plain = await system(['--system', '--yes', '--plugin-only'], { home, projects: [a] });
  assert.ok(!plain.ran.some((c) => c.startsWith('fk ')), 'no project step without the flags');
  const both = await system(['--system', '--yes', '--plugin-only', '--rollbacks', '--projects'], { home, projects: [a], fkFail: ['fk provision rollback game-mcp @game'] });
  assert.deepEqual(both.ran.filter((c) => c.startsWith('fk ')), ['fk provision rollback game-mcp @game', 'fk provision rollback unity-skill @game'], 'no fk uninstall after a failed rollback');
  assert.match(both.out, /could not roll it back \(boom\)\. In that project, run: fk provision rollback game-mcp/);
  assert.match(both.out, /the kit stays in this project, because a rollback failed/);
  assert.equal(both.code, 1);
  assert.ok(both.ran.includes('claude plugin uninstall founder-kit@awesome-founder-kit'), 'the chosen removals still run');
  const c = path.join(home, 'podcast');
  fs.mkdirSync(path.join(c, '.fk', 'ledger.jsonl'), { recursive: true }); // a folder where the file should be: unreadable
  const un = await system(['--system', '--dry-run'], { home, projects: [c] });
  assert.match(un.out, /their list \(\.fk\/ledger\.jsonl\) could not be read\. In that project, fk provision rollback <name>/);
}, { plugins: KIT_REG, marketplaces: KIT_MKT }));

test('B: refuses in an agent shell (CLI, both installers); gate-guard hard-stops every form from an agent shell', () => {
  const r = spawnSync(process.execPath, [FK, 'uninstall', '--system', '--dry-run'], { encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_CHILD_SESSION: '1' } });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /fk uninstall --system: refused: only you can take the kit out/);
  for (const cmd of ['fk uninstall --system', 'fk uninstall --system --yes --plugin-only', 'node "/x/founder-kit/bin/fk.mjs" uninstall --system',
    'bash install/install.sh --uninstall', 'curl -fsSL https://raw.githubusercontent.com/o/r/main/install/install.sh | bash -s -- --uninstall --yes',
    'FK_UNINSTALL=1 bash ./install.sh', 'powershell -File .\\install\\install.ps1 -Uninstall', "$env:FK_UNINSTALL='1'; irm https://x/install/install.ps1 | iex",
    "& ([scriptblock]::Create((irm https://x/install/install.ps1))) -Uninstall -Yes", 'sh -c "./install.sh --uninstall"']) {
    const d = gate.check({ root: os.tmpdir(), input: {}, tool: 'Bash', ti: { command: cmd } });
    assert.equal(d?.decision, 'deny', cmd);
    assert.equal(d.noOverride, true, `${cmd}: hard stop`);
  }
  for (const cmd of ['git commit -m "docs: install.sh --uninstall and fk uninstall --system"', 'bash install/install.sh --dry-run', 'fk update --dry-run', 'fk update --yes', 'cat install/install.ps1']) {
    assert.equal(gate.check({ root: os.tmpdir(), input: {}, tool: 'Bash', ti: { command: cmd } })?.decision === 'deny', false, cmd);
  }
});

test('B: install.sh --uninstall refuses in an agent shell; otherwise hands over to fk uninstall --system (dry run, sandboxed)', { skip: !gitBash && 'bash not found' }, () => {
  const b = shBox({ node: true, plugins: { 'founder-kit@awesome-founder-kit': [{ scope: 'user', installPath: KIT, version: '0.7.0' }] } });
  try {
    const refused = shRun(b, ['--uninstall'], { CLAUDE_CODE_CHILD_SESSION: '1' });
    assert.equal(refused.status, 1);
    assert.match(refused.stdout, /refused: only you can take the kit out/);
    fs.mkdirSync(path.join(b.home, '.fk'), { recursive: true });
    fs.writeFileSync(b.ledger, JSON.stringify({ tool: 'gitleaks', item: 'gitleaks', kind: 'installed', how: 'script', undo: 'remove ~/.local/bin/gitleaks', paths: ['~/.local/bin/gitleaks'], ok: true }) + '\n');
    fs.mkdirSync(path.join(b.home, '.local', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(b.home, '.local', 'bin', 'gitleaks'), 'x');
    const r = founderRun(rawBash, [path.join(REPO, 'install', 'install.sh'), '--uninstall', '--dry-run'], { cwd: b.root, env: { ...b.env, FK_HOME: path.join(b.home, '.fk') } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Founder Kit plugin \(founder-kit\)/);
    assert.match(r.stdout, /gitleaks.*removes ~\/\.local\/bin\/gitleaks/);
    assert.match(r.stdout, /Dry run: nothing was changed/);
    assert.equal(fs.existsSync(path.join(b.home, '.local', 'bin', 'gitleaks')), true);
    // Without Node.js or the plugin: the recorded undo commands are listed, nothing is removed.
    fs.rmSync(path.join(b.bin, 'node'));
    const f = shRun(b, ['--uninstall'], { FK_HOME: path.join(b.home, '.fk') });
    assert.equal(f.status, 0, f.stdout + f.stderr);
    assert.match(f.stdout, /nothing was removed/);
    assert.match(f.stdout, /gitleaks: remove ~\/\.local\/bin\/gitleaks/);
  } finally { b.cleanup(); }
});

test('B: install.ps1 -Uninstall refuses in an agent shell before reading anything', { skip: !WIN && 'Windows only' }, () => {
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(REPO, 'install', 'install.ps1'), '-Uninstall', '-DryRun'],
    { encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_CHILD_SESSION: '1' } });
  assert.match(r.stdout, /refused: only you can take the kit out/);
  assert.doesNotMatch(r.stdout, /Founder Kit setup|Installed by Founder Kit/);
});

// ---------- C. updates ----------
const CHANGELOG = '# Changelog\n\nintro\n\n## v0.9.0 (2026-12-01)\n\nNine.\nMore nine.\n\n## v0.8.0 (2026-11-01)\n\nEight.\n\n## v0.7.0 (2026-10-14)\n\nSeven.\n';
function fakeNet({ tag = 'v0.9.0', offline = false, calls = [] } = {}) {
  return async (url) => {
    calls.push(url);
    if (offline) throw new Error('offline');
    const json = (body, ok = true) => ({ ok, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
    if (url.endsWith('/releases/latest')) return json({ message: 'Not Found' }, false);
    if (url.includes('/tags')) return json([{ name: 'v0.7.0' }, { name: tag }, { name: 'founder-kit--v9.9.9' }, { name: 'v0.8.0' }]);
    if (url.endsWith('CHANGELOG.md')) return json(CHANGELOG);
    if (url.endsWith('compat.lock.json')) return json({ tools: { ...LOCK.tools, node: { ...LOCK.tools.node, version: '24.22.0' } } });
    return json({}, false);
  };
}

test('C: latest version: tags when there is no release, cached 24 h, offline is silent', () => withHome(async () => {
  const calls = [];
  const now = Date.parse('2026-12-02T10:00:00Z');
  assert.equal(await fetchKitLatest({ fetch: fakeNet({ calls }), repo: 'o/r', now }), '0.9.0');
  assert.equal(calls.length, 2, 'releases, then tags');
  assert.equal(await fetchKitLatest({ fetch: fakeNet({ calls }), repo: 'o/r', now: now + 3600e3 }), '0.9.0');
  assert.equal(calls.length, 2, 'cached for a day');
  assert.equal(kitLatestCached(now + 3600e3).stale, false);
  assert.equal(kitLatestCached(now + 25 * 3600e3).stale, true);
  assert.equal(await fetchKitLatest({ fetch: fakeNet({ offline: true }), repo: 'o/r', now: now + 25 * 3600e3 }), '0.9.0', 'offline: the cached value, no error');
  fs.rmSync(path.join(process.env.FK_HOME, 'state', 'fk-latest.json'));
  assert.equal(await fetchKitLatest({ fetch: fakeNet({ offline: true }), repo: 'o/r', now }), null);
  // AbortSignal.timeout does not keep the process alive; the fake holds a timer until the abort.
  const slow = async (url, { signal }) => new Promise((res, rej) => { const t = setTimeout(() => {}, 10000); signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('timeout')); }); });
  const t0 = Date.now();
  assert.equal(await fetchKitLatest({ fetch: slow, repo: 'o/r', now, force: true }), null);
  assert.ok(Date.now() - t0 < 3500, 'gives up within about 2 s');
}));

test('C: changelog slice: entries after the installed version up to the target, newest first', () => {
  const e = parseChangelog(CHANGELOG);
  assert.deepEqual(e.map((x) => x.version), ['0.9.0', '0.8.0', '0.7.0']);
  assert.equal(e[0].body, 'Nine.\nMore nine.');
  assert.deepEqual(sliceChangelog(e, '0.7.0', '0.9.0').map((x) => x.version), ['0.9.0', '0.8.0']);
  assert.deepEqual(sliceChangelog(e, '0.7.0', '0.8.0').map((x) => x.version), ['0.8.0']);
  assert.deepEqual(sliceChangelog(e, '0.9.0', '0.9.0'), []);
});

async function update(args, extra = {}) {
  const o = lines();
  const ran = [], fk = [];
  const code = await runUpdate(args, { out: o.out, fetch: fakeNet(extra.net), src: SRC, current: '0.7.0', isTTY: false, env: { ...(extra.env || {}) },
    exec: (s) => { ran.push(s.cmd); return { ok: !extra.fail?.includes(s.cmd) }; },
    runFk: (cli, a) => { fk.push(a.join(' ')); return { code: 0, stdout: a[0] === 'setup' ? (extra.setupPlan ? 'Founder Kit base tools\n\nPlan (everything below is free and open source):\n  1. Update Node.js' : 'All base tools are ready.') : '' }; },
    installed: () => ({ path: null, version: extra.after || '0.9.0' }), ask: extra.ask, ...extra.deps });
  return { code, out: o.text(), ran, fk };
}

test('C: fk update --check and --dry-run: changelog, plan with exact plugin commands, pin changes; nothing runs', () => withHome(async () => {
  const c = await update(['--check']);
  assert.equal(c.code, 0);
  assert.match(c.out, /Founder Kit 0\.7\.0 is installed; 0\.9\.0 is the newest/);
  assert.match(c.out, /0\.9\.0 \(2026-12-01\): Nine\. More nine\.\n {2}0\.8\.0 \(2026-11-01\): Eight\./);
  assert.doesNotMatch(c.out, /Seven/);
  const d = await update(['--dry-run']);
  assert.equal(d.code, 0);
  assert.match(d.out, /> claude plugin marketplace update awesome-founder-kit\n\s+> claude plugin update founder-kit@awesome-founder-kit\n\s+> claude plugin update fk-practice-web@awesome-founder-kit/);
  assert.match(d.out, /pinned versions that change: node 24\.21\.0 -> 24\.22\.0/);
  assert.match(d.out, /fk setup --dry-run/);
  assert.match(d.out, /Dry run: nothing was changed/);
  assert.deepEqual([d.ran, d.fk], [[], []]);
}, { plugins: reg(['founder-kit@awesome-founder-kit', 'fk-practice-web@awesome-founder-kit']) }));

test('C: fk update: never a downgrade; up to date; an older --to prints the manual pin steps; offline says so', () => withHome(async () => {
  assert.match((await update([], { deps: { current: '0.9.0' } })).out, /Nothing to update/);
  const down = await update(['--to', '0.6.0']);
  assert.equal(down.code, 1);
  assert.match(down.out, /never goes back to an older version/);
  const pin = await update(['--to', '0.8.0']);
  assert.equal(pin.code, 0);
  assert.match(pin.out, /claude plugin marketplace remove awesome-founder-kit\n {2}claude plugin marketplace add owner\/awesome-founder-kit#v0\.8\.0\n {2}claude plugin install founder-kit@awesome-founder-kit/);
  assert.deepEqual(pin.ran, [], 'printed, never run');
  assert.match((await update(['--to', '1.0.0'])).out, /not published yet/);
  fs.rmSync(path.join(process.env.FK_HOME, 'state', 'fk-latest.json'), { force: true }); // nothing cached either
  const off = await update([], { net: { offline: true } });
  assert.equal(off.code, 1);
  assert.match(off.out, /could not reach GitHub/);
}));

test('C: fk update from an agent shell shows the plan and the founder\'s line; --yes needs that typed line (once); then it updates, checks tools, migrates, doctor', () => withHome(async (home) => {
  const proj = path.join(home, 'proj');
  fs.mkdirSync(path.join(proj, '.fk'), { recursive: true });
  const agent = { env: { CLAUDE_CODE_CHILD_SESSION: '1' } };
  const a = await update([], { ...agent, deps: { root: proj } });
  assert.equal(a.code, 0);
  assert.match(a.out, /the founder types this line alone as a message:\n {2}fk-approve update 0\.9\.0 <reason>\nThen run: fk update --yes/);
  assert.deepEqual(a.ran, []);
  // An agent claiming a yes is not one: --yes without the typed line changes nothing.
  const no = await update(['--yes'], { ...agent, deps: { root: proj } });
  assert.equal(no.code, 1);
  assert.match(no.out, /Nothing was changed: no founder-typed approval/);
  assert.deepEqual([no.ran, no.fk], [[], []]);
  // A line for another version, or one pasted inside other text, approves nothing.
  const hook = (prompt) => runHook(proj, 'UserPromptSubmit', { session_id: 'S1', prompt }, { FK_HOME: process.env.FK_HOME, HOME: home, USERPROFILE: home });
  hook('fk-approve update 0.8.0 wrong version');
  hook('the agent wrote:\nfk-approve update 0.9.0 go');
  assert.equal((await update(['--yes'], { ...agent, deps: { root: proj } })).code, 1);
  hook('fk-approve update 0.9.0 read the changelog, go');
  const y = await update(['--yes'], { ...agent, setupPlan: true, deps: { root: proj } });
  assert.equal(y.code, 0, y.out);
  assert.deepEqual(y.ran, ['claude plugin marketplace update awesome-founder-kit', 'claude plugin update founder-kit@awesome-founder-kit']);
  assert.deepEqual(y.fk, ['setup --dry-run', 'update --migrate', 'doctor'], 'setup changes wait for the founder');
  assert.match(y.out, /Ask the founder \(AskUserQuestion\); after a yes run: fk setup --yes/);
  assert.match(y.out, /Restart Claude Code to load the new version/);
  assert.equal((await update(['--yes'], { ...agent, deps: { root: proj } })).code, 1, 'the typed line is used once');
  const t = await update([], { deps: { isTTY: true }, ask: async () => true, setupPlan: true });
  assert.deepEqual(t.fk, ['setup --dry-run', 'setup --yes', 'update --migrate', 'doctor'], 'terminal: one more yes, then setup');
  const f = await update(['--yes'], { fail: ['claude plugin update founder-kit@awesome-founder-kit'] });
  assert.equal(f.code, 1);
  assert.match(f.out, /failed\. Nothing after this step was run\. Run it yourself to see why: claude plugin update founder-kit@awesome-founder-kit/);
  assert.deepEqual(f.fk, []);
  const stuck = await update(['--yes'], { after: '0.7.0' });
  assert.equal(stuck.code, 1);
  assert.match(stuck.out, /still reports 0\.7\.0/);
}, { plugins: reg(['founder-kit@awesome-founder-kit']) }));

test('C: migrations are idempotent; a project folder is needed for v1; fk init records it; kit projects are listed', () => withHome(async (home) => {
  const dir = path.join(process.env.FK_HOME, 'state', '0123456789abcdef');
  fs.mkdirSync(dir, { recursive: true });
  assert.deepEqual(migrateAll().map((r) => r.to), [0], 'no project folder known yet: stays at 0');
  const proj = path.join(home, 'proj');
  fs.mkdirSync(path.join(proj, '.fk'), { recursive: true });
  const first = migrateDir(dir, proj);
  assert.deepEqual([first.from, first.to, first.ran.length], [0, STATE_VERSION, STATE_VERSION]);
  const snap = fs.readFileSync(path.join(dir, 'state.json'), 'utf8');
  const second = migrateDir(dir, proj);
  assert.deepEqual([second.ran.length, fs.readFileSync(path.join(dir, 'state.json'), 'utf8')], [0, snap], 'second run changes nothing');
  assert.deepEqual(migrateAll().map((r) => r.ran.length), [0]);
  assert.deepEqual(kitProjects(), [path.resolve(proj)]);
  fs.rmSync(path.join(proj, '.fk'), { recursive: true });
  assert.deepEqual(kitProjects(), [], 'a project without .fk/ is not listed');
  // fk init writes the record; the SessionStart migration step leaves an up-to-date project alone.
  const repo = path.join(home, 'repo');
  fs.mkdirSync(repo);
  spawnSync('git', ['init', '-q'], { cwd: repo });
  const env = { ...process.env, FK_HOME: process.env.FK_HOME, HOME: home, USERPROFILE: home };
  assert.equal(spawnSync(process.execPath, [FK, 'init'], { cwd: repo, env, encoding: 'utf8' }).status, 0);
  assert.ok(kitProjects().some((p) => fs.realpathSync.native(p) === fs.realpathSync.native(repo)), 'fk init records the project');
}));

test('C: session note: cache only, at most once a day, quiet when current or unknown', () => withHome(async () => {
  const { writeKitCache } = await import('../bin/cmd/update/release.mjs');
  const day = Date.parse('2026-12-02T08:00:00Z');
  assert.equal(kitUpdateNote({ now: day, refresh: false }), undefined, 'nothing cached: quiet');
  writeKitCache({ latest: '9.0.0', ts: day });
  const note = kitUpdateNote({ now: day, refresh: false });
  assert.match(note, /Founder Kit 9\.0\.0 is available \(you have \d+\.\d+\.\d+\): ask the founder whether to run fk update/);
  assert.equal(kitUpdateNote({ now: day + 3600e3, refresh: false }), undefined, 'same day: quiet');
  assert.match(kitUpdateNote({ now: day + 25 * 3600e3, refresh: false }), /9\.0\.0 is available/, 'next day: once more');
  writeKitCache({ latest: '0.0.1', notified: 0 });
  assert.equal(kitUpdateNote({ now: day + 50 * 3600e3, refresh: false }), undefined, 'not newer: quiet');
}));

// The release script is private (never exported): in the public tree this test is skipped.
const EXPORT_SH = path.join(REPO, 'scripts', 'export-public.sh');
test('C: export-public.sh: CHANGELOG.md is exported, the entry is written once from --notes/FK_RELEASE_NOTES, the tag is v<version>', { skip: !gitBash ? 'bash not found' : !fs.existsSync(EXPORT_SH) && 'release script is private (not in the public tree)' }, () => {
  const src = fs.readFileSync(EXPORT_SH, 'utf8');
  assert.match(src, /PUBLIC=\([^)]*CHANGELOG\.md/);
  assert.match(src, /git tag -a "\$TAG"/);
  assert.match(src, /git push origin "\$TAG"/);
  assert.match(src, /cp "\$LOG" "\$OUT\/CHANGELOG\.md"\n.*\n\n# Privacy scan/, 'copied before the privacy scan');
  // The changelog block, run on its own against a temp file.
  const block = src.slice(src.indexOf('LOG="$ROOT/CHANGELOG.md"'), src.indexOf('rm -rf "$OUT"'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-rel-'));
  const script = path.join(dir, 'block.sh');
  fs.writeFileSync(script, `set -euo pipefail\nROOT="$1"; TAG=v0.8.0; NOTES="\${FK_RELEASE_NOTES:-}"\n${block}\nprintf '%s' "$TAG_TEXT" > "$ROOT/tag.txt"\n`);
  const run = (env) => spawnSync(gitBash, [script, dir], { encoding: 'utf8', env: { ...process.env, ...env }, input: '' });
  try {
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), CHANGELOG.replace(/## v0\.9\.0[\s\S]*?## v0\.8\.0[\s\S]*?(?=## v0\.7)/, ''));
    const r = run({ FK_RELEASE_NOTES: 'Plain words about eight.' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const log = fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');
    assert.match(log, /intro\n\n## v0\.8\.0 \(\d{4}-\d{2}-\d{2}\)\n\nPlain words about eight\.\n\n## v0\.7\.0/);
    assert.equal(fs.readFileSync(path.join(dir, 'tag.txt'), 'utf8').trim(), 'Plain words about eight.');
    run({ FK_RELEASE_NOTES: 'Again.' });
    assert.equal(fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8'), log, 'written once');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D: README has short Updating and Uninstalling sections', () => {
  const md = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
  for (const h of ['## Updating', '## Uninstalling']) {
    const at = md.indexOf(h);
    assert.ok(at >= 0, h);
    const body = md.slice(at + h.length, md.indexOf('\n## ', at + h.length)).trim().split('\n').filter(Boolean);
    assert.ok(body.length <= 10, `${h}: ${body.length} lines`);
  }
});
