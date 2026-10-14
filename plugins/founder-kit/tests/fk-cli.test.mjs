import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CASES, CLEAN_TWINS, runHook, outcome } from '../hooks/selftest.mjs';
import { stateFile, stateDir } from '../hooks/lib.mjs';

const FK = path.join(import.meta.dirname, '..', 'bin', 'fk.mjs');
const fk = (cwd, ...args) => spawnSync(process.execPath, [FK, ...args], { cwd, encoding: 'utf8' });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

test('fk init refuses outside a git repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-cli-'));
  try {
    const r = fk(dir, 'init');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /not inside a git repository/);
    assert.equal(fs.existsSync(path.join(dir, '.fk')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fk init, audit and uninstall round-trip; .omc and docs untouched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-cli-'));
  try {
    git(dir, 'init', '-q');
    fs.mkdirSync(path.join(dir, '.omc'));
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.writeFileSync(path.join(dir, '.omc', 'state.json'), '{}');
    fs.writeFileSync(path.join(dir, 'docs', 'a.md'), '# a');
    const r = fk(dir, 'init');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const f of ['config.json', 'toolchain.json', 'budgets.json']) assert.ok(fs.existsSync(path.join(dir, '.fk', f)), f);
    assert.ok(fs.existsSync(stateFile(dir, 'snapshots.json')), 'snapshot outside the repo');
    assert.equal(fs.existsSync(path.join(dir, '.fk', 'snapshots.json')), false);
    assert.ok(fs.existsSync(path.join(dir, '.githooks', 'pre-commit')));
    assert.match(git(dir, 'ls-files', '-s', '.githooks/pre-commit').stdout, /^100755 /, 'exec bit in the index (Windows too)');
    assert.equal(git(dir, 'config', '--get', 'core.hooksPath').stdout.trim(), '.githooks');

    fs.writeFileSync(stateFile(dir, 'compliance.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), event: 'PreToolUse', guard: 'secret-guard', decision: 'deny', tool: 'Bash', reason: 'fk secret-guard: test' }) + '\n'
      + JSON.stringify({ ts: new Date().toISOString(), event: 'PreToolUse', guard: 'install-guard', decision: 'would-deny', tool: 'Bash' }) + '\n');
    const a = fk(dir, 'audit');
    assert.match(a.stdout, /1 installs would have been blocked/);
    assert.match(a.stdout, /1 actions were blocked/);
    assert.match(a.stdout, /secret-guard 1/);

    const u = fk(dir, 'uninstall');
    assert.equal(u.status, 0);
    assert.equal(fs.existsSync(path.join(dir, '.fk')), false);
    assert.equal(fs.existsSync(stateDir(dir)), false, 'kit state removed too');
    assert.equal(fs.existsSync(path.join(dir, '.githooks')), false);
    assert.equal(git(dir, 'config', '--get', 'core.hooksPath').stdout.trim(), '');
    assert.ok(fs.existsSync(path.join(dir, '.omc', 'state.json')));
    assert.ok(fs.existsSync(path.join(dir, 'docs', 'a.md')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fk init leaves the index alone when the repo has uncommitted changes (adoption)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-cli-'));
  try {
    git(dir, 'init', '-q');
    fs.writeFileSync(path.join(dir, 'a.js'), '1');
    git(dir, 'add', 'a.js');
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'init');
    fs.writeFileSync(path.join(dir, 'a.js'), '2'); // work in progress
    const r = fk(dir, 'init');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(fs.existsSync(path.join(dir, '.githooks', 'pre-commit')));
    assert.equal(git(dir, 'ls-files', '.githooks/pre-commit').stdout.trim(), '', 'not staged');
    assert.match(r.stdout, /git add --chmod=\+x \.githooks\/pre-commit/);
  } finally { fs.rmSync(stateDir(dir), { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fk audit names overrides and approvals no founder-typed line recorded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-cli-'));
  try {
    git(dir, 'init', '-q');
    fk(dir, 'init');
    runHook(dir, 'UserPromptSubmit', { session_id: 'S1', prompt: 'fk-approve tool biome@1.9.4 formatter' });
    runHook(dir, 'UserPromptSubmit', { session_id: 'S1', prompt: 'fk-override gate-guard migrate' });
    assert.doesNotMatch(fk(dir, 'audit').stdout, /NOT typed/);
    const tc = path.join(dir, '.fk', 'toolchain.json');
    fs.writeFileSync(tc, JSON.stringify({ ...JSON.parse(fs.readFileSync(tc, 'utf8')), approved: ['biome@1.9.4', 'evil@1.0.0'] }));
    const ov = JSON.parse(fs.readFileSync(stateFile(dir, 'overrides.json'), 'utf8'));
    ov.overrides.push({ ...ov.overrides[0], guard: 'install-guard', reason: 'forged' });
    fs.writeFileSync(stateFile(dir, 'overrides.json'), JSON.stringify(ov));
    const a = fk(dir, 'audit').stdout;
    assert.match(a, /NOT typed by you, review: override of install-guard \(forged\); tool evil@1\.0\.0\./);
    assert.doesNotMatch(a, /biome|gate-guard \(/);
    fk(dir, 'uninstall');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('pre-commit template: no fast_gates -> exit 0 with a note; failing gate -> exit 1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-cli-'));
  try {
    git(dir, 'init', '-q');
    fk(dir, 'init');
    const hook = path.join(dir, '.githooks', 'pre-commit');
    let r = spawnSync('sh', [hook], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /no fast_gates/);
    const cfgFile = path.join(dir, '.fk', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    fs.writeFileSync(cfgFile, JSON.stringify({ ...cfg, fast_gates: 'exit 3' }));
    r = spawnSync('sh', [hook], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fk doctor --hooks prints a green planted-violation table', () => {
  const r = fk(os.tmpdir(), 'doctor', '--hooks');
  assert.match(r.stdout, /planted: cat \.env/);
  const planted = r.stdout.split('\n').filter((l) => l.includes('planted:'));
  assert.equal(planted.length, CASES.length);
  const clean = r.stdout.split('\n').filter((l) => l.includes('clean: '));
  assert.equal(clean.length, CLEAN_TWINS.length);
  for (const l of [...planted, ...clean]) assert.match(l, /green/, l);
});

const fakeBin = (dir, name, body) => {
  const bin = path.join(dir, 'fakebin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return bin;
};

test('pre-commit: gitleaks runs first and blocks on a finding; missing gitleaks only warns', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-cli-'));
  try {
    git(dir, 'init', '-q');
    fk(dir, 'init');
    const hook = path.join(dir, '.githooks', 'pre-commit');
    const sh = (PATH) => spawnSync('sh', [hook], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH } });
    const leaky = fakeBin(dir, 'gitleaks', 'echo "gitleaks $*" >&2; exit 1');
    let r = sh(`${leaky}${path.delimiter}${process.env.PATH}`);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /gitleaks git --pre-commit --staged --redact --no-banner/);
    assert.match(r.stdout, /looks like a secret/);
    const clean = fakeBin(path.join(dir, 'c'), 'gitleaks', 'exit 0');
    r = sh(`${clean}${path.delimiter}${process.env.PATH}`);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /no fast_gates/);
    if (spawnSync('sh', ['-c', 'command -v gitleaks'], { encoding: 'utf8' }).status !== 0) {
      r = sh(process.env.PATH);
      assert.equal(r.status, 0);
      assert.match(r.stdout, /gitleaks not installed/);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// fk doctor's OMC line with an installed OMC plugin in a fake home and a mocked latest version.
function doctorOmc(version, latest) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-home-'));
  try {
    const install = path.join(home, 'omc');
    fs.mkdirSync(path.join(install, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(install, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'oh-my-claudecode', version }));
    fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'oh-my-claudecode@omc': [{ installPath: install, version }] } }));
    const r = spawnSync(process.execPath, [FK, 'doctor'], { cwd: home, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home, FK_HOME: path.join(home, '.fk'), FK_OMC_LATEST: latest } });
    return r.stdout.split('\n').find((l) => / oh-my-claudecode /.test(l)) || '';
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

test('fk doctor: OMC version policy (floor = latest major - 1)', () => {
  assert.match(doctorOmc('3.9.0', '5.7.2'), /red\W.*below the supported floor 4\.0\.0; 5\.7\.2 is out.*\/plugin update oh-my-claudecode@omc/);
  assert.match(doctorOmc('5.6.0', '5.7.2'), /yellow\W.*5\.6\.0 \(plugin\); 5\.7\.2 is out/);
  assert.match(doctorOmc('5.7.2', '5.7.2'), /green\W.*the latest/);
  assert.match(doctorOmc('5.7.2', 'offline'), /green\W.*latest unknown \(offline\)/);
});

test('fk doctor: gitleaks older than 8.19 is red; project .fk/ absent is yellow', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-cli-'));
  try {
    const doc = (ver) => {
      const bin = fakeBin(path.join(dir, ver), 'gitleaks', `echo ${ver}`);
      fs.writeFileSync(path.join(bin, 'gitleaks.cmd'), `@echo ${ver}\r\n`);
      const env = { ...process.env, FK_OMC_LATEST: 'offline', PATH: `${bin}${path.delimiter}${process.env.PATH}` };
      return spawnSync(process.execPath, [FK, 'doctor'], { cwd: dir, encoding: 'utf8', env }).stdout.split('\n');
    };
    let rows = doc('8.18.4');
    assert.match(rows.find((l) => /gitleaks/.test(l)), /red\W.*8\.18\.4: too old/);
    assert.match(rows.find((l) => /project \.fk\//.test(l)), /yellow\W.*expected before fk init/);
    rows = doc('8.21.2');
    assert.match(rows.find((l) => /gitleaks/.test(l)), /green\W.*8\.21\.2/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('integration: fk-start flow against an active .fk/', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-cli-'));
  const post = (command) => runHook(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command }, tool_response: {} });
  const pre = (command) => outcome(runHook(dir, 'PreToolUse', { tool_name: 'Bash', tool_input: { command } }));
  const omcJsonc = path.join(dir, '.claude', 'omc.jsonc');
  try {
    git(dir, 'init', '-q');
    assert.equal(fk(dir, 'init').status, 0);
    assert.equal(fk(dir, 'kickoff', 'protect').status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(omcJsonc, 'utf8')).keywordDetector.disabled, ['autopilot', 'ralph']);
    assert.equal(post('fk kickoff protect').stdout, '', 'no tamper block after kickoff protect');
    assert.equal(pre('npm i -g left-pad'), 'allow', 'log-only before the first approval');

    const ok = runHook(dir, 'UserPromptSubmit', { prompt: 'fk-approve tool pnpm@9.1.0 package manager for the project' });
    assert.match(ok.json.hookSpecificOutput.additionalContext, /approved pnpm@9\.1\.0/);
    assert.equal(pre('npm i -g pnpm@9.1.0'), 'allow');
    assert.equal(pre('npm i -g left-pad'), 'deny', 'enforced after the first approval');

    const set = fk(dir, 'config', 'set', 'fast_gates', 'node -e 0');
    assert.equal(set.status, 0, set.stdout);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.fk', 'config.json'), 'utf8')).fast_gates, 'node -e 0');
    assert.equal(fk(dir, 'config', 'set', 'paths', 'x').status, 1, 'only agent-writable keys');
    assert.equal(post('fk config set fast_gates "node -e 0"').stdout, '');

    assert.equal(fk(dir, 'kickoff', 'release').status, 0);
    assert.equal(fs.existsSync(omcJsonc), false, 'created by fk, so removed when empty');
    assert.equal(post('fk kickoff release').stdout, '');

    assert.equal(fk(dir, 'uninstall').status, 0);
    assert.equal(fs.existsSync(path.join(dir, '.fk')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fk kickoff keeps other omc.jsonc keys and founder-disabled keywords', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-cli-'));
  try {
    git(dir, 'init', '-q');
    fk(dir, 'init');
    const f = path.join(dir, '.claude', 'omc.jsonc');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '{\n  // founder settings\n  "team": { "size": 2 },\n  "keywordDetector": { "disabled": ["ralph"] },\n}\n');
    fk(dir, 'kickoff', 'protect');
    assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')).keywordDetector.disabled, ['ralph', 'autopilot']);
    fk(dir, 'kickoff', 'release');
    assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { team: { size: 2 }, keywordDetector: { disabled: ['ralph'] } });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
