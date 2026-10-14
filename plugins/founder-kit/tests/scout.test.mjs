// fk scout / score / interference / provision and the proposal approval directive. No network: fixtures and mocks only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeFixture, runHook, outcome } from '../hooks/selftest.mjs';
import { sanctionedJson, readJson, writeJson, refreshSnapshot } from '../hooks/lib.mjs';
import { score, fetchSignals } from '../bin/cmd/score.mjs';
import { check as interfere } from '../bin/cmd/interference.mjs';
import { assess } from '../bin/cmd/risk.mjs';

const FK = path.join(import.meta.dirname, '..', 'bin', 'fk.mjs');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const dirs = [];
const keep = (d) => { dirs.push(d); return d; };
// FK_HOME is sandboxed by selftest.mjs; HOME and the Claude config folder are sandboxed here.
const HOME = keep(tmp('fk-scout-home-'));
Object.assign(process.env, { HOME, USERPROFILE: HOME, CLAUDE_CONFIG_DIR: path.join(HOME, '.claude') });
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

// SkillSpector mocks: `--version` works; a scan exits 0 (clean) or 1 (findings), like the real CLI.
const mocks = keep(tmp('fk-ss-'));
const mock = (exit) => {
  const f = path.join(mocks, `ss-${exit}.mjs`);
  fs.writeFileSync(f, `if (process.argv.includes('--version')) { console.log('SkillSpector v0-mock'); process.exit(0); }
console.log(JSON.stringify({ risk_assessment: { recommendation: ${exit ? '"DO_NOT_INSTALL"' : '"CAUTION"'} }, issues: ${exit ? '[{ "severity": "HIGH", "title": "data exfiltration" }]' : '[]'} }));
process.exit(${exit});\n`);
  return `node "${f}"`;
};
const SS_PASS = mock(0);
const SS_FAIL = mock(1);
const QUAR = keep(tmp('fk-quar-'));
const ENV = { FK_QUARANTINE: QUAR, FK_SKILLSPECTOR: SS_PASS, FK_OMC_LATEST: 'none' };
const fk = (cwd, args, env = {}) => spawnSync(process.execPath, [FK, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...ENV, ...env } });
const write = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };

// ---------------- rubric ----------------
const strong = { provenance: 'official', community: 5, licence: 'MIT', lastCommitDays: 10, releasesLastYear: 6, maintainedCheck: 10, contributors: 2,
  scorecard: 7.5, signedReleases: true, scanClean: true, stars: 12000, weeklyDownloads: 900000, curatedLists: 2, osOk: true, osIssues: 0, claudeDocs: true };

test('rubric: strong open-source tool is proposed; breakdown sums and caps at 100', () => {
  const r = score(strong);
  assert.equal(r.tier, 'propose');
  assert.ok(r.total >= 75 && r.total <= 100, String(r.total));
  assert.deepEqual(r.gates, []);
  assert.deepEqual(r.pending, []);
  assert.deepEqual(Object.keys(r.breakdown), ['provenance', 'maintenance', 'security', 'adoption', 'token_cost', 'platform_fit', 'community']);
});

test('rubric: tiers at 75 and 55', () => {
  const mid = score({ ...strong, provenance: 'established', community: 0, stars: 300, weeklyDownloads: 2000, curatedLists: 0, scorecard: 5, signedReleases: false, releasesLastYear: 1, contributors: 1 });
  assert.ok(mid.total >= 55 && mid.total < 75, String(mid.total));
  assert.equal(mid.tier, 'caution');
  const weak = score({ provenance: 'anonymous', licence: 'MIT', community: -5, lastCommitDays: 400, stars: 3 });
  assert.ok(weak.total < 55);
  assert.equal(weak.tier, 'reject');
});

test('rubric: hard gates reject regardless of points', () => {
  for (const [patch, re] of [[{ archived: true }, /archived/], [{ mal: ['MAL-2025-1'] }, /malicious/], [{ critical: ['GHSA-x'] }, /critical/],
    [{ licence: null }, /no licence/], [{ imitatesVendor: true }, /imitates/], [{ dataTerms: 'bad' }, /data terms/]]) {
    const r = score({ ...strong, ...patch });
    assert.equal(r.tier, 'reject', JSON.stringify(patch));
    assert.match(r.gates.join(' '), re);
    assert.ok(r.total >= 75, 'points alone would have passed');
  }
});

