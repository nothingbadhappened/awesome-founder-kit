// fk setup, the base-tools session note and the install scripts. No network, no real installs:
// tools are fake binaries on a private PATH, home is a temp folder, installs go through a recording exec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cmpVer } from '../hooks/lib.mjs';

const KIT = path.join(import.meta.dirname, '..');
const REPO = path.join(KIT, '..', '..');
const LOCK = JSON.parse(fs.readFileSync(path.join(KIT, 'compat.lock.json'), 'utf8'));
const WIN = process.platform === 'win32';
const NATIVE_CONTAINERS = !WIN && process.platform !== 'darwin'; // Linux: Podman runs natively, no machine
const { runSetup } = await import('../bin/cmd/setup.mjs');
const { TOOLS } = await import('../bin/cmd/setup/core.mjs');
const { default: baseToolsNote } = await import('../hooks/session/10-base-tools.mjs');

const PRESENT = {
  git: 'git version 2.55.0', node: 'v24.21.0', uv: 'uv 0.13.0', claude: '2.1.296 (Claude Code)', gh: 'gh version 2.102.0',
  'codebase-memory-mcp': 'codebase-memory-mcp 0.11.0', mempalace: 'MemPalace 3.10.0', skillspector: 'SkillSpector v2.12.0', gitleaks: '8.30.1',
  'git-lfs': 'git-lfs/3.8.0 (GitHub; linux amd64)', mise: '2026.9.18 linux-x64', just: 'just 1.58.0', podman: 'podman version 5.8.3',
  'podman-compose': 'podman-compose version 1.6.0', wsl: 'Default Version: 2',
};
const BIN_OF = { 'claude-code': 'claude' };
// Answers for specific leading arguments; null = fail. Anything else prints the version text.
const MACHINE_OFF = { 'machine list': '[{"Name":"podman-machine-default","Running":false}]' };
const MACHINE_ON = { 'machine list': '[{"Name":"podman-machine-default","Running":true}]' };
const NO_MACHINE = { 'machine list': '[]' };
const NO_LFS = { config: null }; // git config --global --get filter.lfs.process: not set

function fakeBin(dir, name, text, cbmConfig = 'false', answers = {}) {
  const all = { ...(name === 'codebase-memory-mcp' ? { config: cbmConfig } : {}), ...(name === 'podman' ? MACHINE_OFF : {}), ...answers };
  const words = (k) => k.split(' ');
  if (WIN) {
    const ifs = Object.entries(all).map(([k, v]) => `@if "${words(k).map((_, i) => `%~${i + 1}`).join(' ')}"=="${k}" (${v === null ? 'exit /b 1' : `echo ${v}& exit /b 0`})\r\n`).join('');
    fs.writeFileSync(path.join(dir, `${name}.cmd`), `@echo off\r\n${ifs}echo ${text}\r\n`);
  } else {
    const ifs = Object.entries(all).map(([k, v]) => `[ "${words(k).map((_, i) => `$${i + 1}`).join(' ')}" = '${k}' ] && { ${v === null ? 'exit 1' : `echo '${v}'; exit 0`}; }\n`).join('');
    fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${ifs}echo "${text}"\n`, { mode: 0o755 });
  }
}

// A sandbox: fake home (plugins registry, MemPalace config) and a PATH with only the given fake tools.
function sandbox({ tools = {}, plugins = [], marketplaces = [], palace = false, mpConfig = null, cbmConfig = 'false', answers = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-setup-'));
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  const mp = path.join(home, '.config', 'mempalace');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
  for (const [name, text] of Object.entries(tools)) fakeBin(bin, name, text, cbmConfig, answers[name]);
  const reg = { version: 2, plugins: {} };
  for (const [key, version] of plugins) {
    const installPath = path.join(home, 'cache', key);
    fs.mkdirSync(path.join(installPath, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(installPath, '.claude-plugin', 'plugin.json'), JSON.stringify({ version }));
    reg.plugins[key] = [{ scope: 'user', installPath, version }];
  }
  fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify(reg));
  fs.writeFileSync(path.join(home, '.claude', 'plugins', 'known_marketplaces.json'),
    JSON.stringify(Object.fromEntries(marketplaces.map((repo) => [repo.split('/')[1], { source: { source: 'github', repo } }]))));
  if (palace) fs.mkdirSync(path.join(mp, 'palace'), { recursive: true });
  if (mpConfig) { fs.mkdirSync(mp, { recursive: true }); fs.writeFileSync(path.join(mp, 'config.json'), JSON.stringify(mpConfig)); }
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(path|mempal_dir|mempalace_config_dir|xdg_config_home|fk_home|gh_token|github_token|gh_config_dir|claude_code_child_session)$/i.test(k)));
  Object.assign(env, { PATH: bin, HOME: home, USERPROFILE: home, FK_OMC_LATEST: '5.7.2', GH_CONFIG_DIR: path.join(home, '.config', 'gh') });
  return { root, home, bin, env, fk: path.join(home, '.fk'), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const READY = {
  tools: PRESENT,
  plugins: [['oh-my-claudecode@omc', '5.7.2'], ['mempalace@mempalace', '3.10.0']],
  marketplaces: ['Yeachan-Heo/oh-my-claudecode', 'MemPalace/mempalace'],
  palace: true,
  mpConfig: { backend: 'sqlite_exact', hooks: { silent_save: true } },
};
const without = (...names) => Object.fromEntries(Object.entries(PRESENT).filter(([k]) => !names.includes(k)));

// Runs runSetup with HOME pointed at the sandbox (os.homedir() reads it per call).
async function setup(sb, args, extra = {}) {
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, FK_OMC_LATEST: process.env.FK_OMC_LATEST, FK_HOME: process.env.FK_HOME };
  Object.assign(process.env, { HOME: sb.home, USERPROFILE: sb.home, FK_OMC_LATEST: '5.7.2' });
  delete process.env.FK_HOME; // an inherited FK_HOME would move the sandbox's ~/.fk
  const lines = [];
  const ran = [];
  try {
    const code = await runSetup(args, {
      env: sb.env, out: (s = '') => lines.push(s), isTTY: false, cwd: sb.root, has: () => false, underClaude: () => false /* plays the founder's terminal */, userPath: (dir) => { sb.userPath = dir; return true; },
      exec: (step) => { ran.push(step); return extra.exec ? extra.exec(step) : { ok: true }; },
      ...extra.deps,
    });
    return { code, out: lines.join('\n').replace(/\x1b\[\d+m/g, ''), ran };
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}
// Base-tool steps the run took (pre-existing lines record what was already there; fk-shim lines the user-level fk command).
const readLedger = (sb) => readAll(sb).filter((e) => e.kind !== 'pre-existing' && e.tool !== 'fk-shim');
const readAll = (sb) => { try { return fs.readFileSync(path.join(sb.fk, 'install-ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const readStatus = (sb) => JSON.parse(fs.readFileSync(path.join(sb.fk, 'state', 'base-tools.json'), 'utf8'));

test('compat.lock.json pins every base tool and is dated', () => {
  assert.equal(LOCK.checked, '2026-10-14');
  for (const id of ['git', 'node', 'uv', 'claude-code', 'gh', 'oh-my-claudecode', 'codebase-memory-mcp', 'mempalace', 'skillspector', 'gitleaks', 'founder-kit']) {
    assert.ok(LOCK.tools[id], id);
    assert.match(LOCK.tools[id].version, /^\d+\.\d+\.\d+$/, `${id} version`);
  }
  assert.match(LOCK.tools.skillspector.commit, /^[0-9a-f]{40}$/);
  for (const [id, t] of Object.entries(LOCK.tools)) if (t.min) assert.ok(cmpVer(t.min, t.version) <= 0, `${id}: min <= version`);
});

test('dry run with nothing installed: core plan only, optional tools listed as optional; nothing executed or written', async () => {
  const sb = sandbox();
  try {
    const r = await setup(sb, ['--dry-run']);
    assert.equal(r.code, 1);
    assert.equal(r.ran.length, 0);
    assert.match(r.out, /Install git \(/);
    assert.match(r.out, /Install Node\.js/);
    assert.match(r.out, /Install Claude Code/);
    assert.match(r.out, /Install oh-my-claudecode/);
    assert.match(r.out, /Install gitleaks/, 'gitleaks is core: the secret guard needs it');
    assert.doesNotMatch(r.out, /Install (?:Git LFS|uv|mise|just|GitHub CLI|Containers|Compose|codebase-memory|MemPalace|SkillSpector)\b|mempalace init|config set auto_index/);
    assert.match(r.out, /optional\s+MemPalace\s+optional; proposed per project when it needs it/);
    assert.match(r.out, /fk setup --with <id>/);
    assert.equal(fs.existsSync(sb.fk), false, 'dry run writes nothing');
  } finally { sb.cleanup(); }
});

test('only the core tools present: no optional install steps, exit 0, no session note; --with mise adds mise; bad ids are refused', async () => {
  const sb = sandbox({ tools: { git: PRESENT.git, node: PRESENT.node, claude: PRESENT.claude, gitleaks: PRESENT.gitleaks }, plugins: [READY.plugins[0]], marketplaces: [READY.marketplaces[0]] });
  try {
    const r = await setup(sb, []);
    assert.equal(r.code, 0, r.out);
    assert.equal(r.ran.length, 0);
    assert.match(r.out, /All base tools are ready/);
    const st = readStatus(sb);
    for (const id of ['git', 'node', 'claude-code', 'oh-my-claudecode', 'gitleaks']) assert.equal(st.tools[id].level, 'green', id);
    for (const id of ['git-lfs', 'uv', 'mise', 'just', 'gh', 'podman', 'podman-compose', 'codebase-memory-mcp', 'mempalace', 'skillspector']) {
      assert.equal(st.tools[id].level, 'optional', id);
      assert.equal(st.tools[id].founder, undefined, `${id}: no founder step for a tool nobody asked for`);
    }
    assert.equal(withHome(sb.home, baseToolsNote), undefined, 'optional tools never trigger the session note');
    const m = await setup(sb, ['--dry-run', '--with', 'mise'], { deps: { os: 'linux', has: () => false } });
    assert.equal(m.code, 1);
    assert.deepEqual(steps(m.out), [`curl -fsSL https://mise.run | MISE_VERSION=v${T.mise.version} sh`]);
    const mp = await setup(sb, ['--dry-run', '--with', 'mempalace'], { deps: { os: 'linux' } });
    assert.match(mp.out, /Install uv[\s\S]*Install MemPalace/, 'MemPalace brings uv, which it installs with');
    // apt's gh is below the floor and just has no route without mise: on Linux both bring mise; Windows uses winget.
    const mise = `curl -fsSL https://mise.run | MISE_VERSION=v${T.mise.version} sh`;
    for (const [id, tail] of [['just', `mise use -g just@${T.just.version}`], ['gh', `mise use -g gh@${T.gh.version}`]]) {
      const l = await setup(sb, ['--dry-run', '--with', id], { deps: { os: 'linux', has: (b) => b === 'apt-get' } });
      assert.deepEqual(steps(l.out), [mise, tail], `linux --with ${id}`);
      const w = await setup(sb, ['--dry-run', '--with', id], { deps: { os: 'win', has: () => false } });
      assert.doesNotMatch(w.out, /Install mise/, `win --with ${id}: winget, no mise`);
    }
    assert.equal((await setup(sb, ['--with', 'nope'])).code, 2);
    assert.equal((await setup(sb, ['--with'])).code, 2);
  } finally { sb.cleanup(); }
});

