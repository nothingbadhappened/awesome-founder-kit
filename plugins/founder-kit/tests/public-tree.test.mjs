// The public repository holds only what scripts/export-public.sh exports (README, install/, plugins/, ...): no scripts/,
// docs/ or .omc/. A test reading one of those must skip when it is absent, or the suite fails in the public tree.
// To run the suite as the public tree sees it: copy the PUBLIC paths listed in scripts/export-public.sh into an empty
// folder, then run `node --test "plugins/founder-kit/tests/*.test.mjs"` there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const PRIVATE = ['scripts', 'docs', '.omc'];

test('tests read private repo paths (scripts/, docs/, .omc/) only behind an existsSync guard', () => {
  const bad = [];
  for (const f of fs.readdirSync(HERE).filter((n) => n.endsWith('.mjs'))) {
    const src = fs.readFileSync(path.join(HERE, f), 'utf8');
    for (const [i, line] of src.split('\n').entries()) {
      // path.join(REPO, '<private>' ...): the repo root, not a temp project folder.
      const m = new RegExp(String.raw`path\.(?:join|resolve)\(\s*REPO\s*,\s*['"](${PRIVATE.map((p) => p.replace('.', '\\.')).join('|')})['"/]`).exec(line);
      if (!m) continue;
      const name = /^\s*const\s+(\w+)\s*=/.exec(line)?.[1];
      if (!name || !new RegExp(String.raw`existsSync\(\s*${name}\s*\)`).test(src)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
    }
  }
  assert.deepEqual(bad, [], 'assign the path to a const and skip the test when !fs.existsSync(<const>)');
});

test('the private-path check sees an unguarded read and accepts a guarded one', () => {
  const unguarded = "const src = fs.readFileSync(path.join(REPO, '" + 'scripts' + "', 'x.sh'), 'utf8');"; // built, so the scan above skips it
  const re = new RegExp(String.raw`path\.(?:join|resolve)\(\s*REPO\s*,\s*['"](scripts|docs|\.omc)['"/]`);
  assert.ok(re.test(unguarded));
  assert.equal(/^\s*const\s+(\w+)\s*=/.exec(unguarded)?.[1], 'src');
  assert.ok(!/existsSync\(\s*src\s*\)/.test(unguarded), 'no guard: reported');
});
