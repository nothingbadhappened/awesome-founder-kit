// fk lessons add | bump | list | promote-candidates | archive | budget   (§8 learning loop)
// docs/process/lessons.md is the source of truth (format: skills/fk-process/templates/lessons.md).
// Each header may carry an optional trailing [last: YYYY-MM-DD], set when the lesson is seen again.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { say, needRoot, parseArgs, today } from './adopt/util.mjs';

export const FILE = 'docs/process/lessons.md';
const ARCHIVE = 'docs/process/lessons-archive.md';
const TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', 'fk-process', 'templates', 'lessons.md');
export const HEAD = /^## (\S+) [—-] (.+?)\s+\[seen: (\d+)\]\s*\[severity: (\w+)\]\s*\[paths: ([^\]]*)\]\s*\[status: ([^\]]*)\](?:\s*\[last: (\d{4}-\d{2}-\d{2})\])?\s*$/;
const CLAUDE_MD_BUDGET = 40;
const STALE_DAYS = 90;
const USAGE = `usage: fk lessons add --title "<t>" --what "<symptom and cause>" --lesson "<fix>" [--severity low|med|high] [--paths <globs>] [--context <link>] [--evidence <link>] [--new]
       fk lessons bump <n|title words> [--evidence <link>] [--severity high]
       fk lessons list | promote-candidates [--json] | archive | budget`;

export const isCandidate = (h) => /^open/i.test(h.status.trim()) && (h.seen >= 2 || h.severity === 'high');

export function parseHead(line) {
  const m = HEAD.exec(line);
  return m && { date: m[1], title: m[2], seen: Number(m[3]), severity: m[4].toLowerCase(), paths: m[5].trim(), status: m[6].trim(), last: m[7] || null };
}
const headLine = (h) => `## ${h.date} — ${h.title}  [seen: ${h.seen}] [severity: ${h.severity}] [paths: ${h.paths}] [status: ${h.status}]${h.last ? ` [last: ${h.last}]` : ''}`;

// { pre: text before the first entry, entries: [{ head, body: [lines] }] }; unparseable "## " blocks stay as text.
export function parse(text) {
  const lines = text.split(/\r?\n/);
  const pre = [], entries = [];
  let cur = null;
  for (const l of lines) {
    const h = l.startsWith('## ') ? parseHead(l) : null;
    if (h) { cur = { head: h, body: [] }; entries.push(cur); }
    else if (cur) cur.body.push(l);
    else pre.push(l);
  }
  for (const e of entries) while (e.body.length && !e.body[e.body.length - 1].trim()) e.body.pop();
  return { pre: pre.join('\n').replace(/\s+$/, ''), entries };
}
const render = ({ pre, entries }) => [pre, ...entries.map((e) => [headLine(e.head), ...e.body].join('\n'))].filter(Boolean).join('\n\n') + '\n';

function load(root) {
  const f = path.join(root, FILE);
  if (fs.existsSync(f)) return parse(fs.readFileSync(f, 'utf8'));
  let pre = '# Lessons';
  try { pre = fs.readFileSync(TEMPLATE, 'utf8').split(/\nStarter lessons/)[0].trim(); } catch { /* template missing: minimal header */ }
  return { pre, entries: [] };
}
function save(root, doc, rel = FILE) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), render(doc));
}

// Fuzzy root-cause match: token sets (lower case, stop words out, crude stemming), Jaccard similarity.
const STOP = new Set('the a an and or of to in on for with is are was were be been it its this that from by at as not no do does did when then than into can cannot never always our your their but though although yet also too'.split(' '));
const stem = (w) => (w.length < 4 ? w : w.replace(/(x|s|sh|ch)es$/, '$1').replace(/s$/, '').replace(/(ing|ed)$/, '')) || w;
const tokens = (s) => new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)).map(stem));
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n); };
const field = (e, name) => (e.body.find((l) => l.startsWith(`- ${name}:`)) || '').slice(name.length + 3);

export function findDuplicate(entries, title, cause) {
  let best = null;
  for (const e of entries) {
    const score = Math.max(jaccard(tokens(title), tokens(e.head.title)),
      jaccard(tokens(`${title} ${cause}`), tokens(`${e.head.title} ${field(e, 'What happened')} ${field(e, 'Lesson')}`)) * 1.15);
    if (!best || score > best.score) best = { e, score };
  }
  return best && best.score >= 0.5 ? best.e : null;
}

const SEV = ['low', 'med', 'high'];
function bumpEntry(e, flags) {
  e.head.seen += 1;
  e.head.last = today(flags);
  if (flags.severity && SEV.indexOf(flags.severity) > SEV.indexOf(e.head.severity)) e.head.severity = flags.severity;
  if (flags.evidence) e.body.push(`- Evidence: ${flags.evidence}`);
  say(`fk lessons: seen again -> bumped "${e.head.title}" to seen: ${e.head.seen}${isCandidate(e.head) ? ' (now a promotion candidate)' : ''}.`);
}