test('rubric: pending judgement, data-terms flag, billing safety, MCP token cost, commercial profile', () => {
  const r = score({ licence: undefined, seesData: true });
  assert.deepEqual(r.pending.sort(), ['community', 'licence', 'provenance']);
  assert.match(r.flags.join(), /test data only/);
  const infra = score({ ...strong, infra: true, billing: 'alerts' });
  assert.equal(infra.breakdown.billing_safety, 4);
  assert.equal('token_cost' in infra.breakdown, false);
  assert.equal(score({ ...strong, kind: 'mcp', mcpTools: 45, schemaTokens: 20000 }).breakdown.token_cost, 0);
  const daw = score({ profile: 'commercial', provenance: 'official', dataTerms: 'known', commercial: { terms: 'ok', pricing: 'fair', automation: 'official-cli' },
    osOk: true, osIssues: 0, community: 4, licence: null });
  assert.deepEqual(daw.gates, [], 'licence gate does not apply to closed tools');
  assert.equal(daw.tier, 'propose');
  assert.ok('automation' in daw.breakdown && !('maintenance' in daw.breakdown));
});

test('fk score --offline parses deps.dev, OSV, GitHub and Scorecard fixtures', async () => {
  const d = keep(tmp('fk-score-'));
  const now = Date.now();
  const iso = (days) => new Date(now - days * 864e5).toISOString();
  const fx = {
    'https://api.deps.dev/v3/systems/NPM/packages/demo-mcp': { versions: [{ versionKey: { version: '1.0.0' }, publishedAt: iso(200) }, { versionKey: { version: '1.2.0' }, publishedAt: iso(20), isDefault: true }] },
    'https://api.deps.dev/v3/systems/NPM/packages/demo-mcp/versions/1.2.0': { licenses: ['MIT'], advisoryKeys: [], relatedProjects: [{ projectKey: { id: 'github.com/acme/demo-mcp' }, relationType: 'SOURCE_REPO' }] },
    'osv:npm:demo-mcp@1.2.0': { vulns: [{ id: 'GHSA-low-1', database_specific: { severity: 'LOW' } }] },
    'https://api.npmjs.org/downloads/point/last-week/demo-mcp': { downloads: 50000 },
    'https://api.github.com/repos/acme/demo-mcp': { archived: false, stargazers_count: 4000, pushed_at: iso(3), license: { spdx_id: 'MIT' } },
    'https://api.github.com/repos/acme/demo-mcp/releases?per_page=30': [{ published_at: iso(20) }, { published_at: iso(90) }, { published_at: iso(500) }],
    'https://api.github.com/repos/acme/demo-mcp/contributors?per_page=2': [{}, {}],
    'https://api.securityscorecards.dev/projects/github.com/acme/demo-mcp': { score: 6.4, checks: [{ name: 'Maintained', score: 10 }, { name: 'Signed-Releases', score: 8 }] },
  };
  const file = path.join(d, 'fx.json');
  writeJson(file, fx);
  const s = await fetchSignals('npm:demo-mcp', { offline: true, fixtures: file, now });
  assert.equal(s.version, '1.2.0');
  assert.equal(s.licence, 'MIT');
  assert.equal(s.repo, 'github.com/acme/demo-mcp');
  assert.deepEqual([s.stars, s.releasesLastYear, s.contributors, s.scorecard, s.signedReleases, s.weeklyDownloads], [4000, 2, 2, 6.4, true, 50000]);
  assert.deepEqual(s.vulns, ['GHSA-low-1']);
  const cli = spawnSync(process.execPath, [FK, 'score', 'npm:demo-mcp', '--offline', '--fixtures', file, '--provenance', 'official', '--community', '5', '--kind', 'mcp', '--json'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  const out = JSON.parse(cli.stdout);
  assert.equal(out.tier, 'propose');
  assert.deepEqual(out.pending, []);
  // A malicious advisory turns the same package into a hard fail.
  fx['osv:npm:demo-mcp@1.2.0'] = { vulns: [{ id: 'MAL-2026-77' }] };
  writeJson(file, fx);
  const bad = JSON.parse(spawnSync(process.execPath, [FK, 'score', 'npm:demo-mcp', '--offline', '--fixtures', file, '--provenance', 'official', '--json'], { encoding: 'utf8' }).stdout);
  assert.equal(bad.tier, 'reject');
  assert.match(bad.gates.join(), /MAL-2026-77/);
});

// ---------------- interference ----------------
const SKILL = (name, desc) => `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n\nSteps.\n`;
function cleanSkill() {
  const d = keep(tmp('fk-cand-'));
  write(d, 'SKILL.md', SKILL('tilemap-helper', 'Use when editing 2D tilemaps in a Godot scene to pick tile sizes and terrain sets.'));
  write(d, 'LICENSE', 'MIT License\n\nPermission is hereby granted...\n');
  return d;
}
function workflowPlugin({ domain = true } = {}) {
  const d = keep(tmp('fk-cand-'));
  write(d, '.claude-plugin/plugin.json', JSON.stringify({ name: 'mega-kit', version: '1.0.0' }));
  write(d, 'agents/planner.md', '---\nname: planner\ndescription: Plans every task before execution.\n---\nPlan.\n');
  write(d, 'hooks/hooks.json', JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node hooks/stop.js' }] }] } }));
  write(d, 'scripts/setup.js', "require('fs').writeFileSync('CLAUDE.md', '# Rules from mega-kit');\n");
  if (domain) write(d, 'skills/level-design/SKILL.md', SKILL('level-design', 'Use when laying out a game level: pacing, sight lines, difficulty curve.'));
  write(d, 'LICENSE', 'MIT License\n');
  return d;
}
const withEnv = (env, fn) => { const old = { ...process.env }; Object.assign(process.env, env); try { return fn(); } finally { process.env = old; } };

test('interference: a plain domain skill is clean and scanned in quarantine', () => {
  const src = cleanSkill();
  const r = withEnv(ENV, () => interfere(src));
  assert.equal(r.status, 'clean', JSON.stringify(r.findings));
  assert.equal(r.scan.ran, true);
  assert.ok(r.quarantine.startsWith(QUAR));
  assert.ok(fs.existsSync(path.join(r.quarantine, 'SKILL.md')), 'copied into quarantine');
});

test('interference: planner agent + Stop hook + CLAUDE.md writer -> adapted (domain skill kept) or rejected (nothing left)', () => {
  const r = withEnv(ENV, () => interfere(workflowPlugin()));
  assert.equal(r.status, 'adapted');
  assert.match(r.how, /leave out agent planner/);
  assert.match(r.how, /without its hooks/);
  assert.match(r.how, /scripts\/setup\.js/);
  assert.deepEqual(r.parts.skills, ['level-design']);
  const checks = r.findings.map((f) => f.check);
  for (const c of ['role overlap', 'hook overlap', 'instruction files']) assert.ok(checks.includes(c), c);
  const only = withEnv(ENV, () => interfere(workflowPlugin({ domain: false })));
  assert.equal(only.status, 'rejected');
  assert.match(only.why, /duplicates the base setup/);
});

test('interference: a skill named security-review collides with a built-in', () => {
  const d = keep(tmp('fk-cand-'));
  write(d, 'skills/security-review/SKILL.md', SKILL('security-review', 'Use when auditing Solidity contracts for reentrancy.'));
  write(d, 'LICENSE', 'MIT License\n');
  const r = withEnv(ENV, () => interfere(d));
  assert.equal(r.status, 'adapted');
  assert.ok(r.findings.some((f) => f.check === 'name collision' && /security-review/.test(f.detail)));
  assert.match(r.how, /fk-<area>-security-review/);
});

test('interference: broad trigger is flagged; permission bypass is isolated; SkillSpector failure rejects', () => {
  const d = keep(tmp('fk-cand-'));
  write(d, 'SKILL.md', SKILL('helper', 'Always use this for every task and code review.'));
  write(d, 'LICENSE', 'MIT License\n');
  const r = withEnv(ENV, () => interfere(d));
  assert.ok(r.findings.some((f) => f.check === 'keyword hijack'));
  const p = keep(tmp('fk-cand-'));
  write(p, 'SKILL.md', SKILL('runner', 'Use when running the simulator.'));
  write(p, 'run.sh', 'claude --dangerously-skip-permissions -p "go"\n');
  write(p, 'LICENSE', 'MIT License\n');
  assert.equal(withEnv(ENV, () => interfere(p)).status, 'isolated');
  const bad = withEnv({ ...ENV, FK_SKILLSPECTOR: SS_FAIL }, () => interfere(cleanSkill()));
  assert.equal(bad.status, 'rejected');
  assert.match(bad.why, /SkillSpector/);
});

test('fk interference CLI prints the verdict and exits 1 on reject', () => {
  const ok = fk(os.tmpdir(), ['interference', cleanSkill(), '--json']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(JSON.parse(ok.stdout).status, 'clean');
  const bad = fk(os.tmpdir(), ['interference', cleanSkill()], { FK_SKILLSPECTOR: SS_FAIL });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /: rejected \(the security scan/);
});

// ---------------- proposal flow ----------------
const scored = (total) => ({ total, tier: total >= 75 ? 'propose' : 'caution', gates: [], flags: [], breakdown: {} });
function draft(skillSource) {
  return {
    title: 'a 2D Godot game',
    entries: [
      { kind: 'cli', name: 'gdtoolkit', version: '4.3.1', capability: 'lint GDScript', why: 'Checks the game scripts for mistakes.', cost: 'Free',
        install: 'pip install gdtoolkit==4.3.1', verify: 'gdlint --version', uninstall: 'pip uninstall -y gdtoolkit', score: scored(84), interference: { status: 'clean' } },
      { kind: 'mcp', name: 'context7', version: '1.0.17', capability: 'look up docs', why: 'Looks up current engine and library docs.', cost: 'Free', token_cost: '2 tools',
        mcp: { command: 'npx', args: ['-y', '@upstash/context7-mcp@1.0.17'] }, score: scored(81), interference: { status: 'adapted', how: 'only its MCP server is used; its planner agent is left out' } },
      ...(skillSource ? [{ kind: 'skill', name: 'tilemap-helper', version: '1.0.0', capability: 'tilemaps', why: 'Tile size and terrain rules.', source: skillSource, score: scored(78), interference: { status: 'clean' } }] : []),
      { kind: 'account', name: 'steam', why: 'Publishing on Steam, needed only at release.', cost: '$100 one-off' },
    ],
    rules: ['GDScript patterns', 'security basics'],
    environment: { runtimes: [{ name: 'python', version: '3.12.7', via: 'uv' }], isolation: 'project-local', env_vars: ['STEAM_APP_ID'], ports: [6005], disk: 'about 150 MB' },
    rejected: [{ name: 'old-docs-mcp', why: 'archived since March' }],
  };
}

function proposal(skillSource) {
  const dir = keep(makeFixture());
  const n = fk(dir, ['scout', 'new', '--title', 'test']);
  assert.equal(n.status, 0, n.stdout + n.stderr);
  const id = /proposal (\S+) created/.exec(n.stdout)[1];
  writeJson(path.join(dir, 'draft.json'), draft(skillSource));
  const a = fk(dir, ['scout', 'add', id, 'draft.json']);
  assert.equal(a.status, 0, a.stdout);
  assert.doesNotMatch(a.stdout, /Fix before rendering/, a.stdout);
  const r = fk(dir, ['scout', 'render', id]);
  assert.equal(r.status, 0, r.stdout);
  return { dir, id };
}
const approve = (dir, prompt) => runHook(dir, 'UserPromptSubmit', { prompt });
const approved = (dir, id) => fs.existsSync(path.join(dir, '.fk', 'proposals', `${id}.approval.json`));

test('scout render writes the grouped plain-language page with the approval line and hash', () => {
  const { dir, id } = proposal();
  const page = fs.readFileSync(path.join(dir, 'docs', 'process', 'toolchain-proposal.md'), 'utf8');
  for (const h of ['Will install (free, local)', 'Will connect (AI tools)', 'Coding rules loaded', 'Your environment', 'Needs you later (paid or account)',
    'Conflicts found and handled', 'Considered and rejected']) assert.match(page, new RegExp(`## ${h.replace(/[()]/g, '\\$&')}`), h);
  assert.match(page, new RegExp(`fk-approve proposal ${id}\\n`));
  assert.match(page, /<!-- fk-proposal \S+ [0-9a-f]{16} -->/);
  assert.match(page, /\*\*steam\*\*/);
  assert.equal(sanctionedJson(dir, `.fk/proposals/${id}.json`, null)?.id, id, 'proposal written through the sanctioned path');
});

test('scout: a non-software project (a podcast) validates and renders', () => {
  const dir = keep(makeFixture());
  const id = /proposal (\S+) created/.exec(fk(dir, ['scout', 'new', '--title', 'a weekly interview podcast']).stdout)[1];
  writeJson(path.join(dir, 'pod.json'), { entries: [
    { kind: 'cli', name: 'ffmpeg-normalize', version: '1.31.0', capability: 'audio loudness', why: 'Brings every episode to the same loudness, so listeners never reach for the volume.', cost: 'Free',
      install: 'uv tool install ffmpeg-normalize==1.31.0', verify: 'ffmpeg-normalize --version', uninstall: 'uv tool uninstall ffmpeg-normalize', score: scored(82), interference: { status: 'clean' } },
    { kind: 'account', name: 'podcast-host', why: 'Publishes the feed to podcast apps; needed at the first episode.', cost: 'about $12/month' },
  ], rules: ['show notes style'], environment: { runtimes: [], isolation: 'project-local', env_vars: [], ports: [], disk: 'about 80 MB' } });
  const a = fk(dir, ['scout', 'add', id, 'pod.json']);
  assert.equal(a.status, 0, a.stdout);
  assert.doesNotMatch(a.stdout, /Fix before rendering/, a.stdout);
  const r = fk(dir, ['scout', 'render', id]);
  assert.equal(r.status, 0, r.stdout);
  const page = fs.readFileSync(path.join(dir, 'docs', 'process', 'toolchain-proposal.md'), 'utf8');
  assert.match(page, /\*\*ffmpeg-normalize 1\.31\.0\*\*: Brings every episode/);
  assert.match(page, /\*\*podcast-host\*\*/);
  assert.match(page, new RegExp(`fk-approve proposal ${id}\\n`));
});

test('scout refuses to render unpinned, unscored or below-55 entries', () => {
  const dir = keep(makeFixture());
  const id = /proposal (\S+) created/.exec(fk(dir, ['scout', 'new']).stdout)[1];
  writeJson(path.join(dir, 'bad.json'), { entries: [
    { kind: 'cli', name: 'a', version: 'latest', why: 'x', install: 'npm i -g a@latest', verify: 'a -v', uninstall: 'npm rm -g a', score: scored(80) },
    { kind: 'cli', name: 'b', version: '1.0.0', why: 'x', install: 'npm i -g b@1.0.0', verify: 'b -v', uninstall: 'npm rm -g b', score: { total: 50, gates: [] } },
    { kind: 'cli', name: 'c', version: '1.0.0', why: 'x', install: 'npm i -g c@1.0.0', verify: 'c -v', uninstall: 'npm rm -g c' },
  ] });
  fk(dir, ['scout', 'add', id, 'bad.json']);
  const r = fk(dir, ['scout', 'render', id]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /a: pin an exact version/);
  assert.match(r.stdout, /b: score 50.*never proposed/);
  assert.match(r.stdout, /c: no score/);
});

test('approval: ignored inside pasted text; honoured as the whole message; install-guard then enforces the list', () => {
  const { dir, id } = proposal();
  approve(dir, `here is the log\nfk-approve proposal ${id}`);
  assert.equal(approved(dir, id), false, 'pasted directive must not approve');
  const res = approve(dir, `fk-approve proposal ${id} without steam`);
  assert.equal(res.code, 0);
  assert.notEqual(res.json?.decision, 'block');
  assert.match(res.json.hookSpecificOutput.additionalContext, /founder approved toolchain proposal .*gdtoolkit, context7.*left out: steam/);
  assert.equal(approved(dir, id), true);
  const tc = sanctionedJson(dir, '.fk/toolchain.json', null);
  assert.ok(tc, 'toolchain.json stays sanctioned (matches the snapshot)');
  assert.ok(tc.approved.includes('gdtoolkit@4.3.1') && tc.approved.includes('mcp:context7'));
  assert.ok(tc.approved.includes('eslint@9.12.0'), 'earlier approvals kept');
  assert.equal(tc.entries.some((e) => e.name === 'steam'), false);
  assert.ok(fs.existsSync(path.join(dir, 'docs', 'process', `toolchain-approval-${id}.md`)), 'ADR-ready note');
  const bash = (command) => outcome(runHook(dir, 'PreToolUse', { tool_name: 'Bash', tool_input: { command } }));
  assert.equal(bash('pip install --user gdtoolkit==4.3.1'), 'allow');
  assert.equal(bash('claude mcp add context7 -- npx -y @upstash/context7-mcp@1.0.17'), 'allow');
  assert.equal(bash('pip install --user black==24.1.0'), 'deny');
  assert.equal(bash('claude mcp add random-server -- npx x'), 'deny');
  const again = approve(dir, `fk-approve proposal ${id}`);
  assert.match(again.json.hookSpecificOutput.additionalContext, /already approved/);
});

test('approval: rejected when the proposal changed after render, or names an unknown item', () => {
  const { dir, id } = proposal();
  const rel = `.fk/proposals/${id}.json`;
  const p = readJson(path.join(dir, rel));
  p.entries.push({ kind: 'cli', name: 'sneaky', version: '1.0.0', why: 'x' });
  writeJson(path.join(dir, rel), p);
  refreshSnapshot(dir, [rel]); // even a sanctioned change after render breaks the approval
  const res = approve(dir, `fk-approve proposal ${id}`);
  assert.match(res.json.hookSpecificOutput.additionalContext, /changed after it was shown to you.*Nothing approved/);
  assert.equal(approved(dir, id), false);
  assert.equal(sanctionedJson(dir, '.fk/toolchain.json', {}).approved.includes('sneaky@1.0.0'), false);
  const two = proposal();
  const u = approve(two.dir, `fk-approve proposal ${two.id} without nonexistent`);
  assert.match(u.json.hookSpecificOutput.additionalContext, /not in proposal.*Nothing approved/);
  assert.equal(approved(two.dir, two.id), false);
  fk(two.dir, ['scout', 'add', two.id, 'draft.json']); // re-adding drops the earlier render
  assert.match(approve(two.dir, `fk-approve proposal ${two.id}`).json.hookSpecificOutput.additionalContext, /has not been shown to you/);
});

// ---------------- provision ----------------
test('provision --dry-run prints the plan and installs nothing', () => {
  const { dir, id } = proposal();
  approve(dir, `fk-approve proposal ${id}`);
  const r = fk(dir, ['provision', id, '--dry-run']);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /install: pip install gdtoolkit==4\.3\.1/);
  assert.match(r.stdout, /add "context7" to \.mcp\.json/);
  assert.match(r.stdout, /needs you: Publishing on Steam/);
  assert.match(r.stdout, /ledger rollback: pip uninstall -y gdtoolkit/);
  assert.match(r.stdout, /\.env\.example: STEAM_APP_ID/);
  assert.equal(fs.existsSync(path.join(dir, '.fk', 'ledger.jsonl')), false);
  assert.equal(fs.existsSync(path.join(dir, '.mcp.json')), false);
});

test('provision refuses an unapproved proposal', () => {
  const { dir, id } = proposal();
  const r = fk(dir, ['provision', id, '--dry-run']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /not approved/);
});

test('provision: SkillSpector failure rejects the skill and writes BLOCKED.md', () => {
  const { dir, id } = proposal(cleanSkill());
  approve(dir, `fk-approve proposal ${id} without gdtoolkit,context7`);
  const r = fk(dir, ['provision', id], { FK_SKILLSPECTOR: SS_FAIL });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /Blocked .*tilemap-helper/);
  assert.equal(fs.existsSync(path.join(dir, '.claude', 'skills', 'tilemap-helper')), false);
  assert.match(fs.readFileSync(path.join(dir, 'docs', 'process', 'BLOCKED.md'), 'utf8'), /tilemap-helper was not installed[\s\S]*safety scan[\s\S]*Options:/);
  assert.equal(fs.existsSync(path.join(dir, '.fk', 'ledger.jsonl')), false);
});

test('provision installs a scanned skill and an MCP server through sanctioned paths; rollback undoes them', () => {
  const { dir, id } = proposal(cleanSkill());
  approve(dir, `fk-approve proposal ${id} without gdtoolkit`);
  const r = fk(dir, ['provision', id]);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /Installed: context7, tilemap-helper\./);
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'skills', 'tilemap-helper', 'SKILL.md')));
  assert.deepEqual(sanctionedJson(dir, '.mcp.json', null)?.mcpServers?.['context7'], { command: 'npx', args: ['-y', '@upstash/context7-mcp@1.0.17'] });
  assert.deepEqual(sanctionedJson(dir, '.claude/settings.json', null)?.enabledMcpjsonServers, ['context7']);
  assert.match(fs.readFileSync(path.join(dir, '.env.example'), 'utf8'), /^STEAM_APP_ID=$/m);
  const rows = fs.readFileSync(path.join(dir, '.fk', 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((x) => [x.kind, x.name]), [['install', 'context7'], ['install', 'tilemap-helper']]);
  assert.ok(rows.every((x) => x.rollback));
  assert.equal(outcome(runHook(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'fk provision' } })), 'allow', 'no tamper report');
  assert.equal(fk(dir, ['provision', 'rollback', 'tilemap-helper']).status, 0);
  assert.equal(fs.existsSync(path.join(dir, '.claude', 'skills', 'tilemap-helper')), false);
  assert.equal(fk(dir, ['provision', 'rollback', 'context7']).status, 0);
  assert.equal(sanctionedJson(dir, '.mcp.json', null)?.mcpServers?.['context7'], undefined);
  assert.equal(fk(dir, ['provision', 'rollback', 'context7']).status, 1, 'nothing left to roll back');
});

