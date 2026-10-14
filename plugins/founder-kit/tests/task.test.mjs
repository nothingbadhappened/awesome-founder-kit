// fk risk, fk task (records, reviewer independence, override), fk metrics and the weekly metrics note. Sandboxed:
// FK_HOME and HOME point at a temp folder; transcripts come from a synthetic FK_TRANSCRIPTS folder.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-task-home-'));
process.env.FK_HOME = path.join(SANDBOX, '.fk');
process.env.HOME = SANDBOX;
process.env.USERPROFILE = SANDBOX;
process.env.CLAUDE_CONFIG_DIR = path.join(SANDBOX, '.claude');
process.env.FK_TRANSCRIPTS = path.join(SANDBOX, 'transcripts');
process.env.TMP = process.env.TEMP = process.env.TMPDIR = path.join(SANDBOX, 'tmp');
fs.mkdirSync(process.env.TMP, { recursive: true });
const { stateFile, writeJson, readJson } = await import('../hooks/lib.mjs');
const { runHook } = await import('../hooks/selftest.mjs');
const { assess } = await import('../bin/cmd/risk.mjs');
const { importOmc } = await import('../bin/cmd/task.mjs');

const KIT = path.join(import.meta.dirname, '..');
const FK = path.join(KIT, 'bin', 'fk.mjs');
const dirs = [];
after(() => { for (const d of [...dirs, SANDBOX]) fs.rmSync(d, { recursive: true, force: true }); });

const fk = (cwd, ...args) => spawnSync(process.execPath, [FK, ...args], { cwd, encoding: 'utf8', env: { ...process.env, FK_TODAY: '2026-01-02' } });
const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' });
const put = (dir, f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };

// A repo on main with one commit, kit initialised, on a feature branch.
function repo(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-task-'));
  dirs.push(dir);
  git(dir, 'init', '-q');
  git(dir, 'checkout', '-q', '-b', 'main');
  put(dir, 'README.md', '# App\n\nA small app that does things.\n');
  put(dir, 'src/app.js', 'export const x = 1;\n');
  for (const [f, t] of Object.entries(files)) put(dir, f, t);
  assert.equal(fk(dir, 'init').status, 0);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  git(dir, 'checkout', '-q', '-b', 'feat');
  return dir;
}
const author = (dir, rows) => fs.appendFileSync(stateFile(dir, 'authorship.jsonl'), rows.map((r) => JSON.stringify({ ts: new Date().toISOString(), session_id: 's', ...r }) + '\n').join(''));
const acs = (dir, id, list) => {
  const f = path.join(dir, 'docs', 'tasks', `${id}.md`);
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/ {2}- AC-1: .*\n/, list.map((a, i) => `  - AC-${i + 1}: ${a}\n`).join('')));
};
const review = (dir, id, n, body) => put(dir, `docs/tasks/${id}.review-${n}.md`, body);

// ---- risk ----
test('fk risk: a README typo is R0', () => {
  const dir = repo();
  put(dir, 'README.md', '# App\n\nA small app that does thing.\n');
  const r = assess(dir);
  assert.equal(r.class, 'R0', r.reasons.join('\n'));
  assert.deepEqual(r.files, ['README.md']);
});

test('fk risk: an auth file and a migration are R3, with plain reasons', () => {
  const dir = repo();
  put(dir, 'src/auth/login.js', 'export function login() {}\n');
  let r = assess(dir);
  assert.equal(r.class, 'R3');
  assert.ok(r.reasons.some((x) => /auth or permissions: src\/auth\/login\.js/.test(x)), r.reasons.join('\n'));
  fs.rmSync(path.join(dir, 'src', 'auth'), { recursive: true });
  put(dir, 'db/migrations/001_add_users.sql', 'create table users (id int);\n');
  r = assess(dir);
  assert.equal(r.class, 'R3');
  assert.ok(r.reasons.some((x) => /migrations or schema/.test(x)));
  const j = JSON.parse(fk(dir, 'risk', '--json').stdout);
  assert.equal(j.class, 'R3');
  assert.match(fk(dir, 'risk').stdout, /proposed R3[\s\S]*never lower/);
});