test('optional tools approved in the project\'s .fk/toolchain.json are planned', async () => {
  const sb = sandbox({ tools: { git: PRESENT.git, node: PRESENT.node, claude: PRESENT.claude }, plugins: [READY.plugins[0]], marketplaces: [READY.marketplaces[0]] });
  const proj = path.join(sb.root, 'proj');
  try {
    fs.mkdirSync(path.join(proj, '.fk'), { recursive: true });
    fs.writeFileSync(path.join(proj, '.fk', 'toolchain.json'), JSON.stringify({ approved: ['eslint@9.12.0', 'just@1.58.0', 'brew:gitleaks'] }));
    const { refreshSnapshot } = await import('../hooks/lib.mjs');
    withHome(sb.home, () => refreshSnapshot(proj, ['.fk/toolchain.json'])); // as the fk CLI does
    const r = await setup(sb, ['--dry-run'], { deps: { os: 'win', cwd: proj } });
    assert.match(r.out, /Install just/);
    assert.match(r.out, /Install gitleaks/);
    assert.doesNotMatch(r.out, /Install (?:mise|uv|MemPalace)\b/);
  } finally { sb.cleanup(); }
});

test('--all: the full plan, nothing executed or written', async () => {
  const sb = sandbox();
  try {
    const r = await setup(sb, ['--dry-run', '--all']);
    assert.equal(r.code, 1);
    assert.equal(r.ran.length, 0);
    assert.match(r.out, /Install git/);
    assert.match(r.out, /Install oh-my-claudecode/);
    assert.match(r.out, new RegExp(`uv tool install mempalace==${LOCK.tools.mempalace.version}`));
    assert.match(r.out, new RegExp(`skillspector\\.git@${LOCK.tools.skillspector.commit}`));
    assert.match(r.out, /claude plugin marketplace add Yeachan-Heo\/oh-my-claudecode/);
    assert.match(r.out, /claude plugin install oh-my-claudecode@omc/);
    assert.match(r.out, /claude plugin install mempalace@mempalace/);
    assert.match(r.out, new RegExp(`codebase-memory-mcp/v${LOCK.tools['codebase-memory-mcp'].version}`));
    assert.match(r.out, /config set auto_index false/);
    assert.match(r.out, /mempalace init --yes --no-llm --backend sqlite_exact/);
    assert.match(r.out, /Dry run: nothing was changed/);
    assert.match(r.out, /Install GitHub CLI \(/);
    assert.doesNotMatch(r.out, /optional/);
    assert.equal(fs.existsSync(sb.fk), false, 'dry run writes nothing');
  } finally { sb.cleanup(); }
});

test('everything present and configured: all ready, exit 0, status cached', async () => {
  const sb = sandbox(READY);
  try {
    const r = await setup(sb, []);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /All base tools are ready/);
    assert.equal(r.ran.length, 0);
    const st = readStatus(sb);
    assert.equal(st.tools.gitleaks.level, 'green');
    assert.equal(st.tools.skillspector.version, '2.12.0');
    assert.ok(Object.values(st.tools).every((t) => t.level === 'green'), JSON.stringify(st.tools));
    assert.equal(readLedger(sb).length, 0);
    const pre = readAll(sb).filter((e) => e.tool !== 'fk-shim');
    assert.ok(pre.length > 0 && pre.every((e) => e.kind === 'pre-existing' && e.undo === null), 'everything found is recorded as pre-existing');
    for (const item of ['git', 'gitleaks', 'mempalace', 'mempalace:plugin', 'mempalace:marketplace', 'mempalace:palace', 'mempalace:silent-save',
      'oh-my-claudecode:plugin', 'git-lfs:config', 'codebase-memory-mcp:auto_index', 'podman',
      ...(NATIVE_CONTAINERS ? [] : ['podman:machine'])]) assert.ok(pre.some((e) => e.item === item), item);
    if (NATIVE_CONTAINERS) assert.ok(!pre.some((e) => e.item === 'podman:machine'), 'no machine recorded on Linux');
    await setup(sb, []);
    assert.equal(readAll(sb).filter((e) => e.tool !== 'fk-shim').length, pre.length, 'recorded once');
  } finally { sb.cleanup(); }
});

