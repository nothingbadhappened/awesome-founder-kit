// fk task new "<title>" [--risk Rn] [--from-omc <path>] [--paths <globs>] | context <id> | check <id> | done <id> | reopen <id> | list
// Task records, not a workflow: docs/tasks/<id>.md holds the acceptance criteria (AC-n); reviewers write
// docs/tasks/<id>.review-<n>.md with "Verdict: ACCEPT|REVISE" and (required from R2) one "AC-n: PASS|FAIL — evidence" line per criterion.
// Start/close times live in the kit state dir. Nothing here blocks an edit or a stop; `fk task done` is the close step.
// "Context:" in the record lists the ADRs and lessons covering the task's paths; from R2 the accepted review needs
// one "ADR-NNNN: OK|VIOLATION — note" line per cited ADR.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, readJson, readLog, readOverrides } from '../../hooks/lib.mjs';
import { readTasks, writeTasks, readAuthorship, readGateRuns, logGateRun } from '../../hooks/authorship.mjs';
import { say, git, needRoot, parseArgs, today, measure } from './adopt/util.mjs';
import { assess, maxClass, CLASSES } from './risk.mjs';
import { loadIndex, relevant, contextIds, CONTEXT_LINE } from '../../hooks/knowledge.mjs';
import { setNow } from './bible.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMPLATE = path.join(KIT, 'skills', 'fk-process', 'templates', 'task-spec.md');
export const DIR = 'docs/tasks';
const ID = /^T-\d{3,}$/;
const USAGE = 'usage: fk task new "<title>" [--risk R0|R1|R2|R3] [--from-omc <path>] [--paths "<glob>,<file>"] | fk task context <id> | fk task check <id> | fk task done <id> | fk task reopen <id> | fk task list';
const REVIEW = /^(T-\d{3,})\.review-(\d+)\.md$/;
const AC_LINE = /^\s*(?:[-*]\s*)?(AC-\d+)\s*:\s*(PASS|FAIL)\b\s*(?:[—–:-]+\s*)?(.*)$/i;
const ADR_LINE = /^\s*(?:[-*]\s*)?(ADR-\d{4})\s*:\s*(OK|VIOLATION)\b\s*(?:[—–:-]+\s*)?(.*)$/i;
const OVERRIDE_HINT = 'The founder may close it anyway by typing: fk-override task-check <reason> (then run fk task done again).';

const contract = () => readJson(path.join(KIT, 'policy', 'base-contract.json'), {});
// The kit's reviewer agents plus the project's own (fk config set reviewer_extra <agent>, e.g. a domain plugin's reviewer).
export const reviewerAgents = (root) => [...(contract().reviewer_agents || []), ...(root ? loadConfig(root).reviewer_extra || [] : []).map((a) => agentName(a))];
// Agents that build, never review: refused as reviewer_extra.
export const implementerAgents = () => { const c = contract(); return [...(c.agents?.omc || []), ...(c.agents?.builtin || [])].filter((a) => !(c.reviewer_agents || []).includes(a)); };
export const agentName = (t) => (t ? String(t).split(':').pop() : null);
const rel = (id) => `${DIR}/${id}.md`;