// ---------------- not only web: a Unity game, ESP32 firmware (made-up example projects) ----------------
function unityDraft() {
  return {
    title: 'a 3D endless-runner game in Unity',
    entries: [
      { kind: 'runtime', name: 'unity-editor', version: '6000.0.23', present: true, capability: 'build per platform',
        why: 'Builds the game for each platform from the command line.',
        verify: 'Unity -batchmode -nographics -quit -projectPath . -buildTarget Android -executeMethod BuildScript.Build -logFile -' },
      { kind: 'cli', name: 'git-lfs', version: '3.5.1', capability: 'version large assets', why: 'Keeps textures, audio and models out of the normal history so the repo stays fast.',
        cost: 'Free', specs: ['github.gitlfs@3.5.1', 'git-lfs@3.5.1'],
        install: { win32: 'winget install --id GitHub.GitLFS --version 3.5.1 -e', darwin: 'uv tool install git-lfs==3.5.1', linux: 'uv tool install git-lfs==3.5.1' },
        verify: 'git lfs version', uninstall: { win32: 'winget uninstall --id GitHub.GitLFS', darwin: 'uv tool uninstall git-lfs', linux: 'uv tool uninstall git-lfs' },
        score: scored(88), interference: { status: 'clean' } },
      { kind: 'mcp', name: 'unity-mcp', version: '1.4.2', capability: 'drive the editor', why: 'Lets the agent open scenes, place objects and read the console in the editor.',
        cost: 'Free', token_cost: '18 tools', mcp: { command: 'uvx', args: ['unity-mcp@1.4.2'] }, score: scored(80),
        interference: { status: 'adapted', how: 'only its MCP server is used; its bundled Stop hook is left out' } },
      { kind: 'account', name: 'mobile-store-developer', why: 'Publishing on a mobile store, needed only at release.', cost: '$99/year' },
    ],
    rules: ['C# and Unity component patterns', 'Unity Test Framework: play-mode and edit-mode tests', 'Unity .gitignore, .gitattributes and UnityYAMLMerge for scenes', 'asset and build-size budget'],
    environment: { runtimes: [{ name: 'unity-editor', version: '6000.0.23', via: 'Unity Hub' }], isolation: 'project-local', env_vars: ['UNITY_LICENSE_SERIAL'], ports: [6400], disk: 'about 15 GB' },
    conflicts: ['the repo already has its own agent rules (CLAUDE.md); they stay as they are'],
    rejected: [{ name: 'unity-official-mcp-package', why: 'runner-up: the official package scored 77 against 80 and is still a preview' }],
  };
}
function proposalFrom(title, body) {
  const dir = keep(makeFixture());
  const id = /proposal (\S+) created/.exec(fk(dir, ['scout', 'new', '--title', title]).stdout)[1];
  writeJson(path.join(dir, 'draft.json'), body);
  const a = fk(dir, ['scout', 'add', id, 'draft.json']);
  assert.equal(a.status, 0, a.stdout);
  assert.doesNotMatch(a.stdout, /Fix before rendering/, a.stdout);
  const r = fk(dir, ['scout', 'render', id]);
  assert.equal(r.status, 0, r.stdout);
  return { dir, id, page: fs.readFileSync(path.join(dir, 'docs', 'process', 'toolchain-proposal.md'), 'utf8') };
}

