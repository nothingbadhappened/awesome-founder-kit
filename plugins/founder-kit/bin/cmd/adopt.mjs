// fk adopt survey | draft | plan | apply | where  (§4.1: adopting a project already in progress)
//   survey [--run name=cmd]... [--days 90] [--min-pair 3] [--session-cap 10] [--skip gitleaks,docker,sessions]
//   draft <name> [--from <file>]   write <workspace>/drafts/<name> (from a file, or stdin)
//   plan                           health report + remediation draft from the survey -> <workspace>/drafts/health.md
//   apply                          after the founder's yes: fk init, confirmed drafts into docs/, pre-existing ledger, baseline
//   where                          print the workspace folder
// Until apply nothing in the repo changes (A1): the workspace lives in the kit state dir, outside the repo.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, loadConfig, stateDir } from '../../hooks/lib.mjs';
import { say, needRoot, parseArgs, git, slug } from './adopt/util.mjs';
import { survey, surveyMd, sessionsDir } from './adopt/survey.mjs';
import { record } from './baseline.mjs';
import { fingerprint, readLedger, appendLedger } from './steward/lib.mjs';

const USAGE = 'usage: fk adopt survey [--run name=cmd]... [--skip gitleaks,docker,sessions] | fk adopt draft <name> [--from file] | fk adopt plan | fk adopt apply | fk adopt where';
export const adoptDir = (root) => path.join(stateDir(root), 'adopt');
function put(root, rel, value) {
  const abs = path.join(adoptDir(root), rel);
  if (typeof value === 'string') { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, value); }
  else writeJson(abs, value);
  return abs;
}

function doSurvey(root, flags) {
  const s = survey(root, flags);
  put(root, 'survey.json', s);
  const md = put(root, 'survey.md', surveyMd(s));
  say(`fk adopt: survey written to ${md} (plain) and survey.json next to it, outside the repo. Nothing in the project changed.`);
  if (s.sessions.found) {
    const dir = sessionsDir(root);
    say(`Past Claude sessions: ${s.sessions.count} file(s), ${s.sessions.total_mb} MB. Most recent first:`);
    for (const r of s.sessions.recent.slice(0, s.sessions.suggested_cap)) say(`  ${r.modified}  ${String(r.kb).padStart(7)} KB  ${path.join(dir, r.file)}`);
    say(`Mine the chosen ones with: mempalace mine "<file>" --mode convos --wing ${s.mempalace_wing}`);
  }
  say(`Index the code (MCP, not the CLI): codebase-memory-mcp index_repository with repo_path = the repo root.`);
}

function draft(root, pos, flags) {
  const name = pos[1];
  if (!name || name.split(/[\\/]/).some((p) => p === '..' || !p) || path.isAbsolute(name)) { say('usage: fk adopt draft <name, e.g. 00-constraints.md or adr/0001-x.md> [--from file]'); process.exitCode = 1; return; }
  const text = flags.from ? fs.readFileSync(path.resolve(String(flags.from)), 'utf8') : fs.readFileSync(0, 'utf8');
  if (!text.trim()) { say('fk adopt draft: empty input; nothing written.'); process.exitCode = 1; return; }
  say(`fk adopt: draft saved to ${put(root, `drafts/${name.replace(/\\/g, '/')}`, text)}`);
}

function risks(s) {
  const r = [];
  const st = s.stack, g = s.git;
  if (s.gitleaks?.count) r.push(['R2', 'security', `${s.gitleaks.count} possible secret(s) in the git history (${Object.keys(s.gitleaks.rules).join(', ')}). Rotate those keys first; rewriting history is a separate decision.`]);
  if (s.gitleaks?.installed === false) r.push(['R1', 'security', 'The git history was not scanned for secrets (gitleaks missing).']);
  if (st.infra.length || s.containers?.related?.length) r.push(['R2', 'money', `Hosting or infrastructure is set up (${[...st.infra, ...(s.containers?.related || []).map((c) => c.name)].slice(0, 5).join(', ')}) and no spending cap is recorded yet.`]);
  if (!st.test_files) r.push(['R1', 'tests', 'No automated tests were found.']);
  if (!st.ci.length) r.push(['R1', 'checks', 'Nothing checks each change automatically (no CI).']);
  for (const c of (g.fix_chains || []).slice(0, 3)) r.push(['R1', 'fragile area', `${c.length} fixes in a row on ${c.files.slice(0, 3).join(', ')}: add tests there before changing it again.`]);
  if (g.reverts?.count) r.push(['R1', 'stability', `${g.reverts.count} change(s) had to be reverted.`]);
  for (const [n, run] of Object.entries(s.runs || {})) if (run.exit !== 0) r.push(['R1', 'gates', `"${n}" fails today (${run.value} problem(s)); recorded as the baseline, not fixed in one go.`]);
  return r.sort((a, b) => b[0].localeCompare(a[0]));
}

