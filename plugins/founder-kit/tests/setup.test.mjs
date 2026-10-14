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
const { runSetup } = await import('../bin/cmd/setup.mjs');
const { default: baseToolsNote } = await import('../hooks/session/10-base-tools.mjs');

const PRESENT = {
  git: 'git version 2.55.0', node: 'v24.21.0', uv: 'uv 0.13.0', claude: '2.1.296 (Claude Code)', gh: 'gh version 2.102.0',
  'codebase-memory-mcp': 'codebase-memory-mcp 0.11.0', mempalace: 'MemPalace 3.10.0', skillspector: 'SkillSpector v2.12.0', gitleaks: '8.30.1',
};
const BIN_OF = { 'claude-code': 'claude' };

function fakeBin(dir, name, text, cbmConfig = 'false') {
  if (WIN) {
    const cfg = name === 'codebase-memory-mcp' ? `@if "%1"=="config" (echo ${cbmConfig}& exit /b 0)\r\n` : '';
    fs.writeFileSync(path.join(dir, `${name}.cmd`), `@echo off\r\n${cfg}echo ${text}\r\n`);
  } else {
    const cfg = name === 'codebase-memory-mcp' ? `[ "$1" = config ] && { echo ${cbmConfig}; exit 0; }\n` : '';
    fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${cfg}echo "${text}"\n`, { mode: 0o755 });
  }
}

// A sandbox: fake home (plugins registry, MemPalace config) and a PATH with only the given fake tools.
function sandbox({ tools = {}, plugins = [], marketplaces = [], palace = false, mpConfig = null, cbmConfig = 'false' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-setup-'));
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  const mp = path.join(home, '.config', 'mempalace');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
  for (const [name, text] of Object.entries(tools)) fakeBin(bin, name, text, cbmConfig);
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
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(path|mempal_dir|mempalace_config_dir|xdg_config_home|fk_home)$/i.test(k)));
  Object.assign(env, { PATH: bin, HOME: home, USERPROFILE: home, FK_OMC_LATEST: '5.7.2' });
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
      env: sb.env, out: (s = '') => lines.push(s), isTTY: false, has: () => false, userPath: (dir) => { sb.userPath = dir; return true; },
      exec: (step) => { ran.push(step); return extra.exec ? extra.exec(step) : { ok: true }; },
      ...extra.deps,
    });
    return { code, out: lines.join('\n').replace(/\x1b\[\d+m/g, ''), ran };
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}
const readLedger = (sb) => { try { return fs.readFileSync(path.join(sb.fk, 'install-ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const readStatus = (sb) => JSON.parse(fs.readFileSync(path.join(sb.fk, 'base-tools.json'), 'utf8'));

test('compat.lock.json pins every base tool and is dated', () => {
  assert.equal(LOCK.checked, '2026-10-14');
  for (const id of ['git', 'node', 'uv', 'claude-code', 'gh', 'oh-my-claudecode', 'codebase-memory-mcp', 'mempalace', 'skillspector', 'gitleaks', 'founder-kit']) {
    assert.ok(LOCK.tools[id], id);
    assert.match(LOCK.tools[id].version, /^\d+\.\d+\.\d+$/, `${id} version`);
  }
  assert.match(LOCK.tools.skillspector.commit, /^[0-9a-f]{40}$/);
  for (const [id, t] of Object.entries(LOCK.tools)) if (t.min) assert.ok(cmpVer(t.min, t.version) <= 0, `${id}: min <= version`);
});

test('dry run with nothing installed: full plan, nothing executed or written', async () => {
  const sb = sandbox();
  try {
    const r = await setup(sb, ['--dry-run']);
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
    assert.doesNotMatch(r.out, /GitHub CLI \(optional\) \(/, 'gh not planned without --with-gh');
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
  } finally { sb.cleanup(); }
});

test('no consent without --yes when nobody can answer: nothing runs, status says red', async () => {
  const sb = sandbox({ ...READY, tools: without('gitleaks') });
  try {
    const r = await setup(sb, []);
    assert.equal(r.code, 1);
    assert.equal(r.ran.length, 0);
    assert.match(r.out, /Install gitleaks/);
    assert.match(r.out, /fk setup --yes/);
    assert.equal(readStatus(sb).tools.gitleaks.level, 'red');
    assert.equal(readLedger(sb).length, 0);
  } finally { sb.cleanup(); }
});

test('a "no" at the prompt installs nothing', async () => {
  const sb = sandbox({ ...READY, tools: without('gitleaks') });
  try {
    const r = await setup(sb, [], { deps: { isTTY: true, ask: async () => false } });
    assert.equal(r.code, 1);
    assert.equal(r.ran.length, 0);
  } finally { sb.cleanup(); }
});

test('--yes installs, verifies, writes the ledger; a second run is a no-op', async () => {
  const sb = sandbox({ ...READY, tools: without('gitleaks', 'skillspector') });
  // The recording exec "installs" by dropping the fake binary in place.
  const exec = (step) => { fakeBin(sb.bin, BIN_OF[step.tool] || step.tool, PRESENT[BIN_OF[step.tool] || step.tool]); return { ok: true }; };
  try {
    const r = await setup(sb, ['--yes'], { exec });
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(r.ran.map((s) => s.tool).sort(), ['gitleaks', 'skillspector']);
    const ledger = readLedger(sb);
    assert.equal(ledger.length, 2);
    for (const e of ledger) {
      assert.equal(e.ok, true);
      assert.equal(e.via, 'fk setup');
      assert.ok(e.rollback && e.command && e.ts);
    }
    assert.equal(ledger.find((e) => e.tool === 'skillspector').version, LOCK.tools.skillspector.commit);
    assert.equal(ledger.find((e) => e.tool === 'gitleaks').version, LOCK.tools.gitleaks.version);
    assert.equal(readStatus(sb).tools.gitleaks.level, 'green');

    const again = await setup(sb, ['--yes'], { exec });
    assert.equal(again.code, 0);
    assert.equal(again.ran.length, 0, 'idempotent');
    assert.equal(readLedger(sb).length, 2);
  } finally { sb.cleanup(); }
});

test('a failed step is logged as failed and the run stays red', async () => {
  const sb = sandbox({ ...READY, tools: without('gitleaks') });
  try {
    const r = await setup(sb, ['--yes'], { exec: () => ({ ok: false }) });
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
    fs.writeFileSync(path.join(sb.home, '.local', 'bin', 'fk'), '#!/bin/sh\necho mine\n');
    assert.match((await setup(sb, ['--shim'])).out, /kept your own/);
    assert.equal(fs.readFileSync(path.join(sb.home, '.local', 'bin', 'fk'), 'utf8'), '#!/bin/sh\necho mine\n');
  } finally { sb.cleanup(); }
});

test('settings: CBM auto_index on is planned off; an existing palace and the user\'s silent_save choice are kept', async () => {
  const sb = sandbox({ ...READY, cbmConfig: 'true', mpConfig: { backend: 'chroma', hooks: { silent_save: false } } });
  try {
    const r = await setup(sb, ['--dry-run']);
    assert.match(r.out, /codebase-memory-mcp config set auto_index false/);
    assert.match(r.out, /codebase-memory-mcp config set auto_watch false/);
    assert.match(r.out, /uses the chroma backend; kept as is/);
    assert.match(r.out, /silent_save is off \(your choice; kept\)/);
    assert.doesNotMatch(r.out, /mempalace init/);
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
    const write = (tools) => { fs.mkdirSync(path.join(home, '.fk'), { recursive: true }); fs.writeFileSync(path.join(home, '.fk', 'base-tools.json'), JSON.stringify({ tools })); };
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
      if (t.exact) assert.ok(src.includes(t.commit || t.version), `${name} pins ${id} at ${t.commit || t.version}`);
      if (t.min) assert.ok(name === 'install.ps1' ? src.includes(`'${id}' = '${t.min}'`) : src.includes(`${id}) echo ${t.min}`), `${name} floor for ${id} = ${t.min}`);
      for (const k of ['marketplace', 'plugin']) if (t[k]) assert.ok(src.includes(t[k]), `${name} has ${t[k]}`);
    }
    assert.ok(src.includes(`'${LOCK.checked}'`) || src.includes(`=${LOCK.checked}`), `${name} lock date`);
    assert.doesNotMatch(src, /@latest|releases\/latest|codebase-memory-mcp\/main\//, `${name}: no unpinned installs`);
    assert.match(src, /bin.fk\.mjs['"]?\)? setup --shim/, `${name}: writes the user-level fk shim through the kit`);
    assert.doesNotMatch(src, /npm-only/, `${name}: an npm OMC is never doubled with the plugin copy`);
    assert.doesNotMatch(src, /[A-Z]:\\Users\\|\/home\/[a-z]|\/Users\/[a-z]/i, `${name}: no personal paths`);
  }
});

const gitBash = WIN ? ['C:\\Program Files\\Git\\bin\\bash.exe'].find((p) => fs.existsSync(p)) : 'bash';
test('install.sh --dry-run: plans from fake tools, writes nothing', { skip: !gitBash && 'bash not found' }, () => {
  const sb = sandbox({ plugins: READY.plugins, marketplaces: READY.marketplaces, palace: true, mpConfig: READY.mpConfig });
  try {
    for (const [name, text] of Object.entries(without('gitleaks'))) {
      const cfg = name === 'codebase-memory-mcp' ? '[ "$1" = config ] && { echo false; exit 0; }\n' : '';
      fs.writeFileSync(path.join(sb.bin, name), `#!/bin/sh\n${cfg}echo "${text}"\n`, { mode: 0o755 });
    }
    const utils = WIN ? 'C:\\Program Files\\Git\\usr\\bin' : '/usr/bin:/bin';
    const env = { ...sb.env, PATH: `${sb.bin}${path.delimiter}${utils}` };
    const r = spawnSync(gitBash, [path.join(REPO, 'install', 'install.sh'), '--dry-run'], { env, encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Dry run: nothing was changed/);
    assert.match(r.stdout, /claude plugin marketplace add nothingbadhappened\/awesome-founder-kit/);
    assert.match(r.stdout, /claude plugin install founder-kit@awesome-founder-kit/);
    assert.match(r.stdout, /Install gitleaks/);
    assert.ok(r.stdout.includes(`V=${LOCK.tools.gitleaks.version}`), 'pinned gitleaks release');
    assert.equal(fs.existsSync(sb.fk), false, 'dry run writes nothing');
  } finally { sb.cleanup(); }
});

test('install.ps1 parses under Windows PowerShell', { skip: !WIN && 'Windows only' }, () => {
  const file = path.join(REPO, 'install', 'install.ps1');
  const r = spawnSync('powershell', ['-NoProfile', '-Command',
    `$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('${file}', [ref]$null, [ref]$e); if ($e) { $e | ForEach-Object { $_.Message }; exit 1 }`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