// ---- the task record ----
export function parseTask(text) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) return null;
  const t = { acceptance: [] };
  for (const line of fm[1].split(/\r?\n/)) {
    const ac = /^\s*-\s*["']?(AC-\d+)\s*:\s*(.*?)["']?\s*$/.exec(line);
    if (ac) { t.acceptance.push({ id: ac[1].toUpperCase(), text: ac[2] }); continue; }
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (kv && kv[1] !== 'acceptance') t[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  t.context = contextIds(text);
  return t;
}
export function readTask(root, id) {
  try { return parseTask(fs.readFileSync(path.join(root, rel(id)), 'utf8')); } catch { return null; }
}
const placeholder = (ac) => !ac.text || /^<.*>$/.test(ac.text.trim());

// ---- OMC acceptance criteria (read only; .omc is never written) ----
export function omcCandidates(root) {
  const out = [];
  const add = (p) => { try { out.push([p, fs.statSync(path.join(root, p)).mtimeMs]); } catch { /* absent */ } };
  const ls = (dir, re) => { try { return fs.readdirSync(path.join(root, dir)).filter((n) => re.test(n)).map((n) => `${dir}/${n}`); } catch { return []; } };
  ['prd.json', '.omc/prd.json', '.omc/state/prd.json', '.omc/ultragoal/goals.json'].forEach(add);
  for (const s of ls('.omc/state/sessions', /./)) add(`${s}/prd.json`);
  for (const p of ls('.omc/ultragoal/plans', /./)) add(`${p}/goals.json`);
  for (const d of ['.omc/plans', '.omc/specs']) ls(d, /\.md$/i).forEach(add);
  return out.sort((a, b) => b[1] - a[1]).map(([p]) => p);
}

export function importOmc(root, file) {
  const text = fs.readFileSync(path.resolve(root, file), 'utf8');
  if (/\.json$/i.test(file)) {
    const j = JSON.parse(text);
    if (Array.isArray(j.userStories)) { // ralph prd.json
      const many = j.userStories.length > 1;
      return j.userStories.flatMap((s) => (s.acceptanceCriteria || []).map((c) => (many ? `${s.id}: ${c}` : String(c))));
    }
    if (Array.isArray(j.goals)) return j.goals.map((g) => (g.objective ? `${g.title ? `${g.title}: ` : ''}${g.objective}` : g.title)).filter(Boolean); // ultragoal
    throw new Error('no userStories[].acceptanceCriteria (ralph prd.json) or goals[].objective (ultragoal goals.json) found');
  }
  const lines = text.split(/\r?\n/);
  // "## Acceptance Criteria", "### Acceptance", "## Success Criteria", or a bold line "**Acceptance Criteria**".
  const NAME = '(?:(?:Acceptance|Success)\\s+Criteria\\b.*|Acceptance\\s*:?\\s*)';
  const start = lines.findIndex((l) => new RegExp(`^#{1,4}\\s*${NAME}$|^\\s*\\*\\*\\s*${NAME}\\*\\*\\s*:?\\s*$`, 'i').test(l));
  if (start < 0) throw new Error('no "Acceptance Criteria" section found');
  const level = /^#+/.exec(lines[start])?.[0].length ?? 9; // a bold label ends at any heading or the next bold label
  const acs = [];
  for (const l of lines.slice(start + 1)) {
    const h = /^(#+)\s/.exec(l);
    if ((h && h[1].length <= level) || (level === 9 && /^\s*\*\*[^*]+\*\*\s*:?\s*$/.test(l))) break;
    const m = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?(.+?)\s*$/.exec(l);
    if (m) acs.push(m[1]);
  }
  if (!acs.length) throw new Error('the "Acceptance Criteria" section has no list items');
  return acs;
}

function nextId(root, state) {
  let max = 0;
  try { for (const n of fs.readdirSync(path.join(root, DIR))) { const m = /^T-(\d+)\.md$/.exec(n); if (m) max = Math.max(max, Number(m[1])); } } catch { /* none yet */ }
  for (const id of Object.keys(state.tasks || {})) max = Math.max(max, Number(id.slice(2)) || 0);
  return `T-${String(max + 1).padStart(3, '0')}`;
}
function template(root) {
  try {
    const d = path.join(root, '.claude', 'skills');
    for (const s of fs.readdirSync(d)) {
      const f = path.join(d, s, 'templates', 'task-spec.md');
      if (s.endsWith('-dev') && fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes('{{acceptance}}')) return fs.readFileSync(f, 'utf8');
    }
  } catch { /* no project skill yet */ }
  return fs.readFileSync(TEMPLATE, 'utf8');
}
const head = (root) => { const r = git(root, ['rev-parse', '--verify', '-q', 'HEAD']); return r.status === 0 ? r.stdout.trim() : null; };

// ---- Context: the ADRs and lessons covering the task's paths (declared, from the OMC plan, or touched so far) ----
const splitPaths = (v) => [].concat(v ?? []).flatMap((x) => String(x).split(/[,\s]+/)).map((x) => x.trim().replace(/^\.\//, '')).filter(Boolean);
// Repo paths an OMC plan or PRD names (quoted or in backticks, with a folder), e.g. `src/billing/charge.ts`.
const omcPaths = (root, file) => {
  try { return [...new Set([...fs.readFileSync(path.resolve(root, file), 'utf8').matchAll(/[`'"]((?:[\w.-]+\/)+[\w.*-]+)[`'"]/g)].map((m) => m[1]).filter((p) => !/^(?:https?:|\.omc\/)/.test(p)))].slice(0, 30); }
  catch { return []; }
};
async function contextFor(root, paths) {
  const hits = paths.length ? relevant((await loadIndex(root, ['knowledge'])).knowledge, paths) : [];
  const items = [...hits.filter((h) => h.kind === 'adr').slice(0, 5), ...hits.filter((h) => h.kind === 'lesson').slice(0, 5)];
  return items.length ? items.map((i) => `${i.id} (${i.title})`).join(', ') : paths.length ? 'none for these paths' : 'none yet (declare --paths, or run fk task context after the first edits)';
}
const withContext = (text, line) => (CONTEXT_LINE.test(text) ? text.replace(CONTEXT_LINE, () => `Context: ${line}`) : text.replace(/^(# .*)$/m, (h) => `${h}\nContext: ${line}`));

async function newTask(root, title, flags) {
  if (!title) return fail(USAGE);
  const risk = String(flags.risk || 'R1').toUpperCase();
  if (!CLASSES.includes(risk)) return fail(`fk task: risk must be one of ${CLASSES.join(', ')}.`);
  let acs = ['<one checkable statement>'];
  let omc = '';
  const paths = splitPaths(flags.paths);
  if (flags['from-omc']) {
    try { acs = importOmc(root, flags['from-omc']); omc = String(flags['from-omc']).split(path.sep).join('/'); }
    catch (e) { return fail(`fk task: could not import acceptance criteria from ${flags['from-omc']}: ${e.message}. Nothing created.`); }
    if (!paths.length) paths.push(...omcPaths(root, flags['from-omc']));
  }
  const state = readTasks(root);
  const id = nextId(root, state);
  const context = await contextFor(root, paths);
  const fill = { id, title: title.replace(/[\r\n]+/g, ' '), risk, date: today(flags), omc, paths: paths.join(', '), context,
    acceptance: acs.map((a, i) => `  - AC-${i + 1}: ${String(a).replace(/[\r\n]+/g, ' ')}`).join('\n') };
  let text = template(root).replace(/\{\{(\w+)\}\}/g, (m, k) => (k in fill ? fill[k] : m)).replace(/^omc: *\r?\n/m, '').replace(/^paths: *\r?\n/m, '');
  if (paths.length && !/^paths:/m.test(text)) text = text.replace(/^acceptance:/m, () => `paths: ${fill.paths}\nacceptance:`); // a project template without the slot
  text = withContext(text, context);
  fs.mkdirSync(path.join(root, DIR), { recursive: true });
  fs.writeFileSync(path.join(root, rel(id)), text);
  state.tasks = { ...(state.tasks || {}), [id]: { start: new Date().toISOString(), base: head(root), reopened: 0 } };
  writeTasks(root, state);
  setNow(root, { 'Open task': `${id} ${fill.title}` });
  say(`fk task: created ${rel(id)} (declared ${risk}${flags.risk ? '' : ', the default; raise it if unsure'}, ${acs.length} acceptance criteria${omc ? ` from ${omc}` : ''}).`);
  say(`Context: ${context}`);
  if (!omc) {
    say('Write each AC-n as one checkable statement in the front matter.');
    const c = omcCandidates(root);
    if (c.length) say(`OMC already has acceptance criteria in: ${c.slice(0, 3).join(', ')}. To import them instead: delete ${rel(id)} and run fk task new "<title>" --from-omc <path>.`);
  }
  say(`Close it with: fk task done ${id}`);
}

// fk task context <id>: recompute Context from the declared paths plus the files touched so far.
async function refresh(root, id) {
  const file = path.join(root, rel(id));
  const t = readTasks(root).tasks?.[id];
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return fail(`fk task: ${rel(id)} not found.`); }
  const touched = t?.start ? readAuthorship(root).filter((e) => Date.parse(e.ts) >= Date.parse(t.start) && !e.path.startsWith(`${DIR}/`)).map((e) => e.path) : [];
  const changed = t && !t.done ? assess(root, { base: t.base }).files.filter((f) => !f.startsWith(`${DIR}/`)) : t?.files || [];
  const paths = [...new Set([...splitPaths(parseTask(text)?.paths), ...touched, ...changed])];
  const context = await contextFor(root, paths);
  fs.writeFileSync(file, withContext(text, context));
  say(`fk task: ${id} Context: ${context}`);
}

// ---- reviews and authorship ----
export function reviews(root, id, task) {
  const log = readAuthorship(root);
  const from = Date.parse(task.start || 0);
  // Code an agent wrote for this task up to a moment (a reviewer's later fixes do not void its earlier review).
  const wroteCode = (agent, until) => log.some((e) => e.agent_id === agent && !e.path.startsWith(`${DIR}/`) && Date.parse(e.ts) >= from && Date.parse(e.ts) <= until);
  const allowed = new Set(reviewerAgents(root));
  let names = [];
  try { names = fs.readdirSync(path.join(root, DIR)); } catch { /* none */ }
  return names.map((n) => REVIEW.exec(n)).filter((m) => m && m[1] === id).map((m) => {
    const file = `${DIR}/${m[0]}`;
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const acs = {}, adrs = {};
    for (const l of text.split(/\r?\n/)) {
      const a = AC_LINE.exec(l);
      if (a) acs[a[1].toUpperCase()] = { pass: a[2].toUpperCase() === 'PASS', evidence: a[3].trim() };
      const d = ADR_LINE.exec(l);
      if (d) adrs[d[1].toUpperCase()] = { ok: d[2].toUpperCase() === 'OK', note: d[3].trim() };
    }
    const verdict = (/^\s*Verdict:\s*(ACCEPT|REVISE)\b/im.exec(text)?.[1] || '').toUpperCase() || null;
    const round = Number(/^\s*Round:\s*(\d+)/im.exec(text)?.[1] || 1);
    const writers = log.filter((e) => e.path === file);
    const last = writers.at(-1);
    let invalid = null;
    if (!writers.length) invalid = 'no logged writer (written outside an agent session, or before the task started)';
    else {
      const bad = writers.find((w) => !allowed.has(agentName(w.agent_type)));
      const impl = writers.find((w) => w.agent_id && wroteCode(w.agent_id, Date.parse(w.ts)));
      if (bad) invalid = `written by ${agentName(bad.agent_type) || 'the main session'}, not a reviewer agent`;
      else if (impl) invalid = `written by ${agentName(impl.agent_type)} ${impl.agent_id}, which also wrote code for this task before the review`;
    }
    return { file, n: Number(m[2]), round, acs, adrs, verdict, reviewer: agentName(last?.agent_type), invalid };
  }).sort((a, b) => a.round - b.round || a.n - b.n);
}

function lastChange(root, task) {
  const from = Date.parse(task.start);
  const ts = readAuthorship(root).filter((e) => !e.path.startsWith(`${DIR}/`) && Date.parse(e.ts) >= from).map((e) => Date.parse(e.ts));
  return Math.max(from, ...ts);
}

function gates(root, task, run) {
  const c = loadConfig(root);
  const cmds = Object.entries({ check: c.check, fast_gates: c.fast_gates }).filter(([, v]) => v);
  if (!cmds.length) return { ok: true, note: 'no gates configured (fk config set check "<cmd>"), so none were run' };
  const since = lastChange(root, task);
  const green = readGateRuns(root).filter((g) => Date.parse(g.ts) >= since).at(-1);
  if (green?.ok) return { ok: true, note: `gates green at ${green.ts.slice(0, 16).replace('T', ' ')}` };
  if (!run) return { ok: false, why: 'no green gate run since the last change' };
  const failed = [];
  for (const [name, cmd] of cmds) { say(`fk task: running ${name}: ${cmd}`); if (measure(root, name, cmd).exit !== 0) failed.push(name); }
  logGateRun(root, { source: 'task', ok: !failed.length, gates: cmds.map(([n]) => n) });
  return failed.length ? { ok: false, why: `gates failed: ${failed.join(', ')}` } : { ok: true, note: 'gates green' };
}

// { pass, missing[], notes[], declared, proposed, effective, invalid[] }
export function evaluate(root, id, { runGates = false } = {}) {
  const task = readTasks(root).tasks?.[id];
  const rec = readTask(root, id);
  const missing = [], notes = [];
  if (!rec) return { pass: false, missing: [`${rel(id)} not found or has no front matter`], notes, invalid: [] };
  if (!task?.start) return { pass: false, missing: [`${id} has no start record in the kit state (create tasks with fk task new)`], notes, invalid: [] };
  const declared = CLASSES.includes(String(rec.risk).toUpperCase()) ? String(rec.risk).toUpperCase() : 'R1';
  const proposed = assess(root, { base: task.base }).class;
  const effective = maxClass(declared, proposed);
  if (CLASSES.indexOf(proposed) > CLASSES.indexOf(declared)) notes.push(`declared ${declared}, but the change looks like ${proposed} (fk risk); ${proposed} applies`);
  const all = reviews(root, id, task);
  const invalid = all.filter((r) => r.invalid).map((r) => `${r.file}: ${r.invalid}`);
  const valid = all.filter((r) => !r.invalid);
  const g = gates(root, task, runGates);
  if (g.ok) notes.push(g.note); else missing.push(g.why);
  if (effective === 'R0') return { pass: !missing.length, missing, notes, declared, proposed, effective, invalid };
  // R1: one independent ACCEPT; per-criterion lines are optional, but a FAIL still counts. R2 and up: every AC PASS with evidence.
  const perAc = effective !== 'R1';
  const acs = rec.acceptance.filter((a) => !placeholder(a));
  if (perAc && !acs.length) missing.push(`no acceptance criteria in ${rel(id)} (AC-n lines in the front matter)`);
  for (const ac of acs) {
    const said = valid.filter((r) => r.acs[ac.id]).at(-1);
    if (!said) { if (perAc) missing.push(`${ac.id}: no verdict from an independent reviewer`); }
    else if (!said.acs[ac.id].pass) missing.push(`${ac.id}: FAIL in ${said.file} (${said.acs[ac.id].evidence || 'no evidence given'})`);
    else if (perAc && !said.acs[ac.id].evidence) missing.push(`${ac.id}: PASS in ${said.file} without evidence`);
  }
  // R2 and up: the latest accepted review answers each ADR the task's Context cites; a VIOLATION fails.
  const accepted = valid.filter((r) => r.verdict === 'ACCEPT').at(-1);
  if (perAc && accepted) {
    for (const a of rec.context.filter((x) => x.startsWith('ADR-'))) {
      const line = accepted.adrs[a];
      if (!line) missing.push(`${a}: no "${a}: OK|VIOLATION — <note>" line in ${accepted.file} (the task's Context cites it)`);
      else if (!line.ok) missing.push(`${a}: VIOLATION in ${accepted.file} (${line.note || 'no note'})`);
    }
  }
  const need = effective === 'R1' ? [] : ['code-reviewer', 'security-reviewer', ...(effective === 'R3' ? ['critic'] : [])];
  if (!valid.length) missing.push('no review by an independent reviewer agent');
  else if (valid.at(-1).verdict !== 'ACCEPT') missing.push(`latest review ${valid.at(-1).file} says ${valid.at(-1).verdict || 'no Verdict line'}, not ACCEPT`);
  for (const who of need) {
    const r = valid.filter((x) => x.reviewer === who).at(-1);
    if (!r) missing.push(`${effective} needs a ${who} review`);
    else if (r.verdict !== 'ACCEPT') missing.push(`latest ${who} review (${r.file}) is not ACCEPT`);
  }
  if (effective === 'R3' && new Set(valid.map((r) => r.round)).size < 2) missing.push('R3 needs two review rounds (Round: 1 and Round: 2 in the review files)');
  return { pass: !missing.length, missing, notes, declared, proposed, effective, invalid };
}

function report(id, r) {
  say(`fk task check ${id}: ${r.pass ? 'PASS' : 'FAIL'}${r.effective ? ` (risk ${r.effective}: declared ${r.declared}, proposed ${r.proposed})` : ''}`);
  for (const n of r.notes) say(`- note: ${n}`);
  for (const i of r.invalid) say(`- not counted: ${i}`);
  for (const m of r.missing) say(`- missing: ${m}`);
}

// A founder-typed `fk-override task-check <reason>`, unexpired, not used for another task (a T-id in the reason must match).
function override(root, id, state) {
  const used = new Set(Object.values(state.tasks || {}).map((t) => t.override?.ts).filter(Boolean));
  const typed = readLog(root).filter((r) => r.event === 'UserPromptSubmit' && r.decision === 'override-set' && r.guard === 'task-check');
  return readOverrides(root).find((o) => o.guard === 'task-check' && Date.parse(o.expires) > Date.now() && !used.has(o.ts)
    && typed.some((r) => r.expires === o.expires) && (!/\bT-\d{3,}\b/.test(o.reason) || new RegExp(`\\b${id}\\b`).test(o.reason))) || null;
}

function done(root, id) {
  const state = readTasks(root);
  const task = state.tasks?.[id];
  if (task?.done) return say(`fk task: ${id} is already closed (${task.done.slice(0, 10)}). Reopen with fk task reopen ${id}.`);
  const r = evaluate(root, id, { runGates: true });
  report(id, r);
  const close = (extra) => {
    const files = assess(root, { base: task.base }).files;
    const rec = readTask(root, id);
    state.tasks[id] = { ...task, done: new Date().toISOString(), end: head(root), files, cites: rec?.context || [], last_check: { pass: r.pass, declared: r.declared, proposed: r.proposed, effective: r.effective, invalid: r.invalid, missing: r.missing }, ...extra };
    writeTasks(root, state);
    const next = Object.entries(state.tasks).filter(([, t]) => t.start && !t.done).sort((a, b) => Date.parse(b[1].start) - Date.parse(a[1].start))[0];
    setNow(root, { 'Open task': next ? `${next[0]} ${readTask(root, next[0])?.title || ''}`.trim() : 'none', 'Last finished': `${id} ${rec?.title || ''} (${today()})` });
  };
  if (r.pass) { close({}); return say(`fk task: ${id} closed.`); }
  const o = task && override(root, id, state);
  if (o) { close({ override: { ts: o.ts, reason: o.reason } }); return say(`fk task: ${id} closed on the founder's override (${o.reason}). fk audit lists it.`); }
  say(`fk task: ${id} stays open. ${OVERRIDE_HINT}`);
  process.exitCode = 1;
}

function reopen(root, id) {
  const state = readTasks(root);
  const t = state.tasks?.[id];
  if (!t?.done) return fail(`fk task: ${id} is not closed.`);
  state.tasks[id] = { ...t, done: null, reopened: (t.reopened || 0) + 1, reopened_at: new Date().toISOString() };
  writeTasks(root, state);
  say(`fk task: ${id} reopened.`);
}

function list(root) {
  const tasks = readTasks(root).tasks || {};
  if (!Object.keys(tasks).length) return say('fk task: no tasks yet. Start one with fk task new "<title>".');
  for (const [id, t] of Object.entries(tasks)) say(`${id}  ${t.done ? `closed ${t.done.slice(0, 10)}${t.override ? ' (override)' : ''}` : `open since ${t.start.slice(0, 10)}`}  ${readTask(root, id)?.title || '(no record)'}`);
}

function fail(msg) { say(msg); process.exitCode = 1; }

export default async function task(args) {
  const { pos, flags } = parseArgs(args);
  const root = needRoot();
  const [sub, arg] = pos;
  if (sub === 'new') return newTask(root, pos.slice(1).join(' ').trim(), flags);
  if (sub === 'list') return list(root);
  if (!['check', 'done', 'reopen', 'context'].includes(sub) || !ID.test(arg || '')) return fail(USAGE);
  if (sub === 'context') return refresh(root, arg);
  if (sub === 'check') { const r = evaluate(root, arg, { runGates: true }); report(arg, r); if (!r.pass) process.exitCode = 1; return; }
  return sub === 'done' ? done(root, arg) : reopen(root, arg);
}