test('no consent without --yes when nobody can answer: nothing runs, status says red', async () => {
  const sb = sandbox({ ...READY, tools: without('gitleaks') });
  try {
    const r = await setup(sb, ['--all', '--all']);
    assert.equal(r.code, 1);
    assert.equal(r.ran.length, 0);
    assert.match(r.out, /Install gitleaks/);
    assert.match(r.out, /fk setup --yes/);
    assert.equal(readStatus(sb).tools.gitleaks.level, 'red');
    assert.equal(readAll(sb).length, 0, 'no consent: nothing recorded');
  } finally { sb.cleanup(); }
});

test('a "no" at the prompt installs nothing', async () => {
  const sb = sandbox({ ...READY, tools: without('gitleaks') });
  try {
    const r = await setup(sb, ['--all', '--all'], { deps: { isTTY: true, ask: async () => false } });
    assert.equal(r.code, 1);
    assert.equal(r.ran.length, 0);
  } finally { sb.cleanup(); }
});

test('--yes installs, verifies, writes the ledger; a second run is a no-op', async () => {
  const sb = sandbox({ ...READY, tools: without('gitleaks', 'skillspector') });
  // The recording exec "installs" by dropping the fake binary in place.
  const exec = (step) => { fakeBin(sb.bin, BIN_OF[step.tool] || step.tool, PRESENT[BIN_OF[step.tool] || step.tool]); return { ok: true }; };
  try {
    const r = await setup(sb, ['--all', '--yes'], { exec });
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(r.ran.map((s) => s.tool).sort(), ['gitleaks', 'skillspector']);
    const ledger = readLedger(sb);
    assert.equal(ledger.length, 2);
    for (const e of ledger) {
      assert.equal(e.ok, true);
      assert.equal(e.via, 'fk setup');
      assert.ok(e.rollback && e.command && e.ts);
      assert.equal(e.kind, 'installed');
      assert.ok(e.item && e.how && e.undo && e.scope, JSON.stringify(e));
    }
    assert.equal(ledger.find((e) => e.tool === 'skillspector').undo, 'uv tool uninstall skillspector');
    assert.equal(ledger.find((e) => e.tool === 'skillspector').version, LOCK.tools.skillspector.commit);
    assert.equal(ledger.find((e) => e.tool === 'gitleaks').version, LOCK.tools.gitleaks.version);
    assert.equal(readStatus(sb).tools.gitleaks.level, 'green');

    const again = await setup(sb, ['--all', '--yes'], { exec });
    assert.equal(again.code, 0);
    assert.equal(again.ran.length, 0, 'idempotent');
    assert.equal(readLedger(sb).length, 2);
  } finally { sb.cleanup(); }
});

test('a failed step is logged as failed and the run stays red', async () => {
  const sb = sandbox({ ...READY, tools: without('gitleaks') });
  try {
    const r = await setup(sb, ['--all', '--yes'], { exec: () => ({ ok: false }) });
    assert.equal(r.code, 1);
    assert.equal(readLedger(sb)[0].ok, false);
    assert.match(r.out, /Still red|still red/i);
  } finally { sb.cleanup(); }
});

test('--only limits the plan; older-than-floor is an update; newer is kept', async () => {
  const sb = sandbox({ ...READY, tools: { ...PRESENT, gitleaks: '8.18.0', uv: 'uv 9.9.9' } });
  try {
    const r = await setup(sb, ['--dry-run', '--only', 'gitleaks']);
    assert.match(r.out, /Update gitleaks/);
    assert.match(r.out, /older than the minimum 8\.19\.0/);
    assert.doesNotMatch(r.out, /mempalace/i);
    const all = await setup(sb, ['--dry-run']);
    assert.match(all.out, /9\.9\.9, newer than the tested/);
    assert.equal((await setup(sb, ['--only', 'nope'])).code, 2);
  } finally { sb.cleanup(); }
});

test('OMC from npm only at or above the floor: supported (yellow), the plugin copy is NOT added (hooks would fire twice)', async () => {
  const sb = sandbox({ ...READY, tools: { ...PRESENT, omc: 'oh-my-claudecode v5.6.0' }, plugins: [['mempalace@mempalace', '3.10.0']] });
  try {
    const r = await setup(sb, ['--dry-run']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /yellow\s+oh-my-claudecode\s+5\.6\.0, npm install: supported; plugin mode optional/);
    assert.doesNotMatch(r.out, /claude plugin (install|marketplace add).*oh-my-claudecode|Yeachan-Heo/);
    assert.doesNotMatch(r.out, /npm (un|rm|remove)/);
    const low = sandbox({ ...READY, tools: { ...PRESENT, omc: 'oh-my-claudecode v3.9.0' }, plugins: [['mempalace@mempalace', '3.10.0']] });
    try {
      const b = await setup(low, ['--dry-run']);
      assert.match(b.out, /3\.9\.0 \(npm\) is below the supported floor 4\.0\.0/);
      assert.match(b.out, new RegExp(`npm i -g oh-my-claude-sisyphus@${LOCK.tools['oh-my-claudecode'].version}`));
      assert.doesNotMatch(b.out, /claude plugin install oh-my-claudecode/);
    } finally { low.cleanup(); }
  } finally { sb.cleanup(); }
});

