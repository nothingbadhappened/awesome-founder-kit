// Ordinary development must never be stopped: each case runs in an active .fk project with an approved toolchain
// and must come back allow (no ask, no deny). The guards are speed bumps; a false positive here is a bug.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CLEAN_TWINS, makeFixture, runHook, outcome } from '../hooks/selftest.mjs';
import { stateDir } from '../hooks/lib.mjs';

const dir = makeFixture();
test.after(() => { fs.rmSync(stateDir(dir), { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); });

test('the clean-twin corpus has at least 40 cases', () => assert.ok(CLEAN_TWINS.length >= 40, String(CLEAN_TWINS.length)));

for (const [name, make] of CLEAN_TWINS) {
  test(`clean: ${name} -> allow`, () => {
    const { event, payload } = make(dir);
    const res = runHook(dir, event, payload);
    assert.equal(res.code, 0);
    assert.equal(outcome(res), 'allow', res.stdout);
  });
}