function add(root, flags) {
  const title = String(flags.title || '').trim();
  if (!title || !flags.lesson) { say(USAGE); process.exitCode = 1; return; }
  const sev = SEV.includes(flags.severity) ? flags.severity : 'med';
  const doc = load(root);
  const dup = flags.new ? null : findDuplicate(doc.entries, title, `${flags.what || ''} ${flags.lesson}`);
  if (dup) bumpEntry(dup, { ...flags, severity: sev });
  else {
    doc.entries.push({ head: { date: today(flags), title, seen: 1, severity: sev, paths: flags.paths || '**', status: 'open', last: null },
      body: [`- Context: ${flags.context || '-'}`, `- What happened: ${flags.what || '-'}`, `- Lesson: ${flags.lesson}`, `- Evidence: ${flags.evidence || '-'}`] });
    say(`fk lessons: added "${title}" (seen: 1, severity: ${sev}).`);
  }
  save(root, doc);
}

function pick(entries, key) {
  const n = Number(key);
  if (Number.isInteger(n) && n >= 1 && n <= entries.length) return entries[n - 1];
  const q = tokens(key);
  const hits = entries.filter((e) => { const t = tokens(e.head.title); return q.size && [...q].every((w) => t.has(w)); });
  return hits.length === 1 ? hits[0] : null; // none or ambiguous
}

function bump(root, pos, flags) {
  const doc = load(root);
  const e = pos[1] && pick(doc.entries, pos.slice(1).join(' '));
  if (!e) { say('fk lessons bump: no matching lesson (use the number from fk lessons list, or title words).'); process.exitCode = 1; return; }
  bumpEntry(e, flags);
  save(root, doc);
}

const row = (e, i) => `${String(i + 1).padStart(3)}. [seen ${e.head.seen}] [${e.head.severity}] [${e.head.status}] ${e.head.title}  (paths: ${e.head.paths})`;

function candidates(root, flags) {
  const doc = load(root);
  const c = doc.entries.map((e, i) => [e, i]).filter(([e]) => isCandidate(e.head));
  if (flags.json) return say(JSON.stringify(c.map(([e, i]) => ({ n: i + 1, ...e.head, lesson: field(e, 'Lesson') }))));
  if (!c.length) return say('fk lessons: no promotion candidates (needs status open and seen >= 2 or severity high).');
  say(`fk lessons: ${c.length} candidate(s). Promote each in a separate reviewed task (OMC critic), strongest form first: gate or hook > lint rule > skill step > CLAUDE.md line.`);
  for (const [e, i] of c) say(row(e, i));
}

function archive(root, flags) {
  const doc = load(root);
  const now = Date.parse(today(flags));
  const old = [], keep = [];
  for (const e of doc.entries) {
    const d = Date.parse(e.head.last || e.head.date);
    (Number.isFinite(d) && now - d > STALE_DAYS * 864e5 ? old : keep).push(e);
  }
  if (!old.length) return say('fk lessons: nothing unseen for 90 days.');
  const arcFile = path.join(root, ARCHIVE);
  const arc = fs.existsSync(arcFile) ? parse(fs.readFileSync(arcFile, 'utf8'))
    : { pre: '# Lessons archive\n\nLessons unseen for 90 days, moved here by `fk lessons archive`. If one happens again, move it back and bump it.', entries: [] };
  arc.entries.push(...old);
  save(root, arc, ARCHIVE);
  save(root, { ...doc, entries: keep });
  say(`fk lessons: archived ${old.length} lesson(s) to ${ARCHIVE}: ${old.map((e) => e.head.title).join('; ')}`);
}

// CLAUDE.md rule budget: count the project's own lines (OMC's marked block is OMC's).
export function claudeMdLines(root) {
  let text;
  try { text = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'); } catch { return 0; }
  return text.replace(/<!--\s*OMC:START\s*-->[\s\S]*?<!--\s*OMC:END\s*-->/g, '').split(/\r?\n/).filter((l) => l.trim()).length;
}
function budget(root, flags) {
  const n = claudeMdLines(root);
  if (n <= CLAUDE_MD_BUDGET) return say(`fk lessons budget: CLAUDE.md ${n}/${CLAUDE_MD_BUDGET} lines.`);
  say(`fk lessons budget: WARNING CLAUDE.md has ${n} lines, over the ${CLAUDE_MD_BUDGET}-line budget. Merge or evict rules (prefer moving a rule into a gate, lint rule or skill step).`);
  if (flags.strict) process.exitCode = 1;
}

export default async function lessons(args) {
  const { pos, flags } = parseArgs(args);
  const root = needRoot();
  const sub = {
    add: () => add(root, flags), bump: () => bump(root, pos, flags),
    list: () => { const d = load(root); if (!d.entries.length) say('fk lessons: none yet.'); d.entries.forEach((e, i) => say(row(e, i))); },
    'promote-candidates': () => candidates(root, flags), archive: () => archive(root, flags), budget: () => budget(root, flags),
  }[pos[0]];
  if (sub) return sub();
  say(USAGE); process.exitCode = 1;
}