test('C3: fk setup writes the user-level fk shim (resolved at run time); --remove-shim takes it back; dry run writes none', async () => {
  const sb = sandbox(READY);
  try {
    assert.equal((await setup(sb, ['--dry-run'])).out.includes('fk command'), false);
    assert.equal(fs.existsSync(path.join(sb.home, '.local', 'bin', 'fk')), false);
    assert.match((await setup(sb, ['--shim', '--dry-run'])).out, /dry run\): would write .*Nothing was changed/);
    assert.equal(fs.existsSync(path.join(sb.home, '.local', 'bin', 'fk')), false, '--shim --dry-run writes nothing');
    assert.equal(fs.existsSync(path.join(sb.home, '.fk', 'fk-shim.mjs')), false);
    const r = await setup(sb, []);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /fk command: ready/);
    const sh = fs.readFileSync(path.join(sb.home, '.local', 'bin', 'fk'), 'utf8');
    assert.match(sh, /exec node "\$HOME\/\.fk\/fk-shim\.mjs" "\$@"/);
    if (WIN) {
      assert.match(fs.readFileSync(path.join(sb.home, '.local', 'bin', 'fk.cmd'), 'utf8'), /@node "%USERPROFILE%\\\.fk\\fk-shim\.mjs" %\*/);
      assert.equal(sb.userPath, path.join(sb.home, '.local', 'bin'), 'user PATH gets ~/.local/bin');
    }
    // The ledger: the shim files (home-relative, exact) and, on Windows, the PATH entry the kit added.
    const shimRows = readAll(sb).filter((e) => e.tool === 'fk-shim');
    const files = shimRows.find((e) => e.item === 'fk-shim');
    assert.equal(files.kind, 'installed');
    assert.ok(files.paths.includes('~/.local/bin/fk') && files.paths.includes('~/.fk/fk-shim.mjs'), JSON.stringify(files.paths));
    if (WIN) assert.deepEqual([shimRows.find((e) => e.item === 'fk-shim:path').kind, shimRows.find((e) => e.item === 'fk-shim:path').dir], ['configured', '~/.local/bin']);
    assert.ok(!JSON.stringify(shimRows).includes(sb.home), 'no home folder names in the ledger');
    // The shim finds the installed plugin from installed_plugins.json, whatever version folder it lives in.
    const reg = path.join(sb.home, '.claude', 'plugins', 'installed_plugins.json');
    const j = JSON.parse(fs.readFileSync(reg, 'utf8'));
    j.plugins['founder-kit@awesome-founder-kit'] = [{ scope: 'user', installPath: KIT, version: '0.4.0' }];
    fs.writeFileSync(reg, JSON.stringify(j));
    const run = spawnSync(process.execPath, [path.join(sb.home, '.fk', 'fk-shim.mjs'), 'nope-command'], { env: sb.env, encoding: 'utf8' });
    assert.match(run.stdout, /usage: fk init/, run.stderr);
    fs.writeFileSync(reg, JSON.stringify({ version: 2, plugins: { 'founder-kit@a-fork': [{ scope: 'user', installPath: KIT }] } }));
    assert.match(spawnSync(process.execPath, [path.join(sb.home, '.fk', 'fk-shim.mjs'), 'nope-command'], { env: sb.env, encoding: 'utf8' }).stdout,
      /usage: fk init/, 'any founder-kit@<marketplace> key');
    fs.writeFileSync(reg, JSON.stringify({ version: 2, plugins: {} }));
    const missing = spawnSync(process.execPath, [path.join(sb.home, '.fk', 'fk-shim.mjs')], { env: sb.env, encoding: 'utf8' });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /founder-kit plugin is not installed/);
    fs.writeFileSync(path.join(sb.home, '.local', 'bin', 'other'), 'keep');
    const rm = await setup(sb, ['--remove-shim']);
    assert.match(rm.out, /fk command removed/);
    assert.equal(fs.existsSync(path.join(sb.home, '.local', 'bin', 'fk')), false);
    assert.equal(fs.existsSync(path.join(sb.home, '.fk', 'fk-shim.mjs')), false);
    assert.equal(fs.existsSync(path.join(sb.home, '.local', 'bin', 'other')), true);
    assert.equal(readAll(sb).filter((e) => e.item === 'fk-shim').at(-1).kind, 'removed');
    fs.writeFileSync(path.join(sb.home, '.local', 'bin', 'fk'), '#!/bin/sh\necho mine\n');
    assert.match((await setup(sb, ['--shim'])).out, /kept your own/);
    assert.equal(fs.readFileSync(path.join(sb.home, '.local', 'bin', 'fk'), 'utf8'), '#!/bin/sh\necho mine\n');
  } finally { sb.cleanup(); }
});

test('settings: CBM auto_index on is planned off; an existing palace and the user\'s silent_save choice are kept', async () => {
  const sb = sandbox({ ...READY, cbmConfig: 'true', mpConfig: { backend: 'chroma', hooks: { silent_save: false } } });
  try {
    const r = await setup(sb, ['--all', '--dry-run']);
    assert.match(r.out, /codebase-memory-mcp config set auto_index false/);
    assert.match(r.out, /codebase-memory-mcp config set auto_watch false/);
    assert.match(r.out, /uses the chroma backend; kept as is/);
    assert.match(r.out, /silent_save is off \(your choice; kept\)/);
    assert.doesNotMatch(r.out, /mempalace init/);
  } finally { sb.cleanup(); }
});

// `mempalace init` writes config.json (palace_path, backend) but no palace folder until the first mine: that is a palace.
test('a palace set up by mempalace init (config written, folder not yet created) is ready, and init is not planned again', async () => {
  const sb = sandbox({ ...READY, palace: false });
  try {
    const mp = path.join(sb.home, '.config', 'mempalace');
    fs.writeFileSync(path.join(mp, 'config.json'), JSON.stringify({ palace_path: path.join(mp, 'palace'), backend: 'sqlite_exact', hooks: { silent_save: true } }));
    const r = await setup(sb, ['--all', '--all']);
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /mempalace init|no palace yet/);
    assert.ok(readAll(sb).some((e) => e.item === 'mempalace:palace' && e.kind === 'pre-existing'));
    // Without the backend line (only the silent_save step wrote config.json) there is no palace yet.
    fs.writeFileSync(path.join(mp, 'config.json'), JSON.stringify({ hooks: { silent_save: true } }));
    assert.match((await setup(sb, ['--all', '--dry-run'])).out, /mempalace init --yes/);
  } finally { sb.cleanup(); }
});

