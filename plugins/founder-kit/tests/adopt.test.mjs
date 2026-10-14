import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeFixture, runHook } from '../hooks/selftest.mjs';
import { readJson, writeJson, stateDir, refreshSnapshot } from '../hooks/lib.mjs';

// fk uninstall refuses inside a Claude Code session (CLAUDE_CODE_CHILD_SESSION); these tests play the founder's terminal.
delete process.env.CLAUDE_CODE_CHILD_SESSION;
const ws = (dir, ...p) => path.join(stateDir(dir), 'adopt', ...p);

const FK = path.join(import.meta.dirname, '..', 'bin', 'fk.mjs');
const dirs = [];
const tmp = (p = 'fk-adopt-') => { const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), p))); dirs.push(d); return d; };
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const homeEnv = (home) => ({ HOME: home, USERPROFILE: home });
const { founderRun } = await import('./founder-shell.mjs'); // fk uninstall refuses below Claude Code: run it as the founder's terminal would
const fk = (cwd, args, env = {}) => (args[0] === 'uninstall' ? founderRun : (c, a, o) => spawnSync(c, a, { ...o, encoding: 'utf8' }))(process.execPath, [FK, ...args], { cwd, env: { ...process.env, FK_OMC_LATEST: 'none', ...env } });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const commit = (dir, msg, files) => { for (const [f, t] of Object.entries(files)) write(dir, f, t); git(dir, 'add', '-A'); assert.equal(git(dir, 'commit', '-q', '-m', msg).status, 0, msg); };
const noTamper = (dir) => assert.equal(runHook(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'fk x' } }).stdout, '', 'gate-guard reports no tamper');

function historyRepo() {
  const dir = tmp();
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  commit(dir, 'init', { 'a.js': '1', 'b.js': '1', 'package.json': '{"scripts":{"test":"node --test"}}', '.env.example': 'API_KEY=\nexport DB_URL=postgres://x\n',
    '.github/workflows/ci.yml': 'on: push\n', 'Dockerfile': 'FROM node\n', 'lint.js': 'console.log("✖ 3 problems"); process.exit(1);\n' });
  for (let i = 2; i <= 4; i++) commit(dir, `feat: step ${i}`, { 'a.js': String(i), 'b.js': String(i) });
  commit(dir, 'fix login redirect', { 'a.js': '5' });
  commit(dir, 'fix fix login redirect', { 'a.js': '6' });
  commit(dir, 'add c', { 'c.js': 'x' });
  assert.equal(git(dir, 'revert', '--no-edit', 'HEAD').status, 0);
  return dir;
}

test('adopt survey: hotspots, co-change, revert, fix chain, env names, sessions; no paths or values stored', () => {
  const dir = historyRepo();
  const home = tmp('fk-home-');
  const sess = path.join(home, '.claude', 'projects', dir.replace(/[^a-zA-Z0-9]/g, '-'));
  write(sess, 'one.jsonl', '{}\n'.repeat(400));
  write(sess, 'two.jsonl', '{}\n');
  const r = fk(dir, ['adopt', 'survey', '--skip', 'gitleaks,docker', '--run', 'lint=node lint.js'], homeEnv(home));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const s = readJson(ws(dir, 'survey.json'));
  assert.equal(s.git.hotspots[0].file, 'a.js');
  assert.equal(s.git.hotspots[0].commits, 6);
  assert.deepEqual(s.git.co_change[0], { files: ['a.js', 'b.js'], together: 4 });
  assert.equal(s.git.reverts.count, 1);
  assert.ok(s.git.fix_chains.some((c) => c.length === 2 && c.files.includes('a.js')), JSON.stringify(s.git.fix_chains));
  assert.deepEqual(s.stack.env_names, ['API_KEY', 'DB_URL']);
  assert.ok(s.stack.manifests.includes('package.json'));
  assert.deepEqual(s.stack.ci, ['.github/workflows']);
  assert.ok(s.stack.infra.includes('Dockerfile'));
  assert.deepEqual([s.runs.lint.value, s.runs.lint.exit], [3, 1]);
  assert.equal(s.sessions.count, 2);
  const raw = fs.readFileSync(ws(dir, 'survey.json'), 'utf8') + fs.readFileSync(ws(dir, 'survey.md'), 'utf8');
  for (const leak of [dir, home, dir.replace(/\\/g, '/'), 'postgres://x', 'test@example.com']) assert.ok(!raw.includes(leak), `survey stores ${leak}`);
  assert.match(r.stdout, /mempalace mine "<file>" --mode convos --wing /);
  // A1: the survey changes nothing in the repo (its workspace is in the kit state dir).
  assert.equal(fs.existsSync(path.join(dir, '.fk')), false);
  assert.equal(git(dir, 'status', '--porcelain').stdout, '');
});