function plan(root) {
  const s = readJson(path.join(adoptDir(root), 'survey.json'), null);
  if (!s) { say('fk adopt: run fk adopt survey first.'); process.exitCode = 1; return; }
  const rs = risks(s);
  const md = `# Health report: ${s.repo}

<!-- Plain words for the founder. Rewrite freely with: fk adopt draft health.md --from <file> -->

## In one paragraph

## What is risky now (most serious first)
${rs.length ? rs.map(([lvl, area, text], i) => `${i + 1}. **${area}** (${lvl}): ${text}`).join('\n') : '1. Nothing serious found by the survey.'}

## Tools to add or change
From the fk-scout delta run.

## What happens if you approve
- The kit's checks are switched on. Today's problems are recorded as the starting line: only new problems block work.
- Work in progress (${s.git.uncommitted ?? 0} uncommitted file(s), ${s.git.branches ?? '?'} branch(es)) is left exactly as it is.
- Anything already running (${s.containers?.related?.length || 0} container(s)) is marked "already here, not ours" and is never stopped by the kit.

## Remediation backlog (for OMC's plan, one item at a time)
${rs.length ? rs.map(([lvl, area, text]) => `- [ ] ${lvl} ${area}: ${text}`).join('\n') : '- [ ] none'}
`;
  const file = put(root, 'drafts/health.md', md);
  say(`fk adopt: health report draft written to ${file} (${rs.length} risk(s)). Edit it, then show the founder for one yes.`);
}

function targets(root) {
  const c = loadConfig(root).paths;
  return [['00-constraints.md', c.constraints], ['lessons.md', 'docs/process/lessons.md'], ['impact-map.yaml', 'docs/standards/impact-map.yaml'], ['adr', c.adr]];
}

function apply(root, flags) {
  const s = readJson(path.join(adoptDir(root), 'survey.json'), null);
  if (!s || !fs.existsSync(path.join(adoptDir(root), 'drafts', 'health.md'))) { say('fk adopt: run fk adopt survey and fk adopt plan first, and get the founder\'s yes on the health report.'); process.exitCode = 1; return; }
  // A6: work in progress is never touched.
  const dirty = new Set(git(root, ['status', '--porcelain']).stdout.split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop()));
  if (dirty.size) say(`fk adopt: ${dirty.size} uncommitted file(s) left untouched.`);
  // A5: install. fk init never replaces another git hooks path (husky, ...); it prints how to chain the kit's checks instead.
  if (!fs.existsSync(path.join(root, '.fk', 'config.json'))) {
    const r = spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fk.mjs'), 'init'], { cwd: root, encoding: 'utf8' });
    process.stdout.write(r.stdout || '');
  }
  // Confirmed drafts into docs/, never over an existing or uncommitted file.
  const drafts = path.join(adoptDir(root), 'drafts');
  for (const [src, dst] of targets(root)) {
    const from = path.join(drafts, src);
    if (!fs.existsSync(from)) continue;
    const items = fs.statSync(from).isDirectory() ? fs.readdirSync(from).map((f) => [path.join(from, f), `${dst}/${f}`]) : [[from, dst]];
    for (const [a, rel] of items) {
      if (fs.existsSync(path.join(root, rel)) || dirty.has(rel)) { say(`kept    ${rel} (already there; draft left in ${drafts})`); continue; }
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.copyFileSync(a, path.join(root, rel));
      say(`created ${rel}`);
    }
  }
  // Already-running resources: pre-existing, never swept.
  const known = new Set(readLedger(root).map((e) => `${e.kind}:${e.id}`));
  for (const c of s.containers?.related || []) {
    if (known.has(`container:${c.id}`)) continue;
    appendLedger(root, { ts: new Date().toISOString(), fp: fingerprint(root), kind: 'container', id: c.id, name: c.name, pre_existing: true, source: 'fk adopt' });
    say(`ledger  container ${c.name} recorded as pre-existing (the sweep never touches it)`);
  }
  if (!fs.existsSync(path.join(root, '.fk', 'baseline.json'))) record(root, flags);
  else say('kept    .fk/baseline.json');
  say(`fk adopt: installed for ${slug(root)}. Next: add the health report's remediation backlog to OMC's plan (R2 first), one item per task.`);
}

export default async function adopt(args) {
  const { pos, flags } = parseArgs(args);
  const root = needRoot();
  const sub = { where: () => say(adoptDir(root)), survey: () => doSurvey(root, flags), draft: () => draft(root, pos, flags), plan: () => plan(root), apply: () => apply(root, flags) }[pos[0]];
  if (sub) return sub();
  say(USAGE); process.exitCode = 1;
}