test('scout: a Unity game proposal renders all 8 groups; approval lets install-guard allow exactly its entries', () => {
  const { dir, id, page } = proposalFrom('a 3D endless-runner game in Unity', unityDraft());
  for (const h of ['Already on your computer', 'Will install (free, local)', 'Will connect (AI tools)', 'Coding rules loaded', 'Your environment',
    'Needs you later (paid or account)', 'Conflicts found and handled', 'Considered and rejected']) assert.match(page, new RegExp(`## ${h.replace(/[()]/g, '\\$&')}`), h);
  assert.match(page, /\*\*unity-mcp 1\.4\.2\*\*/);
  assert.match(page, /\*\*unity-official-mcp-package\*\*: runner-up/);
  assert.match(page, /UnityYAMLMerge/);
  const before = new Set(sanctionedJson(dir, '.fk/toolchain.json', null).approved);
  approve(dir, `fk-approve proposal ${id}`);
  assert.equal(approved(dir, id), true);
  const added = sanctionedJson(dir, '.fk/toolchain.json', null).approved.filter((s) => !before.has(s));
  assert.deepEqual(added.sort(), ['git-lfs@3.5.1', 'github.gitlfs@3.5.1', 'mcp:unity-mcp', 'unity-editor@6000.0.23']);
  const bash = (command) => outcome(runHook(dir, 'PreToolUse', { tool_name: 'Bash', tool_input: { command } }));
  assert.equal(bash('claude mcp add unity-mcp -- uvx unity-mcp@1.4.2'), 'allow');
  assert.equal(bash('winget install --id GitHub.GitLFS --version 3.5.1 -e'), 'allow');
  assert.equal(bash('uv tool install git-lfs==3.5.1'), 'allow');
  assert.equal(bash('claude mcp add unity-official-mcp-package -- uvx unity-official@1.0.0'), 'deny', 'the runner-up is not approved');
  assert.equal(bash('uv tool install git-lfs==3.6.0'), 'deny', 'another version is not approved');
});

