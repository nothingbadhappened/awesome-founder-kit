// Knowledge consolidation for adopted projects (fk adopt knowledge, fk knowledge check) on a synthetic repo with history:
// a README vision (2025) contradicted by a later design doc (2026), one rule in CLAUDE.md and docs/rules.md, an undated
// .cursorrules item, an old decisions.md entry replaced by a newer RFC, and auto-memory in a sandboxed CLAUDE_CONFIG_DIR.
// Sandboxed: FK_HOME, HOME, USERPROFILE, CLAUDE_CONFIG_DIR and TMP/TEMP point into one temp folder.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SANDBOX = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'fk-kc-')));
const TMP = path.join(SANDBOX, 'tmp');
fs.mkdirSync(TMP);
Object.assign(process.env, { FK_HOME: path.join(SANDBOX, '.fk'), HOME: SANDBOX, USERPROFILE: SANDBOX, CLAUDE_CONFIG_DIR: path.join(SANDBOX, '.claude'), TMP, TEMP: TMP, TMPDIR: TMP });
const { stateDir, readJson } = await import('../hooks/lib.mjs');
const { runHook, outcome, makeFixture } = await import('../hooks/selftest.mjs');
const { parseAdr } = await import('../hooks/knowledge.mjs');
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

const dir = path.join(TMP, 'rune-runner');
fs.mkdirSync(dir);
git(dir, ['init', '-q']);
commit(dir, '2025-03-01', 'readme', {
  'README.md': '# Rune Runner\n\n## Vision\nRune Runner is a single-player offline puzzle game for mobile.\n\n## Build\nnpm run build\n',
  'docs/decisions.md': '# Decisions\n\n## 2024-06 Save storage\n- We use MySQL for the cloud save backend.\n\n## 2024-07 Audio\n- We ship music as streamed OGG files.\n',
  'docs/adr/0001-engine.md': '---\napplies_to: []\nbible: []\nfit: []\n---\n# 0001 — Godot engine\nDate: 2025-03-01 · Status: accepted\n\n## Decision\nWe build the game with Godot 4.\n',
  'docs/standards/process.md': '# Process standards\n\n- Squash merge every branch.\n',
});
commit(dir, '2025-09-01', 'rules', {
  'docs/rules.md': '# Rules\n\n## Git workflow\n- Never commit directly to the main branch; open a pull request for every change.\n- Write tests after the feature works.\n',
  'CLAUDE.md': '# Claude\n\n## Git\n- Never commit directly to main; open a pull request for every change.\n',
});
commit(dir, '2026-02-01', 'design', {
  'docs/design.md': '# Design\n\n## Vision\nRune Runner is an online multiplayer puzzle game for mobile.\n\n## Players\n- Commuters who play in short sessions.\n',
  'docs/rfcs/rfc-007-save-storage.md': '# RFC 7: Save storage\n\n## Decision\nWe use PostgreSQL for the cloud save backend; MySQL is retired.\n',
});
put(dir, '.cursorrules', '- Always write a failing test before the feature.\n'); // never committed: no date
const memory = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', dir.replace(/[^a-zA-Z0-9]/g, '-'), 'memory');
put(memory, 'feedback_push.md', '---\nname: push\ntype: feedback\n---\nRun the full test suite before every push.\n');
put(memory, 'user_profile.md', '---\ntype: user\n---\nThe founder is a designer who lives in Lisbon.\n');
put(memory, 'MEMORY.md', '- [push](feedback_push.md)\n');
const status = () => git(dir, ['status', '--porcelain']).stdout;
const STATUS0 = status();

const stmt = (dir_, text) => kj(dir_, 'statements.json').statements.find((s) => s.text.includes(text));