test('fk risk: a directory word is R3, a file-name-only word is R2; dropped words and data files are not R3', () => {
  const cases = {
    'src/hooks/useSession.ts': ['export function useSession() { setTimeout(() => {}, 1000); }\n', 'R1'],
    'src/components/ExportButton.tsx': ['export const ExportButton = () => null;\n', 'R1'],
    'src/lib/formatMoney.ts': ['export const formatMoney = (n) => n.toFixed(2);\n', 'R2'],
    'scripts/wallet.gd': ['extends Node\nvar coins = 0\n', 'R2'],
    'assets/consent-form.pdf': ['%PDF-1.4\n', 'R2'],
    'src/middleware/cors.ts': ['export const origins = [];\n', 'R2'],
    'research/data/session-notes.csv': ['date,topic\n2026-01-01,intro\n', 'R1'],
    'src/auth/token.ts': ['export const t = 1;\n', 'R3'],
    'migrations/002_add_index.py': ['ops = []\n', 'R3'],
    'payments/plan.ts': ['export const p = 1;\n', 'R3'],
    'infra/main.tf': ['resource "x" "y" {}\n', 'R3'],
    'prisma/schema.prisma': ['model User { id Int @id }\n', 'R3'],
    'tests.py': ['def test_x(): pass\n', 'R0'],
    'src/test/java/app/UserServiceTest.java': ['class UserServiceTest {}\n', 'R0'],
  };
  for (const [f, [text, want]] of Object.entries(cases)) {
    const dir = repo();
    put(dir, f, text);
    const r = assess(dir);
    assert.equal(r.class, want, `${f}: ${r.reasons.join('; ')}`);
  }
  const dir = repo();
  put(dir, 'src/lib/formatMoney.ts', 'export const f = 1;\n');
  assert.ok(assess(dir).reasons.some((x) => /R2: name suggests payments or money \(raise to R3 if it really is\): src\/lib\/formatMoney\.ts/.test(x)));
});

test('fk risk: added lines that call auth or destructive SQL are R3 (Django accounts/views.py)', () => {
  const dir = repo({ 'accounts/views.py': 'def index(request):\n    return None\n' });
  put(dir, 'accounts/views.py', 'def index(request):\n    return None\n\ndef sign_in(request):\n    user = authenticate(request, username=request.POST["u"], password=request.POST["p"])\n');
  let r = assess(dir);
  assert.equal(r.class, 'R3', r.reasons.join('\n'));
  assert.ok(r.reasons.some((x) => /added code mentions authenticate/.test(x)));
  put(dir, 'accounts/views.py', 'def index(request):\n    return {"ok": True}\n');
  assert.equal(assess(dir).class, 'R1', 'no signal on the added lines');
  put(dir, 'docs/notes.md', 'We DROP TABLE nothing; authenticate( is documented here.\n');
  assert.equal(assess(dir).class, 'R1', 'docs are not scanned');
});

test('fk risk: a new dependency is at least R1 (R2); a version bump is not a new dependency', () => {
  const dir = repo({ 'package.json': '{\n  "name": "app",\n  "dependencies": {\n    "a": "1.0.0"\n  }\n}\n' });
  put(dir, 'package.json', '{\n  "name": "app",\n  "dependencies": {\n    "a": "1.1.0"\n  }\n}\n');
  let r = assess(dir);
  assert.ok(!r.reasons.some((x) => /new dependencies/.test(x)), r.reasons.join('\n'));
  put(dir, 'package.json', '{\n  "name": "app",\n  "dependencies": {\n    "a": "1.1.0",\n    "left-pad": "^1.3.0"\n  }\n}\n');
  r = assess(dir);
  assert.ok(['R1', 'R2', 'R3'].includes(r.class));
  assert.ok(r.reasons.some((x) => /new dependencies: left-pad/.test(x)), r.reasons.join('\n'));
});

