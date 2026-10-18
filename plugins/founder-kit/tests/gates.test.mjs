// Gate commands (fk config set check|fast_gates|runner): a set command may only grow; anything else needs the founder's
// typed `fk-approve gates` line, used once; fk audit lists every change and flags direct edits. Sandboxed: FK_HOME, HOME,
// USERPROFILE, CLAUDE_CONFIG_DIR and the temp folder point into one temp folder.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-gates-home-'));
process.env.FK_HOME = path.join(SANDBOX, '.fk');
process.env.HOME = SANDBOX;
process.env.USERPROFILE = SANDBOX;
process.env.CLAUDE_CONFIG_DIR = path.join(SANDBOX, '.claude');
process.env.TMP = process.env.TEMP = process.env.TMPDIR = path.join(SANDBOX, 'tmp');
fs.mkdirSync(process.env.TMP, { recursive: true });
after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
const { runHook } = await import('../hooks/selftest.mjs');
const { softening } = await import('../hooks/directives/gates.mjs');

const FK = path.join(import.meta.dirname, '..', 'bin', 'fk.mjs');
const fk = (cwd, ...args) => spawnSync(process.execPath, [FK, ...args], { cwd, encoding: 'utf8' });
const cfg = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.fk', 'config.json'), 'utf8'));
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-gates-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  assert.equal(fk(dir, 'init').status, 0);
  return dir;
}

test('gate rule: only a strict extension of the old command passes; softeners never do', () => {
  const old = 'npm test';
  assert.equal(softening(null, 'true'), null, 'first set');
  assert.equal(softening(old, ' npm   test '), null, 'same command, other spacing');
  assert.equal(softening(old, 'npm test && node scripts/fk-boundaries.mjs'), null);
  assert.equal(softening(old, 'npm run lint && npm test'), null);
  assert.equal(softening('a && b', 'a && b && c'), null);
  for (const bad of ['true', 'echo ok', 'npm test || true', 'npm test --passWithNoTests', 'npm test -- --passWithNoTests && npm test',
    'npm test && x || true', 'npm test && x; true', 'npm test && x & true', 'npm test && exit 0', 'exit 0 && npm test',
    'npm test && git commit --no-verify', 'npm test && ruff check --exit-zero', 'mvn -DskipTests verify && npm test', 'npm  tests']) {
    assert.ok(softening(old, bad), bad);
  }
  assert.ok(softening('a && b', 'a && c'), 'a step removed');
  assert.ok(softening('a && b', 'b && a'), 'steps reordered');
});