test('adopt plan, draft and apply: health report, docs from drafts, fk init, pre-existing ledger, baseline; WIP untouched', () => {
  const dir = historyRepo();
  assert.equal(fk(dir, ['adopt', 'survey', '--skip', 'gitleaks,docker,sessions']).status, 0);
  assert.equal(fk(dir, ['adopt', 'apply']).status, 1, 'apply needs a plan first');
  const sj = ws(dir, 'survey.json');
  writeJson(sj, { ...readJson(sj), containers: { related: [{ id: 'abc123', name: 'db', image: 'postgres' }], unrelated_count: 0 } });
  assert.equal(fk(dir, ['adopt', 'plan']).status, 0);
  const health = fs.readFileSync(ws(dir, 'drafts', 'health.md'), 'utf8');
  assert.match(health, /fragile area/);
  assert.match(health, /money/);
  assert.match(health, /Remediation backlog/);
  write(dir, 'scratch/constraints.md', '# Constraints (reconstructed)\n');
  assert.equal(fk(dir, ['adopt', 'draft', '00-constraints.md', '--from', 'scratch/constraints.md']).status, 0);
  assert.equal(fk(dir, ['adopt', 'draft', '../evil.md', '--from', 'scratch/constraints.md']).status, 1);
  write(dir, 'a.js', 'work in progress');
  const r = fk(dir, ['adopt', 'apply', '--no-gitleaks']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'docs', '00-constraints.md'), 'utf8'), '# Constraints (reconstructed)\n');
  assert.equal(fs.readFileSync(path.join(dir, 'a.js'), 'utf8'), 'work in progress');
  assert.ok(fs.existsSync(path.join(dir, '.fk', 'config.json')), 'fk init ran');
  assert.ok(fs.existsSync(path.join(dir, '.fk', 'baseline.json')));
  const ledger = fs.readFileSync(path.join(dir, '.fk', 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(ledger.map((e) => [e.kind, e.id, e.pre_existing]), [['container', 'abc123', true]]);
  fk(dir, ['adopt', 'apply']);
  assert.equal(fs.readFileSync(path.join(dir, '.fk', 'ledger.jsonl'), 'utf8').trim().split('\n').length, 1, 'ledger entry not duplicated');
  noTamper(dir);
});

test('baseline ratchet: same passes, new violations fail, improvements tighten, coverage may not drop', () => {
  const dir = tmp();
  git(dir, 'init', '-q');
  assert.equal(fk(dir, ['init']).status, 0);
  write(dir, 'gate.js', 'const n = Number(require("fs").readFileSync("n.txt", "utf8")); console.log(`${n} errors`); process.exit(n ? 1 : 0);\n');
  write(dir, 'cov.js', 'console.log(`All files | ${require("fs").readFileSync("cov.txt", "utf8").trim()} |`);\n');
  const set = (n, cov) => { write(dir, 'n.txt', String(n)); write(dir, 'cov.txt', String(cov)); };
  const check = () => fk(dir, ['baseline', 'check', '--no-gitleaks']);
  set(3, 80);
  assert.equal(fk(dir, ['baseline', 'record', '--no-gitleaks', '--gate', 'lint=node gate.js', '--gate', 'coverage=node cov.js']).status, 0);
  const b = readJson(path.join(dir, '.fk', 'baseline.json'));
  assert.deepEqual([b.gates.lint.value, b.gates.coverage.value, b.gates.coverage.kind], [3, 80, 'coverage']);
  noTamper(dir);
  assert.equal(check().status, 0, 'unchanged counts pass');
  set(4, 80);
  const worse = check();
  assert.equal(worse.status, 1);
  assert.match(worse.stdout, /WORSE\s+lint: 3 -> 4/);
  set(2, 85);
  assert.equal(check().status, 0);
  assert.deepEqual([readJson(path.join(dir, '.fk', 'baseline.json')).gates.lint.value, readJson(path.join(dir, '.fk', 'baseline.json')).gates.coverage.value], [2, 85]);
  noTamper(dir);
  set(3, 85);
  assert.equal(check().status, 1, 'the ratchet does not move back');
  set(2, 70);
  assert.match(check().stdout, /coverage dropped/);
});