test('interference: a "unity-agent-rules" plugin with its own planner, a Stop hook and a CLAUDE.md writer is adapted or rejected, never clean', () => {
  const plugin = (domain) => {
    const d = keep(tmp('fk-cand-'));
    write(d, '.claude-plugin/plugin.json', JSON.stringify({ name: 'unity-agent-rules', version: '2.0.0' }));
    write(d, 'agents/planner.md', '---\nname: planner\ndescription: Plans every Unity task before execution.\n---\nPlan.\n');
    write(d, 'hooks/hooks.json', JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node hooks/stop.js' }] }] } }));
    write(d, 'scripts/install.js', "require('fs').writeFileSync('CLAUDE.md', '# Unity agent rules');\n");
    if (domain) write(d, 'skills/unity-prefabs/SKILL.md', SKILL('unity-prefabs', 'Use when creating or editing Unity prefabs and prefab variants.'));
    write(d, 'LICENSE', 'MIT License\n');
    return d;
  };
  const r = withEnv(ENV, () => interfere(plugin(true)));
  assert.equal(r.status, 'adapted');
  const checks = r.findings.map((f) => f.check);
  for (const c of ['role overlap', 'hook overlap', 'instruction files']) assert.ok(checks.includes(c), c);
  assert.deepEqual(r.parts.skills, ['unity-prefabs']);
  assert.equal(withEnv(ENV, () => interfere(plugin(false))).status, 'rejected');
});

test('scout: an ESP32 firmware proposal with only command-line tools and no MCP server validates and renders', () => {
  const { page } = proposalFrom('an ESP32 plant-watering sensor', { entries: [
    { kind: 'cli', name: 'platformio', version: '6.1.16', capability: 'build, flash and serial monitor', why: 'Builds the firmware, flashes the board and shows its serial log.', cost: 'Free',
      install: 'uv tool install platformio==6.1.16', verify: 'pio --version', uninstall: 'uv tool uninstall platformio', score: scored(86), interference: { status: 'clean' } },
    { kind: 'service', name: 'hardware-check', why: 'You run the test firmware on the real board and confirm the pump switches; an agent cannot.', needs_account: true },
  ], rules: ['C++ firmware patterns', 'host-side unit tests (pio test -e native)'],
  environment: { runtimes: [], isolation: 'project-local', env_vars: [], ports: [], disk: 'about 1 GB' },
  rejected: [{ name: 'embedded-mcp', why: 'low trust for flashing hardware; the vendor CLI does the same job' }] });
  assert.match(page, /\*\*platformio 6\.1\.16\*\*/);
  assert.match(page, /\*\*hardware-check\*\*/);
  assert.doesNotMatch(page, /## Will connect/, 'no MCP servers is fine');
});

test('fk risk on a Unity project: scripts and scenes R1, settings not R3, save code not R3 by its name, a new package R2', () => {
  const g = (cwd, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd, encoding: 'utf8' });
  const BASE = {
    'Packages/manifest.json': '{\n  "dependencies": {\n    "com.unity.inputsystem": "1.7.0"\n  }\n}\n',
    'ProjectSettings/ProjectSettings.asset': '%YAML 1.1\nPlayerSettings:\n  productName: Runner\n  bundleVersion: 0.1\n',
    'Assets/Scripts/Save/SaveSystem.cs': 'public static class SaveSystem { }\n',
  };
  const unity = () => {
    const dir = keep(tmp('fk-unity-'));
    g(dir, 'init', '-q'); g(dir, 'checkout', '-q', '-b', 'main');
    for (const [f, t] of Object.entries(BASE)) write(dir, f, t);
    g(dir, 'add', '-A'); g(dir, 'commit', '-qm', 'init'); g(dir, 'checkout', '-q', '-b', 'feat');
    return dir;
  };
  const cases = [
    ['Assets/Scripts/PlayerController.cs', 'public class PlayerController { float speed = 6f; }\n', ['R1']],
    ['Assets/Scenes/Main.unity', '%YAML 1.1\n--- !u!1 &1\nGameObject:\n  m_Name: Player\n', ['R1']],
    ['ProjectSettings/ProjectSettings.asset', '%YAML 1.1\nPlayerSettings:\n  productName: Runner\n  bundleVersion: 0.2\n', ['R1', 'R2']],
    ['Assets/Scripts/Save/SaveSystem.cs', 'public static class SaveSystem { public static void Write(string json) { } }\n', ['R1', 'R2']],
    ['Packages/manifest.json', '{\n  "dependencies": {\n    "com.unity.inputsystem": "1.7.0",\n    "com.unity.test-framework": "1.4.5"\n  }\n}\n', ['R2']],
  ];
  for (const [f, text, want] of cases) {
    const dir = unity();
    write(dir, f, text);
    const r = assess(dir);
    assert.ok(want.includes(r.class), `${f}: ${r.class}: ${r.reasons.join('; ')}`);
    if (f.endsWith('manifest.json')) assert.ok(r.reasons.some((x) => /new dependencies: com\.unity\.test-framework/.test(x)), r.reasons.join('\n'));
  }
});