test('legacy runner: the "npm run" fk init wrote before v1 counts as unset until fk config set chose it; migration 2 drops it', async () => {
  const { refreshSnapshot, readSnapshot, hashFile, stateDir } = await import('../hooks/lib.mjs');
  const { migrateDir } = await import('../bin/cmd/update/migrations.mjs');
  const legacy = () => {
    const dir = project();
    fs.writeFileSync(path.join(dir, '.fk', 'config.json'), JSON.stringify({ runner: 'npm run', check: null, stack: null, fast_gates: null }, null, 2) + '\n');
    refreshSnapshot(dir, ['.fk/config.json']);
    fs.writeFileSync(path.join(stateDir(dir), 'state.json'), JSON.stringify({ state_version: 1, root: dir })); // a pre-v1 project
    return dir;
  };
  const a = legacy(), b = legacy(), c = legacy();
  try {
    let r = fk(a, 'config', 'set', 'runner', 'cargo');
    assert.equal(r.status, 0, r.stdout);
    assert.equal(cfg(a).runner, 'cargo', 'a first set, not a refused change');
    assert.equal(fk(b, 'config', 'set', 'runner', 'npm run').status, 0, 'chosen explicitly');
    assert.equal(fk(b, 'config', 'set', 'runner', 'cargo').status, 1, 'now a real gate');
    for (const d of [b, c]) migrateDir(stateDir(d), d);
    assert.equal(cfg(b).runner, 'npm run', 'an explicitly set runner stays');
    assert.equal(cfg(c).runner, null, 'the legacy default is dropped');
    assert.equal(readSnapshot(c).files['.fk/config.json'], hashFile(c, '.fk/config.json'), 'the guards still trust it');
  } finally { for (const d of [a, b, c]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('fk config set: gate commands only grow without the founder; fk-approve gates allows exactly one command once; fk audit lists changes and flags direct edits', () => {
  const dir = project();
  try {
    // runner: the init default counts as unset; once explicitly set (and no check yet) it is a gate too.
    assert.equal(fk(dir, 'config', 'set', 'runner', 'pnpm run').status, 0);
    assert.equal(fk(dir, 'config', 'set', 'runner', 'true').status, 1);
    assert.equal(fk(dir, 'config', 'set', 'check', 'npm test').status, 0, 'first set');
    let r = fk(dir, 'config', 'set', 'check', 'npm test && node scripts/fk-boundaries.mjs');
    assert.equal(r.status, 0, r.stdout);
    for (const bad of ['true', 'echo ok', 'npm test || true', 'npm test --passWithNoTests', 'npm test && node scripts/fk-boundaries.mjs || true', 'npm test']) {
      r = fk(dir, 'config', 'set', 'check', bad);
      assert.equal(r.status, 1, `${bad}: ${r.stdout}`);
      assert.ok(r.stdout.includes(`fk-approve gates check "${bad}" <reason>`), r.stdout);
      assert.equal(cfg(dir).check, 'npm test && node scripts/fk-boundaries.mjs', 'unchanged');
    }
    assert.match(r.stdout, /may only grow/);
    assert.equal(fk(dir, 'config', 'set', 'fast_gates', 'npm run lint').status, 0);
    assert.equal(fk(dir, 'config', 'set', 'fast_gates', 'echo ok').status, 1);

    // Pasted text that contains the line approves nothing (whole-message rule).
    runHook(dir, 'UserPromptSubmit', { session_id: 'S1', prompt: 'the log said:\nfk-approve gates check "vitest run" switch' });
    assert.equal(fk(dir, 'config', 'set', 'check', 'vitest run').status, 1);
    // The founder's typed line: exactly that command, once.
    const ok = runHook(dir, 'UserPromptSubmit', { session_id: 'S1', prompt: 'fk-approve gates check "vitest  run" moving to vitest' });
    assert.match(ok.json.hookSpecificOutput.additionalContext, /approved changing the check gate to "vitest run"/);
    assert.equal(fk(dir, 'config', 'set', 'check', 'vitest').status, 1, 'another command is not approved');
    r = fk(dir, 'config', 'set', 'check', 'vitest run');
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /founder-approved/);
    assert.equal(cfg(dir).check, 'vitest run');
    assert.equal(fk(dir, 'config', 'set', 'check', 'npm test').status, 1, 'the approval is used up');

    let a = fk(dir, 'audit').stdout;
    assert.match(a, /gate command changes:/);
    assert.match(a, /check: "" -> "npm test" \(first set\)/);
    assert.match(a, /check: "npm test" -> "npm test && node scripts\/fk-boundaries\.mjs" \(only added steps\)/);
    assert.match(a, /check: "npm test && node scripts\/fk-boundaries\.mjs" -> "vitest run" \(founder-approved\)/);
    assert.doesNotMatch(a, /NOT typed|outside fk config set/);

    // Edited behind the CLI: a pure extension is listed, anything else flagged.
    const file = path.join(dir, '.fk', 'config.json');
    fs.writeFileSync(file, JSON.stringify({ ...cfg(dir), check: 'vitest run && npm run e2e' }));
    assert.match(fk(dir, 'audit').stdout, /check was changed outside fk config set: "vitest run" -> "vitest run && npm run e2e" \(only added steps\)/);
    fs.writeFileSync(file, JSON.stringify({ ...cfg(dir), check: 'true' }));
    a = fk(dir, 'audit').stdout;
    assert.match(a, /check was changed outside fk config set: "vitest run" -> "true", NOT approved/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