test('lessons: add dedupes into a seen bump, candidates, archive by date, CLAUDE.md budget', () => {
  const dir = tmp();
  git(dir, 'init', '-q');
  const L = (...a) => fk(dir, ['lessons', ...a]);
  assert.equal(L('add', '--title', 'Gate green locally but skipped in CI', '--what', 'CI skipped lint job', '--lesson', 'prove each gate red in CI', '--today', '2026-01-10').status, 0);
  const file = path.join(dir, 'docs', 'process', 'lessons.md');
  assert.match(fs.readFileSync(file, 'utf8'), /^# Lessons/);
  assert.match(L('promote-candidates').stdout, /no promotion candidates/);
  const b = L('add', '--title', 'Gates skipped in CI though green locally', '--lesson', 'run gates non-interactively', '--evidence', 'PR 12', '--today', '2026-02-01');
  assert.match(b.stdout, /bumped .* seen: 2/);
  let text = fs.readFileSync(file, 'utf8');
  assert.equal((text.match(/^## \d{4}/gm) || []).length, 1, 'no duplicate entry');
  assert.match(text, /\[seen: 2\] \[severity: med\] \[paths: \*\*\] \[status: open\] \[last: 2026-02-01\]/);
  assert.match(text, /- Evidence: PR 12/);
  L('add', '--title', 'Payment webhook replayed twice', '--lesson', 'make handlers idempotent', '--severity', 'high', '--paths', 'src/pay/**', '--today', '2026-03-01');
  L('add', '--title', 'Windows paths too long for worktrees', '--lesson', 'keep worktrees short', '--today', '2026-03-02');
  const c = JSON.parse(L('promote-candidates', '--json').stdout);
  assert.deepEqual(c.map((x) => x.title).sort(), ['Gate green locally but skipped in CI', 'Payment webhook replayed twice']);
  assert.match(L('bump', 'worktrees', '--today', '2026-03-05').stdout, /seen: 2/);
  const a = L('archive', '--today', '2026-05-15'); // > 90 days after 2026-02-01 only
  assert.match(a.stdout, /archived 1 lesson/);
  text = fs.readFileSync(file, 'utf8');
  assert.ok(!text.includes('Gate green locally'));
  assert.match(fs.readFileSync(path.join(dir, 'docs', 'process', 'lessons-archive.md'), 'utf8'), /Gate green locally[^\n]*\[seen: 2\]/);
  assert.equal((text.match(/^## \d{4}/gm) || []).length, 2);
  write(dir, 'CLAUDE.md', Array.from({ length: 30 }, (_, i) => `rule ${i}`).join('\n'));
  assert.match(L('budget').stdout, /30\/40 lines/);
  write(dir, 'CLAUDE.md', `${Array.from({ length: 45 }, (_, i) => `rule ${i}`).join('\n')}\n<!-- OMC:START -->\n${'omc\n'.repeat(50)}<!-- OMC:END -->\n`);
  const over = L('budget', '--strict');
  assert.match(over.stdout, /WARNING CLAUDE\.md has 45 lines/);
  assert.equal(over.status, 1);
});

test('memory setup merges deny rules into existing settings, is idempotent, and leaves no tamper', () => {
  const dir = makeFixture();
  dirs.push(dir);
  git(dir, 'init', '-q');
  const home = tmp('fk-home-');
  writeJson(path.join(home, '.claude', 'settings.json'), { enabledPlugins: { 'example-skills@example': true, 'oh-my-claudecode@omc': true } });
  const settings = path.join(dir, '.claude', 'settings.json');
  writeJson(settings, { model: 'sonnet', permissions: { allow: ['Bash(ls)'], deny: ['Read(./.env)'] }, hooks: { Stop: [] }, enabledPlugins: { 'keep@me': true } });
  refreshSnapshot(dir, ['.claude/settings.json']);
  const r = fk(dir, ['memory', 'setup', '--disable', 'example-skills@example', '--disable', 'keep@me'], homeEnv(home));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const s = readJson(settings);
  assert.equal(s.model, 'sonnet');
  assert.deepEqual(s.hooks, { Stop: [] });
  assert.deepEqual(s.permissions.allow, ['Bash(ls)']);
  assert.equal(s.permissions.deny[0], 'Read(./.env)');
  for (const t of ['mcp__plugin_mempalace_mempalace__mempalace_event_append', 'mcp__plugin_mempalace_mempalace__mempalace_create_tunnel',
    'mcp__plugin_mempalace_mempalace__mempalace_list_hallways', 'mcp__codebase-memory-mcp__query_graph', 'mcp__codebase-memory-mcp__delete_project']) assert.ok(s.permissions.deny.includes(t), t);
  for (const t of ['search_graph', 'trace_path', 'get_code_snippet', 'get_architecture', 'detect_changes', 'index_status', 'index_repository', 'search_code']) {
    assert.ok(!s.permissions.deny.includes(`mcp__codebase-memory-mcp__${t}`), `${t} stays allowed`);
  }
  assert.deepEqual(s.enabledPlugins, { 'keep@me': true, 'example-skills@example': false });
  noTamper(dir);
  const again = fk(dir, ['memory', 'setup'], homeEnv(home));
  assert.match(again.stdout, /unchanged/);
  assert.equal(JSON.stringify(readJson(settings)), JSON.stringify(s));
  const u = fk(dir, ['uninstall'], homeEnv(home));
  assert.equal(u.status, 0, u.stdout + u.stderr);
  const after = readJson(settings);
  assert.deepEqual(after.permissions, { allow: ['Bash(ls)'], deny: ['Read(./.env)'] }, 'only what the kit added is removed');
  assert.deepEqual(after.enabledPlugins, { 'keep@me': true });
  assert.equal(after.model, 'sonnet');
});

test('session note: promotion candidates surface at most once a week', () => {
  const dir = makeFixture();
  dirs.push(dir);
  const home = tmp('fk-home-');
  const note = /lesson\(s\) in docs\/process\/lessons\.md qualify for promotion/;
  const start = () => runHook(dir, 'SessionStart', { source: 'startup' }, homeEnv(home)).stdout;
  write(dir, 'docs/process/lessons.md', '# Lessons\n\n## 2026-01-01 — Minor thing  [seen: 1] [severity: low] [paths: **] [status: open]\n');
  assert.doesNotMatch(start(), note);
  write(dir, 'docs/process/lessons.md', '# Lessons\n\n## 2026-01-01 — Repeated thing  [seen: 3] [severity: low] [paths: **] [status: open]\n');
  assert.match(start(), note);
  assert.doesNotMatch(start(), note, 'throttled for a week');
  const f = path.join(process.env.FK_HOME, 'state', 'learn-notes.json'); // FK_HOME (set by the selftest import) moves ~/.fk
  writeJson(f, Object.fromEntries(Object.keys(readJson(f)).map((k) => [k, Date.now() - 8 * 864e5])));
  assert.match(start(), note);
});

test('foreign core.hooksPath (husky): fk init and adopt apply keep it, still create .fk; --chain wires the kit pre-commit; drift is reported', () => {
  const dir = historyRepo();
  git(dir, 'config', 'core.hooksPath', '.husky');
  write(dir, '.husky/pre-commit', '#!/bin/sh\nnpx lint-staged\n');
  assert.equal(fk(dir, ['adopt', 'survey', '--skip', 'gitleaks,docker,sessions']).status, 0);
  assert.equal(fk(dir, ['adopt', 'plan']).status, 0);
  const r = fk(dir, ['adopt', 'apply', '--no-gitleaks']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /fk init --chain/);
  assert.equal(git(dir, 'config', '--get', 'core.hooksPath').stdout.trim(), '.husky', 'never overwritten');
  assert.ok(fs.existsSync(path.join(dir, '.fk', 'config.json')), 'fk config exists, so fk config set / fk baseline work');
  assert.equal(fk(dir, ['config', 'set', 'check', 'node -e "1"']).status, 0);
  assert.match(fk(dir, ['baseline', 'check', '--no-gitleaks']).stdout, /^fk baseline: /m, 'check always prints a result line');
  const start = () => runHook(dir, 'SessionStart', { source: 'startup' }).json.hookSpecificOutput.additionalContext;
  assert.match(start(), /pre-commit checks are off in this clone: git runs hooks from \.husky/);
  assert.match(fk(dir, ['doctor']).stdout, /pre-commit checks.*fk init --chain/);
  const c = fk(dir, ['init', '--chain']);
  assert.match(c.stdout, /chained \.husky\/pre-commit/);
  const hook = fs.readFileSync(path.join(dir, '.husky', 'pre-commit'), 'utf8');
  assert.match(hook, /^#!\/bin\/sh\n# founder-kit pre-commit \(fk init --chain\)\nsh ".*\.githooks\/pre-commit" \|\| exit 1\nnpx lint-staged/);
  fk(dir, ['init', '--chain']);
  assert.equal(fs.readFileSync(path.join(dir, '.husky', 'pre-commit'), 'utf8'), hook, 'chained once');
  assert.doesNotMatch(start(), /pre-commit checks are off/);
  noTamper(dir);
  fk(dir, ['uninstall']);
  assert.equal(fs.readFileSync(path.join(dir, '.husky', 'pre-commit'), 'utf8'), '#!/bin/sh\nnpx lint-staged\n', 'uninstall takes the chain back out');
});

test('hooksPath drift in a clone: unset core.hooksPath is reported and fk init restores it', () => {
  const dir = tmp();
  git(dir, 'init', '-q');
  assert.equal(fk(dir, ['init']).status, 0);
  git(dir, 'config', '--unset', 'core.hooksPath');
  const note = () => runHook(dir, 'SessionStart', { source: 'startup' }).json.hookSpecificOutput.additionalContext;
  assert.match(note(), /pre-commit checks are off in this clone \(git core\.hooksPath is not \.githooks\); run fk init to restore/);
  assert.match(fk(dir, ['doctor']).stdout, /pre-commit checks\s+off in this clone/);
  fk(dir, ['init']);
  assert.equal(git(dir, 'config', '--get', 'core.hooksPath').stdout.trim(), '.githooks');
  assert.doesNotMatch(note(), /pre-commit checks are off/);
});