test('inventory: sources classified, dates per section from git history, undated flagged, auto-memory listed, nothing in the repo', () => {
  const r = fk(dir, ['adopt', 'knowledge', 'inventory', '--skip', 'mempalace']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const inv = kj(dir, 'inventory.json');
  const src = (f) => inv.sources.find((s) => s.file === f);
  const sec = (f, t) => src(f).sections.find((s) => s.title === t);
  assert.deepEqual(Object.fromEntries(['README.md', 'docs/design.md', 'CLAUDE.md', 'docs/rules.md', '.cursorrules', 'docs/decisions.md', 'docs/rfcs/rfc-007-save-storage.md', 'auto-memory/feedback_push.md', 'docs/adr/0001-engine.md']
    .map((f) => [f, src(f)?.kind])), { 'README.md': 'other', 'docs/design.md': 'bible', 'CLAUDE.md': 'rules', 'docs/rules.md': 'rules', '.cursorrules': 'rules',
    'docs/decisions.md': 'decisions', 'docs/rfcs/rfc-007-save-storage.md': 'decisions', 'auto-memory/feedback_push.md': 'memory', 'docs/adr/0001-engine.md': 'decisions' });
  assert.deepEqual([sec('README.md', 'Vision').kind, sec('README.md', 'Vision').date], ['bible', '2025-03-01'], 'a Vision heading is bible, dated by its commit');
  assert.equal(sec('docs/design.md', 'Vision').date, '2026-02-01');
  assert.equal(sec('docs/rules.md', 'Git workflow').date, '2025-09-01');
  assert.equal(src('.cursorrules').sections[0].undated, true, 'never committed: no date, flagged');
  assert.equal(src('docs/adr/0001-engine.md').kit, true);
  assert.deepEqual(inv.memory.files.map((m) => [m.name, m.personal, m.index]), [['MEMORY.md', false, true], ['feedback_push.md', false, false], ['user_profile.md', true, false]]);
  assert.ok(!inv.sources.some((s) => /user_profile|MEMORY/.test(s.file)), 'personal memory and the index are only listed');
  assert.match(r.stdout, /auto-memory: 3 file\(s\), 1 personal \(listed only, never read\)/);
  assert.equal(status(), STATUS0, 'no repo change');
  assert.equal(fs.existsSync(path.join(dir, '.fk')), false);
});

test('extract: statements with source, section, lines, date, kind and topic; the cap keeps rules, decisions and bible first', () => {
  let r = fk(dir, ['adopt', 'knowledge', 'extract', '--max-statements', '6']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  let st = kj(dir, 'statements.json');
  assert.equal(st.kept, 6);
  assert.equal(st.skipped.count, st.total - 6);
  assert.ok(st.statements.every((s) => ['rules', 'decisions'].includes(s.kind)), st.statements.map((s) => s.kind).join());
  assert.ok(st.skipped.by_kind.memory && st.skipped.by_kind.bible, 'what was skipped is recorded');
  assert.match(r.stdout, /skipped by the 6 cap/);
  r = fk(dir, ['adopt', 'knowledge', 'extract']);
  st = kj(dir, 'statements.json');
  assert.equal(st.skipped.count, 0);
  const v = stmt(dir, 'single-player offline');
  assert.deepEqual([v.file, v.section, v.lines, v.date, v.kind], ['README.md', 'Rune Runner > Vision', [4, 4], '2025-03-01', 'bible']);
  assert.ok(v.keywords.includes('offline') && v.topic.includes('vision'));
  assert.equal(stmt(dir, 'failing test').undated, true);
  assert.ok(stmt(dir, 'full test suite'), 'auto-memory item extracted');
  assert.ok(!st.statements.some((s) => /Lisbon|designer/.test(s.text)), 'personal memory never read');
});

test('candidates: the contradiction pair, the duplicate and the old decision are grouped; work file for the analyst; token budget cuts the least important', () => {
  const r = fk(dir, ['adopt', 'knowledge', 'candidates']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const c = kj(dir, 'candidates.json');
  const has = (...texts) => c.clusters.find((x) => texts.every((t) => x.ids.includes(stmt(dir, t).id)));
  assert.ok(has('single-player offline', 'online multiplayer'), 'vision contradiction grouped');
  assert.ok(has('commit directly to main;', 'commit directly to the main branch'), 'duplicate rule grouped');
  assert.ok(has('MySQL for the cloud', 'PostgreSQL'), 'old decision and newer RFC grouped');
  assert.ok(has('failing test', 'tests after'), 'undated rule grouped');
  assert.ok(!has('single-player offline', 'commit directly to main;'), 'unrelated statements stay apart');
  const work = fs.readFileSync(kw(dir, 'work', 'batch-01.md'), 'utf8');
  assert.match(work, /fk adopt knowledge verdict --by analyst <<'EOF'/);
  assert.match(work, /README\.md §Rune Runner > Vision L4, 2025-03-01: "Rune Runner is a single-player/);
  assert.ok(c.budget.estimated <= c.budget.analyst_share);
  const tight = fk(dir, ['adopt', 'knowledge', 'candidates', '--max-tokens', '4500']);
  assert.match(tight.stdout, /left out \(budget\)/);
  assert.match(r.stdout, /an estimated \d+k tokens \(including about 10k agent overhead per batch\)/);
  assert.match(tight.stdout, /too small for even one analyst batch \(about 1\dk tokens, three quarters of the budget go to the analyst\)\. Use at least --max-tokens \d+\./);
  const t = kj(dir, 'candidates.json');
  assert.ok(t.deferred.length > 0 && t.clusters.length < c.clusters.length);
  assert.ok(Math.min(...t.clusters.map((x) => x.impact)) >= Math.max(...t.deferred.map((x) => x.impact)), 'highest impact kept');
  assert.equal(fk(dir, ['adopt', 'knowledge', 'candidates']).status, 0);
  assert.equal(status(), STATUS0);
});

const cid = (...texts) => kj(dir, 'candidates.json').clusters.find((x) => texts.every((t) => x.ids.includes(stmt(dir, t).id))).id;

test('verdict: the sanctioned writer validates and records; direct writes to the kit state are denied by the gate guard', () => {
  const vision = cid('single-player offline', 'online multiplayer');
  const bad = fk(dir, ['adopt', 'knowledge', 'verdict', vision], 'verdict: maybe\nwhy: unsure\n');
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /nothing recorded[\s\S]*verdict must be/);
  assert.equal(fs.existsSync(kw(dir, 'verdicts', `${vision}.json`)), false);
  const blocks = [[cid('single-player offline', 'online multiplayer'), 'contradiction', 'Single-player offline versus online multiplayer.'],
    [cid('MySQL for the cloud', 'PostgreSQL'), 'contradiction', 'Saves moved from MySQL to PostgreSQL.'],
    [cid('failing test', 'tests after'), 'contradiction', 'Tests first versus tests after.'],
    [cid('commit directly to main;', 'commit directly to the main branch'), 'duplicate', 'The same git rule twice.']]
    .map(([c, v, why]) => `cluster: ${c}\nverdict: ${v}\nscope: same\nwhy: ${why}\n`).join('\n');
  const r = fk(dir, ['adopt', 'knowledge', 'verdict', '--by', 'analyst'], blocks);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout.match(/recorded C-\d{3}/g).length, 4);
  assert.equal(kj(dir, `verdicts/${vision}.json`).analyst.verdict, 'contradiction');
  // In a project where the guards are active, agents cannot write the kit state directly; the fk command passes.
  const fx = makeFixture();
  try {
    const target = path.join(stateDir(fx), 'adopt', 'knowledge', 'verdicts', 'C-001.json');
    const pre = (tool_name, tool_input) => outcome(runHook(fx, 'PreToolUse', { tool_name, tool_input }));
    assert.equal(pre('Write', { file_path: target, content: '{}' }), 'deny');
    assert.equal(pre('Bash', { command: `cat > "${target}" <<'EOF'\n{}\nEOF` }), 'deny');
    assert.equal(pre('Bash', { command: "fk adopt knowledge verdict --by analyst <<'EOF'\ncluster: C-001\nverdict: ok\nwhy: compatible\nEOF" }), 'allow');
    assert.equal(pre('Bash', { command: 'fk adopt knowledge resolve C-001 keep:S-0002 --note "both hold"' }), 'allow');
  } finally { fs.rmSync(stateDir(fx), { recursive: true, force: true }); fs.rmSync(fx, { recursive: true, force: true }); }
});

test('report: latest-wins proposals with both statements, sources and dates; undated conflicts go to the founder; critic second look', () => {
  const r = fk(dir, ['adopt', 'knowledge', 'report']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /3 contradiction\(s\) \(2 settle by newer-wins, 1 need the founder\), 1 duplicate\(s\)/);
  assert.match(r.stdout, /Second look for OMC's critic \(3 important/);
  const rep = kj(dir, 'report.json');
  const vision = rep.contradictions.find((c) => c.cluster === cid('single-player offline', 'online multiplayer'));
  assert.equal(vision.winner, stmt(dir, 'online multiplayer').id);
  assert.equal(rep.contradictions.find((c) => c.cluster === cid('failing test', 'tests after')).ambiguous, 'a statement has no date in the history');
  assert.equal(rep.duplicates[0].keep, stmt(dir, 'commit directly to the main branch').id, 'same date: the project doc is kept over the agent rule file');
  const md = fs.readFileSync(kw(dir, 'report.md'), 'utf8');
  assert.match(md, /"Rune Runner is a single-player offline puzzle game for mobile\." \(README\.md §Rune Runner > Vision, 2025-03-01\)/);
  assert.match(md, /Proposal: newer wins, keep S-\d{4} \(2026-02-01\)/);
  assert.match(md, /Proposal: needs you \(a statement has no date in the history\)/);
  assert.match(md, /## No date \(ask if they still hold\)\n- S-\d{4}: "Always write a failing test/);
  assert.match(fs.readFileSync(kw(dir, 'work', 'critic.md'), 'utf8'), /fk adopt knowledge verdict --by critic/);
});

test('resolve: accept all newer-wins; ambiguous ones need an explicit answer; compile refuses while one is open', () => {
  const r = fk(dir, ['adopt', 'knowledge', 'resolve', '--all', 'latest']);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(r.stdout.match(/resolved: latest/g).length, 3);
  const tests = cid('failing test', 'tests after');
  assert.match(r.stdout, new RegExp(`Still for the founder: ${tests} \\(a statement has no date`));
  assert.equal(fk(dir, ['adopt', 'knowledge', 'resolve', tests, 'latest']).status, 1);
  assert.equal(fk(dir, ['adopt', 'knowledge', 'resolve', tests, 'both']).status, 1, 'both needs the wording');
  const c = fk(dir, ['adopt', 'knowledge', 'compile']);
  assert.equal(c.status, 1);
  assert.match(c.stdout, /still need the founder/);
  assert.match(fk(dir, ['adopt', 'knowledge', 'resolve', tests, `keep:${stmt(dir, 'failing test').id.toLowerCase()}`]).stdout, /Every contradiction is resolved/);
  assert.equal(kj(dir, 'resolutions.json')[tests].choice, `keep:${stmt(dir, 'failing test').id}`);
});

test('compile --dry-run: bible, ADRs with supersedes, standards, lessons and the knowledge map; numbered after existing ADRs; no repo change', () => {
  const r = fk(dir, ['adopt', 'knowledge', 'compile', '--dry-run']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const p = (f) => fs.readFileSync(kw(dir, 'preview', f), 'utf8');
  const adrs = fs.readdirSync(kw(dir, 'preview', 'adr')).sort();
  assert.ok(adrs.every((n) => Number(n.slice(0, 4)) >= 2), `after the existing 0001: ${adrs}`);
  const vision = adrs.map((n) => [n, p(`adr/${n}`)]).find(([, t]) => /online multiplayer/.test(t));
  assert.ok(vision, adrs.join());
  assert.match(vision[1], /^bible: \[mission\]$/m);
  assert.match(vision[1], /^supersedes: \["README\.md §Vision"\]$/m);
  assert.match(vision[1], /Status: accepted \(founder, knowledge consolidation C-\d{3}\)/);
  const parsed = parseAdr(vision[1], `docs/adr/${vision[0]}`);
  assert.deepEqual([parsed.status, parsed.supersedes, parsed.bible], ['accepted', [], ['mission']], 'source locations are not taken for ADR ids');
  const save = adrs.map((n) => p(`adr/${n}`)).find((t) => /PostgreSQL/.test(t));
  assert.match(save, /^supersedes: \["docs\/decisions\.md §2024-06 Save storage"\]$/m);
  assert.ok(adrs.map((n) => p(`adr/${n}`)).some((t) => /^# \d{4} — 2024-07 Audio$/m.test(t) && /- We ship music as streamed OGG files\./.test(t)), 'an undisputed decision becomes its own ADR');
  const bible = p('PROJECT.md');
  assert.match(bible, /^## Mission <!-- fk:updated 2026-10-14 -->\n- Rune Runner is an online multiplayer puzzle game for mobile\. \(ADR-\d{4}\)$/m);
  assert.match(bible, /^## Users <!-- fk:updated 2026-10-14 -->\n- Commuters who play in short sessions\.$/m);
  assert.doesNotMatch(bible, /single-player/);
  assert.ok(bible.trimEnd().split('\n').length <= 60);
  assert.match(p('standards/process.md'), /^- Never commit directly to the main branch; open a pull request for every change\.$/m);
  assert.equal(p('standards/process.md').match(/Never commit/g).length, 1, 'the duplicate is merged');
  assert.match(p('standards/testing.md'), /^- Always write a failing test before the feature\. \(ADR-\d{4}\)$/m);
  assert.doesNotMatch(p('standards/testing.md'), /tests after/);
  assert.match(p('lessons.md'), /^## 2026-10-14 — Run the full test suite before every push {2}\[seen: 1\] \[severity: med\] \[paths: \*\*\] \[status: open\]$/m);
  const map = p('knowledge-map.md');
  assert.match(map, /^<!-- fk:consolidated 2026-10-14 commit [0-9a-f]+ -->$/m);
  assert.match(map, /^\| README\.md §Rune Runner > Vision \| 2025-03-01 \| superseded by ADR-\d{4} \| C-\d{3} latest \|$/m);
  assert.match(map, /^\| CLAUDE\.md §Claude > Git \| 2025-09-01 \| merged into S-\d{4} \(docs\/standards\/process\.md\) \| C-\d{3} latest \|$/m);
  assert.match(map, /^\| docs\/adr\/0001-engine\.md §0001 — Godot engine > Decision \| 2025-03-01 \| already in the kit structure \| - \|$/m);
  assert.match(r.stdout, /^append  docs\/standards\/process\.md/m, 'an existing kit file is appended to, never replaced');
  assert.match(r.stdout, /^create  docs\/PROJECT\.md \(bible, own mode\)/m);
  assert.match(r.stdout, /Agent rule files \(\.cursorrules, CLAUDE\.md\) are never rewritten/);
  assert.equal(status(), STATUS0, 'no repo change before apply');
  assert.equal(fs.existsSync(path.join(stateDir(dir), 'adopt', 'drafts')), false, 'a dry run writes no drafts');
});

test('privacy: no local path, mail address or personal memory in anything the consolidation stores', () => {
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) (e.isDirectory() ? walk : (x) => files.push(x))(path.join(d, e.name)); };
  walk(path.join(stateDir(dir), 'adopt', 'knowledge'));
  assert.ok(files.length > 8);
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const leak of [SANDBOX, dir, dir.replace(/\\/g, '/'), memory, 'Lisbon', 't@example.com']) assert.ok(!text.includes(leak), `${path.basename(f)} stores ${leak}`);
  }
});

test('compile + apply: drafts installed without overwriting (append + mark), originals untouched until --annotate, agent rule files never', () => {
  assert.equal(fk(dir, ['adopt', 'knowledge', 'compile']).status, 0);
  assert.equal(status(), STATUS0, 'drafts live outside the repo');
  assert.equal(fk(dir, ['adopt', 'survey', '--skip', 'gitleaks,docker,sessions']).status, 0);
  assert.equal(fk(dir, ['adopt', 'plan']).status, 0);
  const originals = Object.fromEntries(['README.md', 'docs/design.md', 'docs/rules.md', 'docs/decisions.md', 'CLAUDE.md', '.cursorrules'].map((f) => [f, read(dir, f)]));
  let r = fk(dir, ['adopt', 'apply', '--no-gitleaks']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /merged {2}docs\/standards\/process\.md \(appended under a review marker\)/);
  assert.match(r.stdout, /created docs\/process\/knowledge-map\.md/);
  assert.match(r.stdout, /bible {3}docs\/PROJECT\.md mode: own/);
  const proc = read(dir, 'docs/standards/process.md');
  assert.match(proc, /^# Process standards\n\n- Squash merge every branch\.\n\n<!-- fk:knowledge appended 2026-10-14: [^\n]*-->\n/, 'the original content stays first');
  assert.match(proc, /- Never commit directly to the main branch/);
  for (const [f, t] of Object.entries(originals)) assert.equal(read(dir, f), f === 'CLAUDE.md' ? `${t}Project bible: docs/PROJECT.md — read it first.\n` : t, `${f} untouched without --annotate`);
  assert.match(r.stdout, /original docs left untouched/);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'adopt']);
  r = fk(dir, ['adopt', 'apply', '--no-gitleaks']);
  assert.match(r.stdout, /kept {4}docs\/standards\/process\.md \(already holds the consolidated entries\)/, 'a second apply appends nothing');
  r = fk(dir, ['adopt', 'apply', '--no-gitleaks', '--annotate']);
  assert.match(read(dir, 'README.md'), /^> Consolidated on 2026-10-14 \(fk knowledge-map\): §Vision superseded by ADR-\d{4}\.\n\n# Rune Runner\n/);
  assert.match(read(dir, 'docs/rules.md'), /^> Consolidated on 2026-10-14 \(fk knowledge-map\): §Git workflow -> docs\/standards\/process\.md, superseded by ADR-\d{4}\.\n/);
  assert.match(read(dir, 'docs/design.md'), /^> Consolidated on 2026-10-14 \(fk knowledge-map\): §Vision -> docs\/PROJECT\.md, ADR-\d{4}; §Players -> docs\/PROJECT\.md\.\n/);
  assert.equal(read(dir, '.cursorrules'), originals['.cursorrules'], 'agent rule files are never rewritten');
  assert.doesNotMatch(read(dir, 'CLAUDE.md'), /knowledge-map/);
  const once = read(dir, 'README.md');
  fk(dir, ['adopt', 'apply', '--no-gitleaks', '--annotate']);
  assert.equal(read(dir, 'README.md'), once, 'annotated once');
  assert.doesNotMatch(runHook(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'fk x' } }).stdout, /block/, 'no tamper report');
});

test('fk knowledge check: a newly added doc that contradicts an accepted ADR is flagged; audit and the weekly note surface it', async () => {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'annotated']);
  let r = fk(dir, ['knowledge', 'check', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).clusters, [], 'the consolidated docs themselves raise nothing');
  put(dir, 'docs/notes/direction.md', '# Direction\n\nRune Runner stays a single-player offline puzzle game for mobile.\n\n## Team\n- The team meets on Mondays.\n');
  r = fk(dir, ['knowledge', 'check', '--json']);
  const k = JSON.parse(r.stdout);
  assert.equal(k.clusters.length, 1, r.stdout);
  assert.equal(k.clusters[0].new.file, 'docs/notes/direction.md');
  assert.match(k.clusters[0].accepted[0].ref, /^ADR-\d{4}$/);
  assert.match(k.clusters[0].accepted[0].text, /online multiplayer/);
  assert.match(fs.readFileSync(path.join(stateDir(dir), 'knowledge-check.md'), 'utf8'), /new: docs\/notes\/direction\.md §Direction L3/);
  assert.match(fk(dir, ['knowledge', 'check']).stdout, /1 may contradict accepted decisions or standards[\s\S]*K-001 docs\/notes\/direction\.md L3/);
  assert.match(fk(dir, ['audit']).stdout, /fk audit: 1 statement\(s\) in docs changed since the knowledge consolidation may contradict/);
  const note = (await import(pathToFileURL(path.join(KIT, 'hooks', 'session', '36-knowledge.mjs')).href)).default;
  assert.match(note({ root: dir, now: Date.parse('2026-10-14') }), /^fk: 1 statement\(s\) in docs changed since the knowledge consolidation may contradict/);
  assert.equal(note({ root: dir, now: Date.parse('2026-10-15') }), undefined, 'once a week');
  assert.match(note({ root: dir, now: Date.parse('2026-10-22') }), /fk knowledge check/);
});