test('fk risk: fk config set risk_r3 adds a project R3 glob (append-only)', () => {
  const dir = repo();
  put(dir, 'src/pricing/calc.js', 'export const p = 2;\n');
  assert.equal(assess(dir).class, 'R1');
  assert.equal(fk(dir, 'config', 'set', 'risk_r3', 'src/pricing/**').status, 0);
  fk(dir, 'config', 'set', 'risk_r3', 'src/tax/**');
  assert.deepEqual(readJson(path.join(dir, '.fk', 'config.json')).risk.r3, ['src/pricing/**', 'src/tax/**']);
  const r = assess(dir);
  assert.equal(r.class, 'R3');
  assert.ok(r.reasons.some((x) => /project's R3 rule src\/pricing\/\*\*/.test(x)));
});

// ---- tasks ----
test('fk task new: records, ids, start time in the kit state; never writes .omc', () => {
  const dir = repo();
  let r = fk(dir, 'task', 'new', 'Add the export button', '--risk', 'R2');
  assert.equal(r.status, 0, r.stdout);
  const text = fs.readFileSync(path.join(dir, 'docs', 'tasks', 'T-001.md'), 'utf8');
  assert.match(text, /^---\nid: T-001\ntitle: Add the export button\nrisk: R2\ncreated: 2026-01-02\nacceptance:\n {2}- AC-1: <one checkable statement>\n---/);
  assert.doesNotMatch(text, /\{\{/);
  assert.ok(readJson(stateFile(dir, 'tasks.json')).tasks['T-001'].start);
  r = fk(dir, 'task', 'new', 'Second');
  assert.match(r.stdout, /T-002\.md \(declared R1, the default/);
  assert.equal(fs.existsSync(path.join(dir, '.omc')), false);
});

test('fk task new --from-omc imports acceptance criteria (ralph prd.json, ultragoal goals, plan markdown) and offers them', () => {
  const dir = repo();
  put(dir, '.omc/prd.json', JSON.stringify({ project: 'app', branchName: 'feat', description: 'd', userStories: [
    { id: 'US-001', title: 't', description: 'd', acceptanceCriteria: ['Export returns a CSV file', 'Empty list exports a header row'], priority: 1, passes: false }] }));
  put(dir, '.omc/ultragoal/goals.json', JSON.stringify({ version: 1, goals: [{ id: 'G1', title: 'Export', objective: 'Users can export their data' }] }));
  put(dir, '.omc/plans/export.md', '# Plan\n\n## Acceptance Criteria\n- [ ] Button is visible\n- [x] CSV has headers\n\n## Steps\n- not this\n');
  const before = fs.readFileSync(path.join(dir, '.omc', 'prd.json'), 'utf8');
  assert.match(fk(dir, 'task', 'new', 'Plain').stdout, /OMC already has acceptance criteria in: .*\.omc\//);
  const r = fk(dir, 'task', 'new', 'Export', '--from-omc', '.omc/prd.json');
  assert.equal(r.status, 0, r.stdout);
  const text = fs.readFileSync(path.join(dir, 'docs', 'tasks', 'T-002.md'), 'utf8');
  assert.match(text, /AC-1: Export returns a CSV file\n {2}- AC-2: Empty list exports a header row/);
  assert.match(text, /omc: \.omc\/prd\.json/);
  assert.equal(fs.readFileSync(path.join(dir, '.omc', 'prd.json'), 'utf8'), before, '.omc is read only');
  assert.deepEqual(importOmc(dir, '.omc/ultragoal/goals.json'), ['Export: Users can export their data']);
  assert.deepEqual(importOmc(dir, '.omc/plans/export.md'), ['Button is visible', 'CSV has headers']);
  assert.equal(fk(dir, 'task', 'new', 'Bad', '--from-omc', 'README.md').status, 1);
  const forms = {
    '### Acceptance\n- [ ] A\n- [ ] B\n### Next\n- no': ['A', 'B'],
    '## Success Criteria\n- [ ] A\n\n## Risks\n- no': ['A'],
    '**Acceptance Criteria**\n- [ ] A\n- [x] B\n\n**Notes**\n- no': ['A', 'B'],
    '## Acceptance testing plan\n- no\n## Acceptance Criteria\n- A': ['A'],
  };
  for (const [md, want] of Object.entries(forms)) {
    put(dir, '.omc/plans/form.md', `# Plan\n\n${md}\n`);
    assert.deepEqual(importOmc(dir, '.omc/plans/form.md'), want, md);
  }
});

test('fk task check: R1 needs only an independent ACCEPT; from R2 every AC needs a PASS line; a reviewer that codes after its review still counts', () => {
  const dir = repo();
  fk(dir, 'task', 'new', 'Small change', '--risk', 'R1');
  acs(dir, 'T-001', ['x is 7']);
  put(dir, 'src/app.js', 'export const x = 7;\n');
  review(dir, 'T-001', 1, `${fk(dir, 'task', 'stamp', 'T-001').stdout.trim()}\nVerdict: ACCEPT\n`);
  author(dir, [{ agent_id: 'r1', agent_type: 'oh-my-claudecode:code-reviewer', path: 'docs/tasks/T-001.review-1.md' }]);
  let r = fk(dir, 'task', 'check', 'T-001');
  assert.equal(r.status, 0, r.stdout);
  // The same reviewer later touches code (e.g. asked to) without changing what it reviewed: its stamped review still counts.
  fs.appendFileSync(stateFile(dir, 'authorship.jsonl'), JSON.stringify({ ts: new Date(Date.now() + 5000).toISOString(), session_id: 's', agent_id: 'r1', agent_type: 'code-reviewer', path: 'src/app.js' }) + '\n');
  r = fk(dir, 'task', 'check', 'T-001');
  assert.equal(r.status, 0, r.stdout);
  // Without a Reviewed line, code written after the review makes it a review of an older version.
  review(dir, 'T-001', 1, 'Verdict: ACCEPT\n');
  r = fk(dir, 'task', 'check', 'T-001');
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /not counted: docs\/tasks\/T-001\.review-1\.md: reviewed an older version; re-review needed/);
  review(dir, 'T-001', 1, `${fk(dir, 'task', 'stamp', 'T-001').stdout.trim()}\nVerdict: ACCEPT\n`);
  // R2: the same Verdict-only review is not enough.
  const f = path.join(dir, 'docs', 'tasks', 'T-001.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('risk: R1', 'risk: R2'));
  r = fk(dir, 'task', 'check', 'T-001');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /AC-1: no verdict from an independent reviewer/);
  assert.match(r.stdout, /R2 needs a security-reviewer review/);
});

test('fk task stamp: an ACCEPT of an older version does not count; a fresh stamp does; done records it; audit flags later changes outside a task', () => {
  const dir = repo({ 'src/old.js': 'export const o = 1;\n' });
  fk(dir, 'task', 'new', 'Stamped change', '--risk', 'R1');
  put(dir, 'src/app.js', 'export const x = 11;\n');
  const stamp = () => fk(dir, 'task', 'stamp', 'T-001');
  const s1 = stamp();
  assert.equal(s1.status, 0, s1.stdout);
  assert.match(s1.stdout, /^Reviewed: [0-9a-f]{12}\r?\n$/);
  review(dir, 'T-001', 1, `${s1.stdout.trim()}\nVerdict: ACCEPT\n`);
  author(dir, [{ agent_id: 'r1', agent_type: 'oh-my-claudecode:code-reviewer', path: 'docs/tasks/T-001.review-1.md' }]);
  assert.equal(stamp().stdout, s1.stdout, 'task records (docs/tasks/) do not change the stamp');
  let r = fk(dir, 'task', 'check', 'T-001');
  assert.equal(r.status, 0, r.stdout);
  // The implementer changes the code after the ACCEPT: that review no longer counts.
  put(dir, 'src/app.js', 'export const x = 12;\n');
  r = fk(dir, 'task', 'check', 'T-001');
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /not counted: docs\/tasks\/T-001\.review-1\.md: reviewed an older version; re-review needed/);
  assert.match(r.stdout, /missing: no review by an independent reviewer agent/);
  // A new untracked file and a deleted file change the stamp too.
  const s2 = stamp().stdout;
  put(dir, 'src/extra.js', 'export const e = 1;\n');
  const s3 = stamp().stdout;
  fs.rmSync(path.join(dir, 'src', 'old.js'));
  const s4 = stamp().stdout;
  assert.equal(new Set([s1.stdout, s2, s3, s4]).size, 4);
  // Re-review of the final version.
  review(dir, 'T-001', 2, `Round: 1\n${s4.trim()}\nVerdict: ACCEPT\n`);
  author(dir, [{ agent_id: 'r2', agent_type: 'oh-my-claudecode:code-reviewer', path: 'docs/tasks/T-001.review-2.md' }]);
  r = fk(dir, 'task', 'done', 'T-001');
  assert.equal(r.status, 0, r.stdout);
  const t = readJson(stateFile(dir, 'tasks.json')).tasks['T-001'];
  assert.equal(`Reviewed: ${t.stamp}`, s4.trim());
  assert.doesNotMatch(fk(dir, 'audit').stdout, /changed afterwards/);
  // Changed after the close with no task covering it: fk audit says so; a later task touching the file covers it.
  put(dir, 'src/app.js', 'export const x = 13;\n');
  const a = fk(dir, 'audit').stdout;
  assert.match(a, /T-001 was closed \d{4}-\d\d-\d\d, but src\/app\.js changed afterwards outside any task/);
  assert.doesNotMatch(a, /src\/extra\.js|src\/old\.js/);
  fk(dir, 'task', 'new', 'Follow-up', '--risk', 'R1');
  author(dir, [{ agent_id: 'e1', agent_type: 'oh-my-claudecode:executor', path: 'src/app.js' }]);
  assert.doesNotMatch(fk(dir, 'audit').stdout, /changed afterwards/);
});

test('fk task check: a review without a Reviewed line is stale when task files are newer (no authorship data); R0 is unaffected', () => {
  const dir = repo();
  fk(dir, 'task', 'new', 'Unstamped', '--risk', 'R1');
  put(dir, 'src/app.js', 'export const x = 21;\n');
  review(dir, 'T-001', 1, 'Verdict: ACCEPT\n');
  author(dir, [{ agent_id: 'r1', agent_type: 'code-reviewer', path: 'docs/tasks/T-001.review-1.md' }]);
  const old = new Date(Date.now() - 60e3);
  fs.utimesSync(path.join(dir, 'src', 'app.js'), old, old);
  let r = fk(dir, 'task', 'check', 'T-001');
  assert.equal(r.status, 0, r.stdout);
  const later = new Date(Date.now() + 60e3);
  fs.utimesSync(path.join(dir, 'src', 'app.js'), later, later);
  r = fk(dir, 'task', 'check', 'T-001');
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /T-001\.review-1\.md: reviewed an older version; re-review needed \(no "Reviewed: <fk task stamp T-001>" line/);
  put(dir, 'src/app.js', 'export const x = 1;\n'); // back to the committed code: an R0 change set
  put(dir, 'README.md', '# App\n\nA small app that does things well.\n');
  fk(dir, 'task', 'new', 'Docs only', '--risk', 'R0');
  review(dir, 'T-002', 1, 'Verdict: ACCEPT\n');
  r = fk(dir, 'task', 'check', 'T-002');
  assert.equal(r.status, 0, r.stdout);
  assert.doesNotMatch(r.stdout, /older version/);
});

// An installed plugin's agent, as Claude Code caches it (<config>/plugins/cache/<marketplace>/<plugin>/<version>/agents/).
const pluginAgentFile = (plugin, name) => put(process.env.CLAUDE_CONFIG_DIR, `plugins/cache/mk/${plugin}/1.0.0/agents/${name}.md`, `---\nname: ${name}\ndescription: x\n---\nReview.\n`);

test('fk config set reviewer_extra adds a domain reviewer (append-only); an implementer agent is refused', () => {
  const dir = repo();
  pluginAgentFile('godot-prompter', 'godot-code-reviewer');
  assert.equal(fk(dir, 'config', 'set', 'reviewer_extra', 'godot-prompter:godot-code-reviewer').status, 0);
  assert.equal(fk(dir, 'config', 'set', 'reviewer_extra', 'executor').status, 1);
  assert.deepEqual(readJson(path.join(dir, '.fk', 'config.json')).reviewer_extra, ['godot-prompter:godot-code-reviewer']);
  git(dir, 'stash', '-q'); git(dir, 'checkout', '-q', 'main'); git(dir, 'stash', 'pop', '-q');
  git(dir, 'commit', '-qam', 'add a reviewer'); // on main: the task's base (where feat leaves main) then includes it
  git(dir, 'checkout', '-q', 'feat'); git(dir, 'merge', '-q', 'main');
  fk(dir, 'task', 'new', 'Game change', '--risk', 'R1');
  put(dir, 'src/app.js', 'export const x = 8;\n');
  review(dir, 'T-001', 1, 'Verdict: ACCEPT\n');
  author(dir, [{ agent_id: 'g1', agent_type: 'godot-prompter:godot-code-reviewer', path: 'docs/tasks/T-001.review-1.md' }]);
  const r = fk(dir, 'task', 'check', 'T-001');
  assert.equal(r.status, 0, r.stdout);
});

test('fk audit: an open task named in a commit on main is listed; fk usage lists the extra commands', () => {
  const dir = repo();
  fk(dir, 'task', 'new', 'One');
  fk(dir, 'task', 'new', 'Two');
  git(dir, 'checkout', '-q', 'main');
  put(dir, 'src/app.js', 'export const x = 9;\n');
  git(dir, 'commit', '-qam', 'feat: T-002 thing');
  const out = fk(dir, 'audit').stdout;
  assert.match(out, /T-002 is in a commit on main but was never closed/);
  assert.doesNotMatch(out, /T-001 is in a commit/);
  assert.match(fk(dir).stdout, /more: .*fk metrics.*fk risk.*fk task/);
});

test('fk task check: a review by an agent that also wrote code does not count; a distinct reviewer passing every AC does', () => {
  const dir = repo();
  fk(dir, 'task', 'new', 'Change the app', '--risk', 'R1');
  acs(dir, 'T-001', ['x is 2', 'README says so']);
  put(dir, 'src/app.js', 'export const x = 2;\n');
  author(dir, [{ agent_id: 'a1', agent_type: 'oh-my-claudecode:code-reviewer', path: 'src/app.js' }]);
  review(dir, 'T-001', 1, 'Reviewer: code-reviewer\nAC-1: PASS — test x.test.js green\nAC-2: PASS — README line 3\nVerdict: ACCEPT\n');
  author(dir, [{ agent_id: 'a1', agent_type: 'oh-my-claudecode:code-reviewer', path: 'docs/tasks/T-001.review-1.md' }]);
  let r = fk(dir, 'task', 'check', 'T-001');
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /not counted: docs\/tasks\/T-001\.review-1\.md: written by code-reviewer a1, which also wrote code/);
  assert.match(r.stdout, /no review by an independent reviewer agent/);
  review(dir, 'T-001', 2, 'AC-1: PASS — test x.test.js green\nAC-2: FAIL — README not updated\nVerdict: REVISE\n');
  author(dir, [{ agent_id: 'a2', agent_type: 'executor', path: 'docs/tasks/T-001.review-2.md' }]);
  assert.match(fk(dir, 'task', 'check', 'T-001').stdout, /written by executor, not a reviewer agent/);
  review(dir, 'T-001', 3, 'Round: 1\nAC-1: PASS — test x.test.js green\nAC-2: PASS — README line 3\nVerdict: ACCEPT\n');
  author(dir, [{ agent_id: 'a3', agent_type: 'oh-my-claudecode:code-reviewer', path: 'docs/tasks/T-001.review-3.md' }]);
  r = fk(dir, 'task', 'check', 'T-001');
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /PASS \(risk R1: declared R1, proposed R1\)/);
  r = fk(dir, 'task', 'done', 'T-001');
  assert.equal(r.status, 0, r.stdout);
  const t = readJson(stateFile(dir, 'tasks.json')).tasks['T-001'];
  assert.ok(t.done && t.files.includes('src/app.js'));
  assert.match(fk(dir, 'audit').stdout, /a review was written by an implementer/);
});

test('fk task check: declared lower than proposed uses the proposed class; R2 without security-reviewer fails', () => {
  const dir = repo();
  fk(dir, 'task', 'new', 'API change', '--risk', 'R0');
  acs(dir, 'T-001', ['the contract lists /export']);
  put(dir, 'api/openapi.yaml', 'openapi: 3.0.0\npaths: {}\n');
  put(dir, 'src/app.js', 'export const x = 3;\n');
  review(dir, 'T-001', 1, 'AC-1: PASS — openapi.yaml line 2\nVerdict: ACCEPT\n');
  author(dir, [{ agent_id: 'r1', agent_type: 'code-reviewer', path: 'docs/tasks/T-001.review-1.md' }]);
  const r = fk(dir, 'task', 'check', 'T-001');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /risk R2: declared R0, proposed R2/);
  assert.match(r.stdout, /declared R0, but the change looks like R2/);
  assert.match(r.stdout, /R2 needs a security-reviewer review/);
  assert.doesNotMatch(r.stdout, /needs a code-reviewer/);
});

test('fk task check: R3 needs two rounds and a critic', () => {
  const dir = repo();
  fk(dir, 'task', 'new', 'Login', '--risk', 'R3');
  acs(dir, 'T-001', ['login rejects a wrong password']);
  put(dir, 'src/auth/login.js', 'export function login() {}\n');
  const ok = 'AC-1: PASS — negative test green\nVerdict: ACCEPT\n';
  review(dir, 'T-001', 1, `Round: 1\n${ok}`);
  review(dir, 'T-001', 2, `Round: 1\n${ok}`);
  author(dir, [{ agent_id: 'c', agent_type: 'code-reviewer', path: 'docs/tasks/T-001.review-1.md' }, { agent_id: 's', agent_type: 'security-reviewer', path: 'docs/tasks/T-001.review-2.md' }]);
  let r = fk(dir, 'task', 'check', 'T-001');
  assert.match(r.stdout, /R3 needs a critic review/);
  assert.match(r.stdout, /two review rounds/);
  review(dir, 'T-001', 3, `Round: 2\n${ok}`);
  author(dir, [{ agent_id: 'k', agent_type: 'critic', path: 'docs/tasks/T-001.review-3.md' }]);
  r = fk(dir, 'task', 'check', 'T-001');
  assert.equal(r.status, 0, r.stdout);
});

test('fk task done: refuses with reasons; a founder-typed fk-override task-check closes it (once); R0 passes without gates', () => {
  const dir = repo();
  fk(dir, 'task', 'new', 'Feature', '--risk', 'R1');
  acs(dir, 'T-001', ['it works']);
  put(dir, 'src/app.js', 'export const x = 5;\n');
  let r = fk(dir, 'task', 'done', 'T-001');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /stays open[\s\S]*fk-override task-check <reason>/);
  const typed = runHook(dir, 'UserPromptSubmit', { prompt: 'fk-override task-check reviewer unavailable, accepted risk' });
  assert.match(typed.stdout, /override of task-check/);
  r = fk(dir, 'task', 'done', 'T-001');
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /closed on the founder's override/);
  assert.match(fk(dir, 'audit').stdout, /T-001 was closed without a passing fk task check, on your override/);
  fk(dir, 'task', 'new', 'Another', '--risk', 'R1');
  assert.equal(fk(dir, 'task', 'done', 'T-002').status, 1, 'an override closes one task only');
  // R0: docs only, no gates configured
  const d2 = repo();
  fk(d2, 'task', 'new', 'Fix typo', '--risk', 'R0');
  put(d2, 'README.md', '# App\n\nA small app that does thing.\n');
  r = fk(d2, 'task', 'done', 'T-001');
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /no gates configured/);
  assert.equal(fk(d2, 'task', 'reopen', 'T-001').status, 0);
  assert.equal(readJson(stateFile(d2, 'tasks.json')).tasks['T-001'].reopened, 1);
});