test('`fk setup` is reachable through the fk CLI extension point', () => {
  const sb = sandbox(READY);
  try {
    const r = spawnSync(process.execPath, [path.join(KIT, 'bin', 'fk.mjs'), 'setup', '--dry-run'], { env: sb.env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /All base tools are ready/);
  } finally { sb.cleanup(); }
});

// ---- v0.7 base tools: Git LFS, mise, just, gh, containers (Podman, or the Docker already there) ----
const T = LOCK.tools;
const steps = (out) => out.split('\n').filter((l) => /^\s+> /.test(l)).map((l) => l.replace(/^\s+> /, ''));

test('nothing installed, Windows with WSL2: winget pins, Podman machine and compose planned; nothing runs or is written', async () => {
  const sb = sandbox({ tools: { wsl: PRESENT.wsl } });
  try {
    const r = await setup(sb, ['--all', '--dry-run'], { deps: { os: 'win' } });
    assert.equal(r.ran.length, 0);
    for (const re of [`GitHub.GitLFS .*--version ${T['git-lfs'].version}`, '^git lfs install$', `jdx\\.mise .*--version ${T.mise.version}`,
      `^mise use -g just@${T.just.version}$`, 'winget install --id GitHub\\.cli ', `RedHat\\.Podman .*--version ${T.podman.version}`,
      `^podman machine init --cpus ${T.podman.machine.cpus} --memory ${T.podman.machine.memory_mib}$`, '^podman machine start$',
      `Docker\\.DockerCompose .*--version ${T['podman-compose'].windows.version}`]) assert.ok(steps(r.out).some((s) => new RegExp(re).test(s)), re);
    const at = (re) => steps(r.out).findIndex((s) => re.test(s));
    assert.ok(at(/jdx\.mise/) < at(/^mise use -g just@/), 'mise is installed before just goes through it');
    assert.ok(!steps(r.out).some((s) => /Casey\.Just|podman-compose==/.test(s)), 'never also winget just; no podman-compose on Windows');
    assert.match(r.out, /Containers \(Podman\) \(about 1-2 GB/);
    assert.doesNotMatch(r.out, /wsl --install/);
    assert.ok(steps(r.out).every((s) => !/machine (rm|reset)|uninstall/.test(s)), 'never removes anything');
    assert.equal(fs.existsSync(sb.fk), false);
  } finally { sb.cleanup(); }
});

test('Windows without WSL2: Podman installs, its machine waits; WSL2 is a founder step (never run); other installs continue', async () => {
  const sb = sandbox();
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-setup-proj-'));
  try {
    const dry = await setup(sb, ['--all', '--dry-run'], { deps: { os: 'win' } });
    assert.match(dry.out, /RedHat\.Podman/);
    assert.doesNotMatch(dry.out, /podman machine init/);
    assert.match(dry.out, /Only you can do these[\s\S]*`wsl --install --no-distribution`[\s\S]*restart the computer/);
    const r = await setup(sb, ['--all', '--yes'], { deps: { os: 'win' } });
    assert.ok(r.ran.every((s) => !/\bwsl\b/.test(s.cmd)), 'WSL is never installed silently');
    for (const id of ['git-lfs', 'mise', 'just', 'gh', 'podman', 'podman-compose', 'gitleaks', 'mempalace']) assert.ok(r.ran.some((s) => s.tool === id), `${id} still installs`);
    const st = readStatus(sb);
    assert.deepEqual(st.tools.podman.founder.map((f) => [f.id, f.blocking]), [['wsl2', true]]);
    assert.equal(st.tools.gh.founder[0].id, 'gh-auth');
    // The session note repeats the blocking step only; fk actions lists every founder step.
    const note = withHome(sb.home, baseToolsNote);
    assert.match(note, /only the founder can do[\s\S]*wsl --install --no-distribution/);
    assert.doesNotMatch(note, /gh auth login/);
    spawnSync('git', ['init', '-q'], { cwd: proj });
    const env = { ...process.env, FK_HOME: sb.fk, ANTHROPIC_API_KEY: '' };
    assert.equal(spawnSync(process.execPath, [path.join(KIT, 'bin', 'fk.mjs'), 'init'], { cwd: proj, env, encoding: 'utf8' }).status, 0);
    const a = spawnSync(process.execPath, [path.join(KIT, 'bin', 'fk.mjs'), 'actions'], { cwd: proj, env, encoding: 'utf8' });
    assert.equal(a.status, 0, a.stdout + a.stderr);
    const md = fs.readFileSync(path.join(proj, 'docs', 'process', 'founder-actions.md'), 'utf8');
    assert.match(md, /This computer[\s\S]*wsl --install --no-distribution.*<!-- fk:machine:wsl2 -->/);
    assert.match(md, /gh auth login.*<!-- fk:machine:gh-auth -->/);
  } finally { sb.cleanup(); fs.rmSync(proj, { recursive: true, force: true }); }
});

test('nothing installed, macOS with Homebrew: brew installs and the Podman machine', async () => {
  const sb = sandbox();
  try {
    const r = await setup(sb, ['--all', '--dry-run'], { deps: { os: 'mac', has: (b) => b === 'brew' } });
    for (const p of ['git-lfs', 'mise', 'gh', 'podman']) assert.ok(steps(r.out).includes(`brew install ${p}`), p);
    assert.ok(steps(r.out).includes(`mise use -g just@${T.just.version}`), 'just through the mise brew installs');
    assert.ok(!steps(r.out).includes('brew install just'), 'never also through brew');
    assert.ok(steps(r.out).includes(`podman machine init --cpus ${T.podman.machine.cpus} --memory ${T.podman.machine.memory_mib}`));
    assert.doesNotMatch(r.out, /wsl/);
  } finally { sb.cleanup(); }
});

test('nothing installed, Linux with apt: distro packages, mise pinned via its script, no machine', async () => {
  const sb = sandbox();
  try {
    const r = await setup(sb, ['--all', '--dry-run'], { deps: { os: 'linux', has: (b) => b === 'apt-get' } });
    for (const p of ['git-lfs', 'podman']) assert.ok(steps(r.out).includes(`sudo apt-get update && sudo apt-get install -y ${p}`), p);
    for (const p of ['just', 'gh']) assert.ok(steps(r.out).includes(`mise use -g ${p}@${T[p].version}`), `${p} pinned through mise, never apt`);
    assert.ok(steps(r.out).includes(`curl -fsSL https://mise.run | MISE_VERSION=v${T.mise.version} sh`));
    assert.doesNotMatch(r.out, /podman machine|wsl/);
    assert.match(r.out, /sudo: your computer password/);
  } finally { sb.cleanup(); }
});

test('Docker already there: kept, Podman and podman-compose never added next to it', async () => {
  const tools = { ...without('podman', 'podman-compose'), docker: 'Docker version 27.3.1, build abc' };
  const sb = sandbox({ ...READY, tools });
  try {
    const r = await setup(sb, [], { deps: { os: 'win' } });
    assert.equal(r.code, 0, r.out);
    assert.equal(r.ran.length, 0);
    assert.match(r.out, /Containers \(Docker\)\s+27\.3\.1, Docker found; kept/);
    assert.match(r.out, /Compose for Podman\s+not needed: Docker brings its own compose/);
    assert.doesNotMatch(r.out, /RedHat\.Podman|podman-compose==|podman machine/);
    assert.equal(readStatus(sb).tools.podman.engine, 'docker');
  } finally { sb.cleanup(); }
});

test('Podman present without a machine: only init + start planned; --yes logs them with rollback hints; next run is a no-op', async () => {
  const sb = sandbox({ ...READY, answers: { podman: NO_MACHINE } });
  try {
    const unasked = await setup(sb, ['--dry-run'], { deps: { os: 'mac' } });
    assert.equal(unasked.code, 0, 'an optional tool nobody asked for is not set up further');
    assert.deepEqual(steps(unasked.out), []);
    assert.match(unasked.out, /yellow\s+Containers \(Podman\)\s+5\.8\.3, no Podman machine yet.*fk setup --with podman sets it up/);
    const dry = await setup(sb, ['--all', '--dry-run'], { deps: { os: 'mac' } });
    assert.deepEqual(steps(dry.out), [`podman machine init --cpus ${T.podman.machine.cpus} --memory ${T.podman.machine.memory_mib}`, 'podman machine start']);
    const exec = () => { fakeBin(sb.bin, 'podman', PRESENT.podman, 'false', MACHINE_ON); return { ok: true }; };
    const r = await setup(sb, ['--all', '--yes'], { deps: { os: 'mac' }, exec });
    assert.equal(r.code, 0, r.out);
    const ledger = readLedger(sb);
    assert.deepEqual(ledger.map((e) => [e.tool, e.action, e.version]), [['podman', 'configure', T.podman.version], ['podman', 'configure', T.podman.version]]);
    assert.match(ledger[0].rollback, /ask the founder first/);
    assert.equal(ledger[1].rollback, 'podman machine stop');
    assert.deepEqual([ledger[0].item, ledger[0].kind, ledger[0].undo], ['podman:machine', 'configured', 'podman machine rm -f podman-machine-default']);
    assert.equal(ledger[1].kind, 'runtime', 'starting the machine is nothing to undo');
    assert.ok(readAll(sb).some((e) => e.item === 'podman' && e.kind === 'pre-existing'), 'Podman itself was already there');
    assert.deepEqual(readStatus(sb).tools.podman.machine, { exists: true, running: true });
    const again = await setup(sb, ['--all', '--yes'], { deps: { os: 'mac' }, exec });
    assert.equal(again.ran.length, 0, 'idempotent');
  } finally { sb.cleanup(); }
});

test('all present: machine status cached, Git LFS switched on, just through mise counts; LFS off is planned on', async () => {
  const sb = sandbox(READY);
  try {
    const r = await setup(sb, ['--all', '--all'], { deps: { os: 'mac' } });
    assert.equal(r.code, 0, r.out);
    assert.equal(r.ran.length, 0);
    assert.deepEqual(readStatus(sb).tools.podman.machine, { exists: true, running: false });
  } finally { sb.cleanup(); }
  const off = sandbox({ ...READY, tools: without('just'), answers: { git: NO_LFS, mise: { 'exec -- just': 'just 1.58.0' } } });
  try {
    const r = await setup(off, ['--all', '--dry-run'], { deps: { os: 'linux' } });
    assert.deepEqual(steps(r.out), ['git lfs install']);
    assert.match(r.out, /just\s+1\.58\.0, through mise/);
  } finally { off.cleanup(); }
  const viaMise = sandbox({ ...READY, tools: without('just'), answers: { mise: { exec: null } } });
  try {
    const r = await setup(viaMise, ['--all', '--dry-run'], { deps: { os: 'win', has: (b) => b === 'mise' } });
    assert.deepEqual(steps(r.out), [`mise use -g just@${T.just.version}`]);
  } finally { viaMise.cleanup(); }
});

test('fk doctor rows: tools, gh sign-in, container machine; refreshes the cached machine status', async () => {
  const sb = sandbox({ ...READY, answers: { podman: MACHINE_ON } });
  const { doctorRows } = await import('../bin/cmd/setup/core.mjs');
  try {
    fs.mkdirSync(path.join(sb.fk, 'state'), { recursive: true });
    fs.writeFileSync(path.join(sb.fk, 'state', 'base-tools.json'), JSON.stringify({ tools: { podman: { level: 'green', machine: { exists: true, running: false } } } }));
    const rows = withHome(sb.home, () => doctorRows(sb.env, 'mac'));
    const row = (id) => rows.find((r) => r[1] === id);
    assert.equal(row('git-lfs')[0], true);
    assert.equal(row('mise')[2], '2026.9.18');
    assert.match(row('gh')[2], /not signed in/);
    assert.match(row('containers')[2], /Podman 5\.8\.3; machine running/);
    assert.equal(readStatus(sb).tools.podman.machine.running, true);
  } finally { sb.cleanup(); }
});

function withHome(home, fn) {
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, FK_HOME: process.env.FK_HOME };
  Object.assign(process.env, { HOME: home, USERPROFILE: home });
  delete process.env.FK_HOME;
  try { return fn(); } finally { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}

test('session note: no cache, red tools, all green; cache only and fast', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-note-'));
  try {
    assert.equal(withHome(home, baseToolsNote), undefined, 'no cache yet: silent (fk-start runs fk setup)');
    const write = (tools) => { fs.mkdirSync(path.join(home, '.fk', 'state'), { recursive: true }); fs.writeFileSync(path.join(home, '.fk', 'state', 'base-tools.json'), JSON.stringify({ tools })); };
    write({ gitleaks: { level: 'red', reason: 'missing' }, uv: { level: 'red', reason: 'below-floor', min: '0.5.0' }, gh: { level: 'yellow' } });
    const t0 = performance.now();
    const note = withHome(home, baseToolsNote);
    assert.ok(performance.now() - t0 < 50);
    assert.match(note, /gitleaks \(missing\)/);
    assert.match(note, /uv \(older than 0\.5\.0\)/);
    assert.match(note, /AskUserQuestion/);
    assert.match(note, /fk setup/);
    assert.doesNotMatch(note, /gh/);
    write({ gitleaks: { level: 'green' }, gh: { level: 'yellow' } });
    assert.equal(withHome(home, baseToolsNote), undefined);
    const src = fs.readFileSync(path.join(KIT, 'hooks', 'session', '10-base-tools.mjs'), 'utf8');
    assert.doesNotMatch(src, /child_process|fetch\(|http/, 'no processes, no network');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('install scripts carry every locked tool at its pinned version, and nothing unpinned', () => {
  const scripts = { 'install.ps1': fs.readFileSync(path.join(REPO, 'install', 'install.ps1'), 'utf8'), 'install.sh': fs.readFileSync(path.join(REPO, 'install', 'install.sh'), 'utf8') };
  for (const [name, src] of Object.entries(scripts)) {
    for (const [id, t] of Object.entries(LOCK.tools)) {
      assert.ok(src.includes(id), `${name} mentions ${id}`);
      const pin = (name === 'install.ps1' && t.windows?.version) || t.commit || t.version; // Windows compose: docker-compose
      if (t.exact) assert.ok(src.includes(pin), `${name} pins ${id} at ${pin}`);
      if (t.min) assert.ok(name === 'install.ps1' ? src.includes(`'${id}' = '${t.min}'`) : src.includes(`${id}) echo ${t.min}`), `${name} floor for ${id} = ${t.min}`);
      for (const k of ['marketplace', 'plugin']) if (t[k]) assert.ok(src.includes(t[k]), `${name} has ${t[k]}`);
    }
    assert.ok(src.includes(`'${LOCK.checked}'`) || src.includes(`=${LOCK.checked}`), `${name} lock date`);
    assert.doesNotMatch(src, /@latest|releases\/latest|codebase-memory-mcp\/main\//, `${name}: no unpinned installs`);
    if (name === 'install.sh') {
      // macOS ships bash 3.2, which ends a $( ) at a case pattern's ')' (a syntax error at run time, not at bash -n).
      assert.doesNotMatch(src, /\$\(\s*case\b/, 'install.sh: no case inside $( )');
      // codebase-memory's installer refuses a group-writable ~/.local/bin (umask 002, Ubuntu's default for users).
      assert.match(src, /chmod go-w ~\/\.local\/bin && curl -fsSL \$CBM_RAW\/install\.sh/, 'install.sh: ~/.local/bin not group-writable before CBM');
    }
    assert.match(src, /bin.fk\.mjs['"]?\)? setup --shim/, `${name}: writes the user-level fk shim through the kit`);
    const optional = TOOLS.filter((t) => !t.core).map((t) => t.id);
    assert.ok(src.includes(name === 'install.ps1' ? `@(${optional.map((id) => `'${id}'`).join(', ')})` : `OPTIONAL="${optional.join(' ')}"`), `${name}: optional tools = TOOLS without core`);
    assert.doesNotMatch(src, /npm-only/, `${name}: an npm OMC is never doubled with the plugin copy`);
    assert.doesNotMatch(src, /[A-Z]:\\Users\\|\/home\/[a-z]|\/Users\/[a-z]/i, `${name}: no personal paths`);
  }
});

const gitBash = WIN ? ['C:\\Program Files\\Git\\bin\\bash.exe'].find((p) => fs.existsSync(p)) : 'bash';
test('install.sh --dry-run: plans from fake tools (optional ones only when asked for), writes nothing', { skip: !gitBash && 'bash not found' }, () => {
  const sb = sandbox({ plugins: READY.plugins, marketplaces: READY.marketplaces, palace: true, mpConfig: READY.mpConfig });
  try {
    for (const [name, text] of Object.entries(without('gitleaks', 'mise', 'just'))) {
      const cfg = name === 'codebase-memory-mcp' ? '[ "$1" = config ] && { echo false; exit 0; }\n' : '';
      fs.writeFileSync(path.join(sb.bin, name), `#!/bin/sh\n${cfg}echo "${text}"\n`, { mode: 0o755 });
    }
    const utils = WIN ? 'C:\\Program Files\\Git\\usr\\bin' : '/usr/bin:/bin';
    const env = { ...sb.env, PATH: `${sb.bin}${path.delimiter}${utils}` };
    const sh = (...a) => spawnSync(gitBash, [path.join(REPO, 'install', 'install.sh'), '--dry-run', ...a], { env, encoding: 'utf8', timeout: 60000 });
    const core = sh();
    assert.equal(core.status, 0, core.stdout + core.stderr);
    assert.match(core.stdout, /Install gitleaks/, 'gitleaks is core');
    assert.ok(core.stdout.includes(`V=${LOCK.tools.gitleaks.version}`), 'pinned gitleaks release');
    assert.match(core.stdout, /optional\s+mise\s+optional; proposed per project when it needs it/);
    assert.doesNotMatch(core.stdout, /Install (?:mise|just)\b/);
    assert.match(core.stdout, /fk setup --with <id> \([^)]*\bjust\b/);
    assert.equal(sh('--with', 'nope').status, 2);
    // FK_WITH, not argv: Git Bash expands a * in the arguments a Windows process passes it.
    const glob = spawnSync(gitBash, [path.join(REPO, 'install', 'install.sh'), '--dry-run'], { env: { ...env, FK_WITH: '*' }, encoding: 'utf8', timeout: 60000 });
    assert.equal(glob.status, 2);
    assert.match(glob.stdout, /unknown optional tool: \* /, 'the id is never globbed');
    const r = sh('--with', 'just');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Dry run: nothing was changed/);
    assert.match(r.stdout, /claude plugin marketplace add nothingbadhappened\/awesome-founder-kit/);
    assert.match(r.stdout, /claude plugin install founder-kit@awesome-founder-kit/);
    assert.match(r.stdout, /Install mise[\s\S]*mise use -g just@/, 'just brings mise, which it installs with');
    assert.equal(fs.existsSync(sb.fk), false, 'dry run writes nothing');
  } finally { sb.cleanup(); }
});

test('install.sh --dry-run: a palace set up by mempalace init (no folder yet) is not initialised again', { skip: !gitBash && 'bash not found' }, () => {
  const sb = sandbox({ plugins: READY.plugins, marketplaces: READY.marketplaces, mpConfig: { backend: 'sqlite_exact', hooks: { silent_save: true } } });
  try {
    for (const [name, text] of Object.entries(PRESENT)) {
      const cfg = name === 'codebase-memory-mcp' ? '[ "$1" = config ] && { echo false; exit 0; }\n' : '';
      fs.writeFileSync(path.join(sb.bin, name), `#!/bin/sh\n${cfg}echo "${text}"\n`, { mode: 0o755 });
    }
    const utils = WIN ? 'C:\\Program Files\\Git\\usr\\bin' : '/usr/bin:/bin';
    const r = spawnSync(gitBash, [path.join(REPO, 'install', 'install.sh'), '--dry-run', '--all'], { env: { ...sb.env, PATH: `${sb.bin}${path.delimiter}${utils}` }, encoding: 'utf8', timeout: 60000 });
    assert.ok(r.status === 0 || r.status === 1, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /mempalace init|no palace yet/);
  } finally { sb.cleanup(); }
});

test('install.ps1 parses under Windows PowerShell', { skip: !WIN && 'Windows only' }, () => {
  const file = path.join(REPO, 'install', 'install.ps1');
  const r = spawnSync('powershell', ['-NoProfile', '-Command',
    `$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('${file}', [ref]$null, [ref]$e); if ($e) { $e | ForEach-Object { $_.Message }; exit 1 }`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // -With gh,nope arrives as an array (each element split on commas and spaces, like FK_WITH); an unknown id exits 2.
  const env = { ...process.env, CLAUDE_CODE_CHILD_SESSION: '', FK_WITH: '' };
  const bad = spawnSync('powershell', ['-NoProfile', '-Command', `& '${file}' -DryRun -With gh,nope; exit $LASTEXITCODE`], { encoding: 'utf8', env });
  assert.equal(bad.status, 2, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /unknown optional tool: nope \(/);
  const viaEnv = spawnSync('powershell', ['-NoProfile', '-File', file, '-DryRun'], { encoding: 'utf8', env: { ...env, FK_WITH: 'mise just,nope' } });
  assert.equal(viaEnv.status, 2, viaEnv.stdout + viaEnv.stderr);
  assert.match(viaEnv.stdout, /unknown optional tool: nope \(/);
});

// ---- v0.7 review: just after mise (M3), apt floors (M4), founder steps and the note throttle ----
test('M3: macOS without Homebrew, Windows and Linux from scratch: mise first, then just through mise (never a package manager); the run ends green', async () => {
  for (const [o, has, first] of [['mac', () => false, /^curl -fsSL https:\/\/mise\.run \| MISE_VERSION=/], ['win', () => false, /^winget install --id jdx\.mise /],
    ['linux', (b) => b === 'apt-get', /^curl -fsSL https:\/\/mise\.run \| MISE_VERSION=/]]) {
    const sb = sandbox({ ...READY, tools: without('mise', 'just') });
    try {
      const dry = await setup(sb, ['--all', '--dry-run'], { deps: { os: o, has } });
      const s = steps(dry.out);
      assert.match(s[0], first, `${o}: mise is the first step`);
      assert.equal(s[1], `mise use -g just@${T.just.version}`, `${o}: then just through mise`);
      assert.ok(!s.some((x) => /Casey\.Just|install(?: -y)? just\b|pacman .*just/.test(x)), `${o}: never also through a package manager`);
      // The recording exec: installing mise brings a mise whose global config then holds just.
      const exec = (step) => { if (step.tool === 'mise') fakeBin(sb.bin, 'mise', PRESENT.mise, 'false', { 'exec -- just': PRESENT.just }); return { ok: true }; };
      const r = await setup(sb, ['--all', '--yes'], { deps: { os: o, has }, exec });
      assert.equal(r.code, 0, `${o}: ${r.out}`);
      assert.deepEqual(r.ran.map((x) => x.tool), ['mise', 'just'], o);
      assert.match(r.out, /Result[\s\S]*just\s+1\.58\.0, through mise/, o);
    } finally { sb.cleanup(); }
  }
});

test('M4: Ubuntu 22.04 floors: gh 2.4.0 is replaced through mise; Podman 3.4.4 is a yellow founder note, never the same apt command again', async () => {
  const jammy = { ...PRESENT, gh: 'gh version 2.4.0 (2021-11-21)', podman: 'podman version 3.4.4' };
  const sb = sandbox({ ...READY, tools: jammy, answers: { mise: { exec: null } } }); // mise holds no gh yet
  const opts = { deps: { os: 'linux', has: (b) => b === 'apt-get' } };
  try {
    const dry = await setup(sb, ['--all', '--dry-run'], opts);
    assert.deepEqual(steps(dry.out), [`mise use -g gh@${T.gh.version}`]);
    assert.match(dry.out, /yellow\s+Containers \(Podman\)\s+3\.4\.4, Your Linux ships Podman 3\.4\.4; Podman ≥4\.9 needs Ubuntu 24\.04\+\/Debian 13\+ or packages from podman\.io\./);
    assert.doesNotMatch(dry.out, /apt-get install -y (?:podman|gh)/);
    const exec = (step) => { if (step.tool === 'gh') fakeBin(sb.bin, 'mise', PRESENT.mise, 'false', { 'exec -- gh': PRESENT.gh }); return { ok: true }; };
    const r = await setup(sb, ['--all', '--yes'], { ...opts, exec });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Result[\s\S]*GitHub CLI\s+2\.102\.0, through mise/);
    const st = readStatus(sb);
    assert.deepEqual([st.tools.podman.level, st.tools.podman.founder[0].id], ['yellow', 'podman-old']);
    assert.equal(st.tools.gh.founder[0].cmd, 'mise exec -- gh auth login', 'the sign-in names the gh the kit installed');
    const again = await setup(sb, ['--all', '--yes'], { ...opts, exec });
    assert.equal(again.ran.length, 0, 'nothing is re-planned');
  } finally { sb.cleanup(); }
});

test('macOS without Homebrew: the Podman machine is not planned while Podman itself is a manual install', async () => {
  const sb = sandbox({ ...READY, tools: without('podman') });
  try {
    const r = await setup(sb, ['--all', '--dry-run'], { deps: { os: 'mac', has: () => false } });
    assert.ok(steps(r.out).some((s) => /^echo "Install Podman from https:\/\/podman\.io/.test(s)), r.out);
    assert.doesNotMatch(r.out, /podman machine (?:init|start)/);
  } finally { sb.cleanup(); }
});

test('founder steps: blocking first (WSL2 before the gh sign-in); the session note repeats the blocking one at most once a day', async () => {
  const sb = sandbox({ ...READY, tools: without('wsl') });
  try {
    const r = await setup(sb, ['--all', '--dry-run'], { deps: { os: 'win' } });
    const only = r.out.slice(r.out.indexOf('Only you can do these'));
    assert.ok(only.indexOf('wsl --install') > 0 && only.indexOf('wsl --install') < only.indexOf('gh auth login'), r.out);
  } finally { sb.cleanup(); }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-note-'));
  try {
    fs.mkdirSync(path.join(home, '.fk', 'state'), { recursive: true });
    fs.writeFileSync(path.join(home, '.fk', 'state', 'base-tools.json'), JSON.stringify({ tools: { podman: { level: 'yellow', founder: [{ id: 'wsl2', blocking: true, text: 'Turn on WSL2.' }] } } }));
    const at = (now) => withHome(home, () => baseToolsNote({ now }));
    assert.match(at(Date.parse('2026-10-14T08:00:00Z')), /Turn on WSL2/);
    assert.equal(at(Date.parse('2026-10-14T18:00:00Z')), undefined, 'same day: quiet');
    assert.match(at(Date.parse('2026-10-15T09:00:00Z')), /Turn on WSL2/, 'next day: once more');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('install.ps1: machine running/stopped note, blocking founder steps first, compose through docker-compose on Windows, just after mise', () => {
  const src = fs.readFileSync(path.join(REPO, 'install', 'install.ps1'), 'utf8');
  assert.match(src, /machine running \(stop it with podman machine stop when not needed\)/);
  assert.match(src, /machine stopped \(podman machine start when you need containers\)/);
  assert.match(src, /Where-Object \{ \$_\.blocking \}\) \+ @\(/);
  assert.match(src, /Docker\.DockerCompose \$Winget --version \$DockerComposeVersion/);
  assert.doesNotMatch(src, /uv tool install podman-compose/);
  assert.match(src, /\$justStep = if \(\$miseOk\)/);
});

const shBin = (dir, name, body) => fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
function shSandbox(tools, extra = {}) {
  const sb = sandbox({ plugins: READY.plugins, marketplaces: READY.marketplaces, palace: true, mpConfig: READY.mpConfig });
  for (const [name, text] of Object.entries(tools)) {
    const cfg = name === 'codebase-memory-mcp' ? '[ "$1" = config ] && { echo false; exit 0; }\n' : '';
    shBin(sb.bin, name, `${name === 'mise' ? '[ "$1" = exec ] && exit 1\n' : ''}${cfg}echo "${text}"`);
  }
  for (const [name, body] of Object.entries(extra)) shBin(sb.bin, name, body);
  return { sb, env: { ...sb.env, PATH: `${sb.bin}${path.delimiter}${shUtils(sb)}` } };
}
// System utilities for the bash installer, minus every tool the tests mock: a CI runner with a real podman, gh or docker
// in /usr/bin must not leak into a simulated machine. On Windows, Git's usr/bin holds none of them.
const MOCKED = ['podman', 'podman-compose', 'docker', 'docker-compose', 'gh', 'git-lfs', 'mise', 'just', 'uv', 'claude', 'gitleaks', 'skillspector', 'codebase-memory-mcp', 'mempalace', 'brew', 'wsl', 'winget'];
function shUtils(sb) {
  if (WIN) return 'C:\\Program Files\\Git\\usr\\bin';
  const dir = path.join(sb.root, 'sysbin');
  fs.mkdirSync(dir, { recursive: true });
  for (const src of ['/usr/bin', '/bin']) {
    let names = [];
    try { names = fs.readdirSync(src); } catch { continue; }
    for (const n of names) {
      if (MOCKED.includes(n) || fs.existsSync(path.join(dir, n))) continue;
      try { fs.symlinkSync(path.join(src, n), path.join(dir, n)); } catch { /* skip */ }
    }
  }
  return dir;
}
// eslint-disable-next-line no-control-regex
const shPlan = (out) => out.replace(/\x1b\[\d+m/g, '').split('\n').filter((l) => /^\s+> /.test(l)).map((l) => l.replace(/^\s+> /, ''));
const runSh = (sb, env) => spawnSync(gitBash, [path.join(REPO, 'install', 'install.sh'), '--dry-run', '--all'], { env, cwd: sb.root, encoding: 'utf8', timeout: 60000 });

test('install.sh --dry-run, Ubuntu 22.04 mocks: gh through mise, old Podman is a note (no apt re-plan), sandboxed', { skip: !gitBash && 'bash not found' }, () => {
  const { sb, env } = shSandbox({ ...without('gh', 'podman'), gh: 'gh version 2.4.0 (2021-11-21)', podman: 'podman version 3.4.4' }, { 'apt-get': 'exit 0' });
  try {
    const r = runSh(sb, env);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const plan = shPlan(r.stdout);
    assert.ok(plan.includes(`mise use -g gh@${T.gh.version}`), plan.join('\n'));
    assert.ok(!plan.some((s) => /apt-get install -y (?:podman|gh)/.test(s)), plan.join('\n'));
    assert.match(r.stdout, /Your Linux ships Podman 3\.4\.4; Podman ≥4\.9 needs Ubuntu 24\.04\+\/Debian 13\+ or packages from podman\.io/);
    assert.match(r.stdout, /mise exec -- gh auth login/);
    assert.equal(fs.existsSync(sb.fk), false, 'dry run writes nothing');
  } finally { sb.cleanup(); }
});

test('install.sh --dry-run, macOS without Homebrew (mocked uname): mise, then just through mise; no machine steps for a manual Podman', { skip: !gitBash && 'bash not found' }, () => {
  const { sb, env } = shSandbox(without('mise', 'just', 'podman', 'podman-compose', 'wsl'), { uname: '[ "$1" = -s ] && echo Darwin || echo arm64' });
  try {
    const r = runSh(sb, env);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const plan = shPlan(r.stdout);
    const at = (re) => plan.findIndex((s) => re.test(s));
    assert.ok(at(/mise\.run \| MISE_VERSION=v/) >= 0 && at(/mise\.run/) < at(/^mise use -g just@/), plan.join('\n'));
    assert.ok(!plan.some((s) => /brew install just|apt-get install -y just/.test(s)));
    assert.ok(plan.some((s) => /Install Podman from https:\/\/podman\.io/.test(s)), plan.join('\n'));
    assert.ok(!plan.some((s) => /podman machine (?:init|start)/.test(s)), plan.join('\n'));
  } finally { sb.cleanup(); }
});
