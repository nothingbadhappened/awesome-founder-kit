// Knowledge consolidation, v0.7 review fixes, on a second synthetic repo: an existing kit lessons file (M1), record
// metadata and a superseded ADR-style decision (M2), the data slot, bible links, annotate headers, the post-apply
// baseline and the recall of fk knowledge check (reversal words, the statement kind, ADR title names).
// Sandboxed: FK_HOME, HOME, USERPROFILE, CLAUDE_CONFIG_DIR and TMP/TEMP point into one temp folder.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SANDBOX = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'fk-kr-')));
const TMP = path.join(SANDBOX, 'tmp');
fs.mkdirSync(TMP);
Object.assign(process.env, { FK_HOME: path.join(SANDBOX, '.fk'), HOME: SANDBOX, USERPROFILE: SANDBOX, CLAUDE_CONFIG_DIR: path.join(SANDBOX, '.claude'), TMP, TEMP: TMP, TMPDIR: TMP });
const { stateDir, stateFile, readJson } = await import('../hooks/lib.mjs');
const { loadIndex, activeAdr } = await import('../hooks/knowledge.mjs');
const { appendDraft } = await import('../bin/cmd/adopt/compile.mjs');
after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const KIT = path.join(import.meta.dirname, '..');
const FK = path.join(KIT, 'bin', 'fk.mjs');
const fk = (cwd, args, input) => spawnSync(process.execPath, [FK, ...args], { cwd, input, encoding: 'utf8', env: { ...process.env, FK_TODAY: '2026-10-14', FK_OMC_LATEST: 'none' } });
const git = (cwd, args, env = {}) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
const put = (dir, f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const commit = (dir, day, msg, files) => {
  for (const [f, t] of Object.entries(files)) put(dir, f, t);
  git(dir, ['add', '-A']);
  const at = `${day}T10:00:00`;
  assert.equal(git(dir, ['commit', '-qm', msg], { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at }).status, 0, msg);
};
const kw = (dir, ...p) => path.join(stateDir(dir), 'adopt', 'knowledge', ...p);
const kj = (dir, f) => readJson(kw(dir, f), null);
const drafts = (dir, ...p) => path.join(stateDir(dir), 'adopt', 'drafts', ...p);
const ok = (r) => assert.equal(r.status, 0, r.stdout + r.stderr);

const LESSONS0 = '# Lessons\n\n## 2025-01-15 — Keep migrations small  [seen: 1] [severity: med] [paths: **] [status: open]\n- Lesson: one change per migration.\n';
const dir = path.join(TMP, 'api-shop');
fs.mkdirSync(dir);
git(dir, ['init', '-q']);
commit(dir, '2025-01-10', 'rest', {
  'docs/decisions/0001-use-rest.md': '# 0001 — Use REST for the public API\nDate: 2025-01-10\nStatus: Superseded by RFC-002 (GraphQL)\n\n## Decision\n- We use REST for the public API, versioned by URL.\n',
  'docs/process/lessons.md': LESSONS0,
  'docs/standards/data.md': '# Data standards\n\n- Name tables in snake_case.\n',
  'CLAUDE.md': '# Claude\n\n- Run the full test suite before every push.\n',
});
commit(dir, '2025-06-01', 'graphql', {
  'docs/rfcs/rfc-002-graphql.md': '# Use GraphQL for the public API\nDate: 2025-06-01 · Status: accepted\nDeciders: the founder\n\n## Decision\n- Every client talks to one schema-first endpoint.\n',
  'docs/vision.md': '# Vision\n\n## Mission\n- The product is web-first; the mobile app is retired.\n',
  'docs/rules.md': '# Rules\n\n## Database\n- Every database migration must be reversible and reviewed.\n',
  'docs/postmortems.md': '# Postmortems\n\n## March outage\n- Always run the migrations before the deploy starts.\n',
});
put(dir, '.cursorrules', '- Always pair on changes to the billing code.\n'); // never committed: undated, newest file time

test('extract: record metadata is no statement; a superseded decision record is history; undated sorts last, not by file time', () => {
  ok(fk(dir, ['adopt', 'knowledge', 'inventory', '--skip', 'mempalace,memory']));
  ok(fk(dir, ['adopt', 'knowledge', 'extract']));
  const st = kj(dir, 'statements.json').statements;
  assert.ok(!st.some((s) => /^(?:Date|Status|Deciders)\s*:/i.test(s.text) || /Status\s*:\s*(?:accepted|superseded)/i.test(s.text)), st.map((s) => s.text).join('\n'));
  const rest = st.find((s) => /REST/.test(s.text));
  assert.equal(rest.retired, 'superseded', 'the record\'s own status is respected');
  assert.equal(st.find((s) => /schema-first/.test(s.text)).retired, undefined);
  // The cap keeps rules first, dated before undated (the never-committed .cursorrules has the newest file time).
  ok(fk(dir, ['adopt', 'knowledge', 'extract', '--max-statements', '1']));
  assert.match(kj(dir, 'statements.json').statements[0].text, /migration must be reversible/);
  ok(fk(dir, ['adopt', 'knowledge', 'extract']));
});

test('candidates: the printed token figure is an estimate that includes the agent overhead', () => {
  const r = fk(dir, ['adopt', 'knowledge', 'candidates']);
  ok(r);
  assert.ok(!kj(dir, 'candidates.json').clusters.some((c) => c.ids.includes(kj(dir, 'statements.json').statements.find((s) => /REST/.test(s.text)).id)), 'history is not clustered');
  assert.match(r.stdout, /an estimated \d+k tokens \(including about 10k agent overhead per batch\)/);
  ok(fk(dir, ['adopt', 'knowledge', 'candidates']));
  ok(fk(dir, ['adopt', 'knowledge', 'report']));
});

test('compile: no accepted ADR from the superseded record; database rules to the data slot; bible links only to files that exist', () => {
  // An agent's own lessons draft from earlier in A2: compile appends entries only, never the template's example.
  put(drafts(dir), 'lessons.md', '# Lessons\n\n## 2026-10-01 — Agent lesson  [seen: 1] [severity: low] [paths: **] [status: open]\n- Lesson: from the agent.\n');
  ok(fk(dir, ['adopt', 'knowledge', 'compile']));
  const agent = fs.readFileSync(drafts(dir, 'lessons.md'), 'utf8');
  assert.match(agent, /Agent lesson[\s\S]*## 2025-06-01 — Always run the migrations before the deploy starts/);
  assert.doesNotMatch(agent, /```|YYYY-MM-DD|Entry format/);
  ok(fk(dir, ['adopt', 'knowledge', 'compile']));
  assert.equal(fs.readFileSync(drafts(dir, 'lessons.md'), 'utf8'), agent, 'a recompile does not append again');
  fs.rmSync(drafts(dir, 'lessons.md'));
  ok(fk(dir, ['adopt', 'knowledge', 'compile']));
  const once = fs.readFileSync(drafts(dir, 'lessons.md'), 'utf8');
  ok(fk(dir, ['adopt', 'knowledge', 'compile']));
  assert.equal(fs.readFileSync(drafts(dir, 'lessons.md'), 'utf8'), once, 'own drafts are replaced, not corrupted');

  const adrs = fs.readdirSync(drafts(dir, 'adr')).map((n) => fs.readFileSync(drafts(dir, 'adr', n), 'utf8'));
  assert.ok(!adrs.some((t) => /REST/.test(t)), 'a superseded record never becomes an accepted ADR');
  assert.ok(adrs.some((t) => /^# \d{4} — Use GraphQL for the public API$/m.test(t)));
  assert.match(fs.readFileSync(drafts(dir, 'standards', 'data.md'), 'utf8'), /- Every database migration must be reversible and reviewed\./);
  assert.ok(!fs.existsSync(drafts(dir, 'standards', 'architecture.md')));
  assert.match(read(path.join(stateDir(dir), 'adopt', 'drafts'), 'knowledge-map.md'), /docs\/decisions\/0001-use-rest\.md §[^|]*\| 2025-01-10 \| left in place \(the record itself says superseded\)/);
  const links = fs.readFileSync(drafts(dir, 'PROJECT.md'), 'utf8').split('## Links')[1];
  assert.match(links, /knowledge-map\.md/);
  assert.match(links, /\(adr\/\)/);
  assert.match(links, /\(standards\/\)/);
  assert.match(links, /\(process\/lessons\.md\)/);
  assert.doesNotMatch(links, /00-constraints|02-architecture|design-system/, 'no links to files that do not exist');
});

test('apply onto an existing lessons.md: original first, entries appended once, no template example, no stray fence', () => {
  ok(fk(dir, ['adopt', 'survey', '--skip', 'gitleaks,docker,sessions,portability']));
  ok(fk(dir, ['adopt', 'plan']));
  ok(fk(dir, ['adopt', 'apply', '--no-gitleaks', '--annotate']));
  const lessons = read(dir, 'docs/process/lessons.md');
  assert.ok(lessons.startsWith(LESSONS0.trimEnd()), lessons);
  assert.match(lessons, /<!-- fk:knowledge appended 2026-10-14: [^\n]*-->\n## 2025-06-01 — Always run the migrations before the deploy starts/);
  assert.doesNotMatch(lessons, /```|YYYY-MM-DD|Entry format|Starter lessons/);
  assert.equal(lessons.match(/^## 2025-06-01 — Always run the migrations/gm).length, 1);
  // The unit itself: a compiled draft with the template's header and fenced example appends only the dated entries.
  const f = path.join(TMP, 'lessons-unit.md');
  fs.writeFileSync(f, LESSONS0);
  const draft = `# Lessons\n\nEntry format:\n\`\`\`\n## YYYY-MM-DD — <title>  [seen: N]\n\`\`\`\n\n## 2026-10-14 — New one  [seen: 1] [severity: med] [paths: **] [status: open]\n- Lesson: x.\n`;
  assert.equal(appendDraft(f, 'lessons.md', draft, '2026-10-14'), true);
  assert.equal(appendDraft(f, 'lessons.md', draft, '2026-10-14'), false, 'once');
  assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /```|YYYY/);
  // Annotate headers: one arrow per section.
  for (const file of ['docs/vision.md', 'docs/rules.md', 'docs/postmortems.md']) {
    const head = read(dir, file).split('\n')[0];
    assert.match(head, /^> Consolidated on 2026-10-14 \(fk knowledge-map\): §/, file);
    assert.doesNotMatch(head, /->[^;]*->/, `${file}: ${head}`);
  }
  assert.equal(read(dir, 'docs/decisions/0001-use-rest.md').split('\n')[0], '# 0001 — Use REST for the public API', 'history is not annotated');
});

test('fk knowledge check: the consolidation\'s own changes are the baseline; a superseded record is never on the accepted side', async () => {
  let r = fk(dir, ['knowledge', 'check', '--json']);
  ok(r);
  const k = JSON.parse(r.stdout);
  // Only the never-committed .cursorrules counts as new; apply's CLAUDE.md pointer and annotate headers do not.
  assert.deepEqual([k.statements, k.clusters], [1, []], JSON.stringify(k));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'adopt']);
  r = fk(dir, ['knowledge', 'check', '--json']);
  assert.deepEqual(JSON.parse(r.stdout).clusters, [], 'nor after the founder commits it');
  const idx = await loadIndex(dir, ['knowledge']);
  assert.ok(!idx.knowledge.adrs.filter(activeAdr).some((a) => /REST/.test(a.title)));
  assert.ok(readJson(stateFile(dir, 'knowledge-applied.json'), null)?.added?.['CLAUDE.md'], 'apply recorded its pointer line');
});

test('fk knowledge check recall: reversal words and the statement kind catch reworded contradictions, without new noise', () => {
  put(dir, 'docs/product-direction.md', '# Direction\n\nWe are bringing the mobile app back as the primary platform.\n\nUse GraphQL never.\n\n## Team\n- The team meets on Mondays.\n');
  const r = fk(dir, ['knowledge', 'check', '--json']);
  ok(r);
  const k = JSON.parse(r.stdout);
  const hit = (re) => k.clusters.find((c) => re.test(c.new.text));
  assert.match(hit(/mobile app back/)?.accepted[0].text || '', /mobile app is retired/, r.stdout);
  assert.match(hit(/GraphQL never/)?.accepted.map((a) => a.text).join(' | ') || '', /Use GraphQL for the public API/, r.stdout);
  assert.equal(k.clusters.length, 2, JSON.stringify(k.clusters.map((c) => [c.new.text, c.accepted.map((a) => [a.text, a.score])])));
  // The same reversal written in meeting notes (not a vision-named file) is still caught; unrelated notes stay quiet.
  fs.rmSync(path.join(dir, 'docs/product-direction.md'));
  put(dir, 'docs/notes/meeting-2026-10.md', '# Weekly sync\n\n- We are bringing the mobile app back as the primary platform.\n- The team meets on Mondays.\n');
  const n = JSON.parse(fk(dir, ['knowledge', 'check', '--json']).stdout);
  assert.ok(n.clusters.some((c) => /mobile app back/.test(c.new.text)), JSON.stringify(n.clusters));
  assert.ok(!n.clusters.some((c) => /Mondays/.test(c.new.text)));
  fs.rmSync(path.join(dir, 'docs/notes'), { recursive: true });
});