test('PostToolUse records authorship only while a task is open (file tools and shell-changed files)', () => {
  const dir = repo();
  const post = (tool_name, tool_input, extra = {}) => runHook(dir, 'PostToolUse', { tool_name, tool_input, agent_id: 'ag1', agent_type: 'executor', ...extra });
  put(dir, 'src/a.js', '1');
  post('Write', { file_path: path.join(dir, 'src', 'a.js') });
  assert.equal(fs.existsSync(stateFile(dir, 'authorship.jsonl')), false, 'no open task: nothing logged');
  fk(dir, 'task', 'new', 'T');
  post('Write', { file_path: path.join(dir, 'src', 'a.js') });
  put(dir, 'src/b.js', '2');
  post('Bash', { command: 'echo 2 > src/b.js' }, { agent_id: 'ag2', agent_type: 'code-reviewer' });
  const rows = fs.readFileSync(stateFile(dir, 'authorship.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(rows.some((x) => x.path === 'src/a.js' && x.agent_id === 'ag1' && x.agent_type === 'executor' && x.session_id === 'selftest'));
  assert.ok(rows.some((x) => x.path === 'src/b.js' && x.agent_id === 'ag2'));
  assert.ok(!rows.some((x) => x.path === 'src/a.js' && x.agent_id === 'ag2'), 'files unchanged since the last tool are not attributed');
});

// ---- metrics ----
test('fk metrics: tokens and cost per task from synthetic transcripts, rework, regressions, governance; --write', () => {
  const dir = repo();
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  writeJson(stateFile(dir, 'tasks.json'), { tasks: {
    'T-001': { start: iso(now - 5 * 36e5), done: iso(now - 3 * 36e5), base: null, files: ['src/app.js'], reopened: 1 },
    'T-002': { start: iso(now - 2 * 36e5), base: null } } });
  put(dir, 'docs/tasks/T-001.md', '---\nid: T-001\ntitle: One\nrisk: R1\nacceptance:\n  - AC-1: a\n---\n');
  put(dir, 'docs/tasks/T-001.review-1.md', 'AC-1: FAIL — broken\nVerdict: REVISE\n');
  put(dir, 'docs/tasks/T-001.review-2.md', 'Round: 2\nAC-1: PASS — fixed\nVerdict: ACCEPT\n');
  const msg = (ms, id, model, u) => JSON.stringify({ type: 'assistant', timestamp: iso(ms), message: { id, model, usage: u } });
  put(process.env.FK_TRANSCRIPTS, 's1.jsonl', [
    msg(now - 4 * 36e5, 'm1', 'claude-opus-5-5', { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
    msg(now - 4 * 36e5, 'm1', 'claude-opus-5-5', { input_tokens: 1000, output_tokens: 2000 }), // same message, streamed twice
    JSON.stringify({ type: 'user', timestamp: iso(now - 4 * 36e5), message: { content: 'secret words' } }),
    'not json'].join('\n'));
  put(process.env.FK_TRANSCRIPTS, 's1/subagents/agent-x.jsonl', msg(now - 1 * 36e5, 'm2', 'claude-haiku-5-5', { input_tokens: 10000, output_tokens: 0 }));
  fs.appendFileSync(stateFile(dir, 'gates.jsonl'), JSON.stringify({ ts: iso(now - 36e5), ok: false, paths: ['src/app.js'] }) + '\n');
  fs.appendFileSync(stateFile(dir, 'compliance.jsonl'), [
    { ts: iso(now), event: 'PreToolUse', guard: 'secret-guard', decision: 'deny' },
    { ts: iso(now), event: 'PreToolUse', guard: 'gate-guard', decision: 'deny', reason: 'r', session: 'x' },
    { ts: iso(now), event: 'PreToolUse', guard: 'gate-guard', decision: 'deny', reason: 'r', session: 'x' }, // the same command retried
    { ts: iso(now), event: 'UserPromptSubmit', guard: 'task-check', decision: 'override-set' }, // closing a task: not a false alarm
    { ts: iso(now), event: 'UserPromptSubmit', guard: 'gate-guard', decision: 'override-set' }].map((x) => JSON.stringify(x) + '\n').join(''));
  const r = fk(dir, 'metrics', '--json');
  assert.equal(r.status, 0, r.stderr);
  const m = JSON.parse(r.stdout);
  const t1 = m.tasks.find((t) => t.id === 'T-001');
  assert.equal(t1.tokens.input, 1000);
  assert.equal(t1.tokens.output, 2000);
  assert.equal(Math.round(t1.tokens.usd * 1000), 44); // (1000*4 + 2000*20) / 1e6
  assert.equal(t1.hours, 2);
  assert.equal(t1.fails, 1);
  assert.equal(t1.revise, 1);
  assert.equal(t1.caught, 1);
  assert.equal(t1.reopened, 1);
  assert.equal(t1.regressions.gates, 1);
  assert.equal(m.tasks.find((t) => t.id === 'T-002').tokens.input, 10000);
  assert.equal(m.governance.false_alarms, 1);
  assert.equal(m.governance.task_overrides, 1);
  assert.deepEqual(m.governance.blocks, { 'secret-guard': 1, 'gate-guard': 1 });
  assert.equal(m.governance.catches, 2); // 1 review catch + 2 blocks - 1 override
  const bad = fk(dir, 'metrics', '--since', 'week', '--json');
  assert.equal(bad.status, 1);
  assert.match(JSON.parse(bad.stdout).error, /invalid --since week/);
  assert.doesNotMatch(r.stdout, /secret words/);
  const w = fk(dir, 'metrics', '--write');
  assert.match(w.stdout, /Catches vs false alarms: 2 vs 1/);
  const md = fs.readFileSync(path.join(dir, 'docs', 'process', 'metrics.md'), 'utf8');
  assert.match(md, /\| T-001 One \| R1 \| closed \| 2 h \|/);
  assert.match(md, /estimates/);
});

test('SessionStart metrics note: 3+ tasks closed since the last summary, at most weekly', async () => {
  const dir = repo();
  const note = (await import(pathToFileURL(path.join(KIT, 'hooks', 'session', '50-metrics.mjs')).href)).default;
  const iso = (ms) => new Date(ms).toISOString();
  const now = Date.now();
  const tasks = (n) => writeJson(stateFile(dir, 'tasks.json'), { tasks: Object.fromEntries([...Array(n)].map((_, i) => [`T-00${i + 1}`, { start: iso(now - 9e6), done: iso(now - 1e6) }])) });
  tasks(2);
  assert.equal(note({ root: dir, now }), undefined);
  tasks(3);
  assert.match(note({ root: dir, now }), /3 tasks closed since the last process summary[\s\S]*fk metrics/);
  assert.equal(note({ root: dir, now: now + 60e3 }), undefined, 'once a week');
  fk(dir, 'metrics'); // a summary resets the count
  assert.equal(note({ root: dir, now: now + 8 * 24 * 36e5 }), undefined);
});
