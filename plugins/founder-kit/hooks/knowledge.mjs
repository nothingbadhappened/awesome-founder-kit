// Connected knowledge: a cached index of ADRs, lessons, tasks and standards (<kit state dir>/index.json, never committed),
// and the short lines the hooks inject from it (read-first note, subagent orientation, first-edit area note).
// Hot path: stat the sources, read one JSON file; a rebuild happens only when a source mtime moved. No git, no network.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, readJson, writeJson, stateFile, globToRegex, quietPath } from './lib.mjs';

export const BIBLE = 'docs/PROJECT.md';
export const LESSONS = 'docs/process/lessons.md';
const TASKS = 'docs/tasks';
const TASK_FILE = /^T-\d{3,}\.md$/;
const V = 3;

const mtime = (abs) => { try { return fs.statSync(abs).mtimeMs; } catch { return 0; } };
const ls = (abs) => { try { return fs.readdirSync(abs); } catch { return []; } };
const read = (abs) => { try { return fs.readFileSync(abs, 'utf8'); } catch { return null; } };
const short = (s, n = 40) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// ---- a small YAML front-matter subset: key: scalar | [a, b] | {a: x} | a list of scalars or one-key maps ----
function flow(v) {
  v = String(v ?? '').trim();
  if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(',').map((x) => flow(x)).filter((x) => x !== '');
  if (/^\{.*\}$/.test(v)) {
    const o = {};
    for (const part of v.slice(1, -1).split(',')) { const m = /^\s*([\w-]+)\s*:\s*(.*)$/.exec(part); if (m) o[m[1]] = flow(m[2]); }
    return o;
  }
  return v.replace(/^(["'])(.*)\1$/, '$2');
}
export function frontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text || '');
  const out = {};
  if (!m) return out;
  let key = null, item = null;
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').replace(/^#.*$/, '');
    if (!line.trim()) continue;
    const top = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (top) { key = top[1]; item = null; out[key] = top[2].trim() === '' ? [] : flow(top[2]); continue; }
    const li = /^\s*-\s*(.*)$/.exec(line);
    if (li && key) {
      if (!Array.isArray(out[key])) out[key] = [].concat(out[key] ?? []);
      const kv = /^([\w-]+):\s*(.*)$/.exec(li[1].trim());
      item = kv ? { [kv[1]]: kv[2].trim() ? flow(kv[2]) : {} } : null;
      out[key].push(item || flow(li[1]));
      continue;
    }
    const sub = /^\s+([\w-]+):\s*(.*)$/.exec(line);
    if (sub && item) { const k = Object.keys(item)[0]; if (item[k] && typeof item[k] === 'object') item[k][sub[1]] = flow(sub[2]); }
  }
  return out;
}
const globs = (v) => [].concat(v ?? []).flatMap((g) => String(g).split(',')).map((g) => g.trim()).filter((g) => g && !/[<>{}]/.test(g));

// ---- ADRs ----
const adrId = (n) => `ADR-${String(Number(n)).padStart(4, '0')}`;
const ids = (s) => [...String(s || '').matchAll(/(?:ADR-?)?(\d{1,4})/gi)].map((m) => adrId(m[1]));
export function parseAdr(text, file) {
  const num = /(\d{3,4})/.exec(path.basename(file))?.[1];
  if (!num) return null;
  const fm = frontMatter(text);
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const title = (/^#\s+(.+)$/m.exec(body)?.[1] || path.basename(file, '.md')).replace(/^(?:ADR[-\s]?)?\d{1,4}\s*[—:.–-]\s*/i, '').trim();
  const rawStatus = String(fm.status || /\bStatus\**\s*:\s*\**\s*([^\n·|]+(?:\|[^\n·]+)?)/i.exec(body)?.[1] || '').trim();
  const supersededBy = /superseded\s+by\s+((?:ADR-?)?\d{1,4})/i.exec(rawStatus)?.[1];
  let status = 'proposed';
  if (/\|/.test(rawStatus)) status = 'proposed'; // the template line, not filled in yet
  else if (supersededBy || /supersed/i.test(rawStatus)) status = 'superseded';
  else if (/accepted|auto-decided/i.test(rawStatus)) status = 'accepted';
  else if (/reconstructed/i.test(rawStatus)) status = 'reconstructed';
  else if (/rejected|deprecated/i.test(rawStatus)) status = 'rejected';
  const sup = fm.supersedes ? [].concat(fm.supersedes).flatMap(ids) : ids(/\bsupersedes\s*:?\s*((?:(?:ADR-?)?\d{1,4}[\s,]*(?:and\s+)?)+)/i.exec(body)?.[1]);
  const fit = [].concat(fm.fit ?? []).filter((r) => r && typeof r === 'object' && !Array.isArray(r));
  const rawDate = String(fm.date || /\bDate:\s*(\d{4}-\d{2}-\d{2})/.exec(body)?.[1] || '').slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && !Number.isNaN(Date.parse(rawDate)) ? rawDate : null; // a placeholder is no date
  const bible = globs(fm.bible).map((x) => x.toLowerCase()).filter((x) => BIBLE_KEYS.includes(x));
  return { id: adrId(num), file, title, status, date, supersedes: sup, superseded_by: supersededBy ? ids(supersededBy)[0] : null,
    applies_to: globs(fm.applies_to), fit, bible };
}
export const activeAdr = (a) => a.status === 'accepted' || a.status === 'reconstructed';

// ---- bible sections: "## Mission <!-- fk:updated YYYY-MM-DD -->"; an ADR with bible: [...] newer than the marker makes it stale ----
export const BIBLE_KEYS = ['mission', 'users', 'non-negotiables', 'principles', 'architecture'];
export const MARK = /<!--\s*fk:updated\s+(\d{4}-\d{2}-\d{2})\s*-->/;
export const bibleSections = (text) => String(text || '').split(/\r?\n/).map((l, i) => [l, i]).filter(([l]) => /^##\s/.test(l)).map(([l, i]) => {
  const title = l.replace(/^##\s+/, '').replace(/<!--.*?-->/g, '').trim();
  return { line: i, title: title.replace(/\s*\(.*\)$/, ''), key: title.toLowerCase().split(/[\s(]/)[0], updated: MARK.exec(l)?.[1] || null };
});
// [{ key, section, since, adrs }]: a section with no marker counts as never updated. An ADR without a date is skipped
// (a file's mtime moves on checkout, so it would cry wolf); fk bible check names it instead.
function staleSections(adrs, text) {
  if (!text) return [];
  const secs = bibleSections(text), out = {};
  for (const a of adrs.filter(activeAdr)) {
    const keys = new Set([...a.bible, ...a.supersedes.flatMap((s) => adrs.find((x) => x.id === s)?.bible || [])]);
    const date = a.date;
    if (!date) continue;
    for (const k of keys) {
      const sec = secs.find((x) => x.key === k);
      if (!sec || (sec.updated && sec.updated >= date)) continue;
      const o = (out[k] ||= { key: k, section: sec.title, since: date, adrs: [] });
      o.adrs.push(a.id);
      if (date < o.since) o.since = date;
    }
  }
  return Object.values(out);
}

// ---- the index ----
function knowledgeSources(root) {
  const c = loadConfig(root).paths;
  const adrDir = path.join(root, c.adr);
  const adrFiles = ls(adrDir).filter((n) => n.endsWith('.md')).sort();
  const stamp = [`adr:${mtime(adrDir)}`, ...adrFiles.map((n) => `${n}:${mtime(path.join(adrDir, n))}`),
    `lessons:${mtime(path.join(root, LESSONS))}`, `standards:${mtime(path.join(root, c.standards))}`, `bible:${mtime(path.join(root, BIBLE))}`, `cfg:${c.adr}|${c.standards}`].join('|');
  return { stamp, adrDir, adrFiles, c };
}
function taskSources(root) {
  const dir = path.join(root, TASKS);
  const files = ls(dir).filter((n) => TASK_FILE.test(n)).sort();
  const stamp = [`dir:${mtime(dir)}`, ...files.map((n) => `${n}:${mtime(path.join(dir, n))}`),
    `state:${mtime(stateFile(root, 'tasks.json'))}`, `authors:${mtime(stateFile(root, 'authorship.jsonl'))}`].join('|');
  return { stamp, dir, files };
}

async function buildKnowledge(root, src) {
  const { parseHead } = await import('../bin/cmd/lessons.mjs');
  const adrs = [];
  for (const n of src.adrFiles) {
    const abs = path.join(src.adrDir, n);
    const a = parseAdr(read(abs) || '', `${src.c.adr}/${n}`);
    if (a) adrs.push({ ...a, mtime: mtime(abs) });
  }
  for (const a of adrs.filter(activeAdr)) for (const s of a.supersedes) { const old = adrs.find((x) => x.id === s); if (old && old.status !== 'superseded') { old.status = 'superseded'; old.superseded_by ||= a.id; } }
  const lessons = (read(path.join(root, LESSONS)) || '').split(/\r?\n/).filter((l) => l.startsWith('## ')).map(parseHead).filter(Boolean)
    .map((h, i) => ({ id: `L-${i + 1}`, title: h.title, seen: h.seen, severity: h.severity, status: h.status, date: h.date, last: h.last, paths: globs(h.paths) }));
  const standards = [];
  const walk = (rel, depth) => { for (const n of ls(path.join(root, rel))) { const r = `${rel}/${n}`; if (fs.statSync(path.join(root, r)).isDirectory()) { if (depth < 2) walk(r, depth + 1); } else standards.push(r); } };
  try { walk(src.c.standards, 0); } catch { /* none */ }
  return { stamp: src.stamp, adrs, lessons, standards, bible_stale: staleSections(adrs, read(path.join(root, BIBLE))) };
}

export const CONTEXT_LINE = /^Context:[ \t]*(.*)$/m;
export const contextIds = (text) => [...new Set([...String(CONTEXT_LINE.exec(text || '')?.[1] || '').matchAll(/\b(ADR-\d{4}|L-\d+)\b/g)].map((m) => m[1]))];

async function buildTasks(root, src) {
  const state = readJson(stateFile(root, 'tasks.json'), { tasks: {} }).tasks || {};
  const { readLines } = await import('./authorship.mjs');
  const authored = readLines(stateFile(root, 'authorship.jsonl'));
  const ids = new Set([...src.files.map((n) => n.slice(0, -3)), ...Object.keys(state)]);
  const items = [...ids].sort().map((id) => {
    const text = read(path.join(src.dir, `${id}.md`)) || '';
    const fm = frontMatter(text);
    const t = state[id] || {};
    const files = t.files || [...new Set(authored.filter((e) => t.start && Date.parse(e.ts) >= Date.parse(t.start) && !e.path.startsWith(`${TASKS}/`)).map((e) => e.path))];
    return { id, title: String(fm.title || ''), start: t.start || null, done: t.done || null, files, paths: globs(fm.paths), cites: t.cites || contextIds(text) };
  });
  const backlinks = {};
  for (const t of items.filter((x) => x.done)) for (const c of t.cites) (backlinks[c] ||= []).push(t.id);
  return { stamp: src.stamp, items, backlinks };
}

// parts: 'knowledge' (ADRs, lessons, standards: the hot path) and/or 'tasks'. Rebuilds only a stale part.
export async function loadIndex(root, parts = ['knowledge', 'tasks']) {
  const file = stateFile(root, 'index.json');
  let idx = readJson(file, null);
  if (idx?.v !== V) idx = { v: V };
  let dirty = false;
  if (parts.includes('knowledge')) {
    const src = knowledgeSources(root);
    if (idx.knowledge?.stamp !== src.stamp) { idx.knowledge = await buildKnowledge(root, src); dirty = true; }
  }
  if (parts.includes('tasks')) {
    const src = taskSources(root);
    if (idx.tasks?.stamp !== src.stamp) { idx.tasks = await buildTasks(root, src); dirty = true; }
  }
  if (dirty) { try { writeJson(file, { ...idx, built: new Date().toISOString() }); } catch { /* the cache is only a speed-up */ } }
  return idx;
}

// ---- matching: which ADRs and lessons cover a file ----
const reCache = new Map();
const re = (g) => { if (!reCache.has(g)) reCache.set(g, globToRegex(g)); return reCache.get(g); };
const broad = (g) => /^[*/]*$/.test(g) || g === '**/*.*';
const literal = (g) => g.split(/[*?[{]/)[0];
// A docs or test file counts only for a glob that itself points at docs or tests (tests/**, **/*.test.ts, docs/api/**).
const targetsQuiet = (g) => quietPath(g.replace(/\*+/g, 'x').replace(/\?/g, 'x'));
export function covers(gs, file) {
  const quiet = quietPath(file);
  if (/[*?]/.test(file)) { // a declared glob (task --paths): overlap of the literal prefixes
    const a = literal(file);
    return gs.some((g) => !broad(g) && (!quiet || targetsQuiet(g)) && ((literal(g) && a && (a.startsWith(literal(g)) || literal(g).startsWith(a))) || re(g).test(a)));
  }
  return gs.some((g) => !broad(g) && (!quiet || targetsQuiet(g)) && re(g).test(file));
}
// Active ADRs first (by number), then open lessons. Each: { id, kind, title, globs }.
export function areaItems(k) {
  return [...(k?.adrs || []).filter(activeAdr).filter((a) => a.applies_to.length).map((a) => ({ id: a.id, kind: 'adr', title: a.title, globs: a.applies_to })),
    ...(k?.lessons || []).filter((l) => /^open/i.test(l.status)).map((l) => ({ id: l.id, kind: 'lesson', title: l.title, globs: l.paths.filter((g) => !broad(g)) }))
      .filter((l) => l.globs.length)];
}
// Most specific first (the deepest matching glob literal: src/billing/** before src/**), then by id.
const depth = (it, files) => Math.max(0, ...it.globs.filter((g) => files.some((f) => covers([g], f))).map((g) => literal(g).split('/').filter(Boolean).length));
export const relevant = (k, files) => areaItems(k).filter((it) => files.some((f) => covers(it.globs, f)))
  .map((it) => ({ ...it, depth: depth(it, files) })).sort((a, b) => b.depth - a.depth || a.id.localeCompare(b.id));
const label = (it) => `${it.kind === 'lesson' ? 'lesson ' : ''}${it.id} (${short(it.title)})`;

// PostToolUse: the first edit in an area covered by an ADR or open lesson, once per area per session: at most 2 items
// named, the rest counted, and all of them marked seen.
export async function areaNote(root, session, files) {
  files = files.filter(Boolean);
  if (!files.length) return null;
  const hits = relevant((await loadIndex(root, ['knowledge'])).knowledge, files);
  if (!hits.length) return null;
  const file = stateFile(root, 'areas-seen.json');
  const seen = readJson(file, {});
  const key = session || 'none';
  const mine = new Set(seen[key] || []);
  const fresh = hits.filter((h) => !mine.has(h.id));
  if (!fresh.length) return null;
  const shown = fresh.slice(0, 2), more = fresh.length - shown.length;
  const keep = Object.fromEntries(Object.entries(seen).filter(([k]) => k !== key).slice(-4)); // a few recent sessions only
  writeJson(file, { ...keep, [key]: [...mine, ...fresh.map((h) => h.id)] });
  return `fk: this area has ${shown.map(label).join(', ')}${more ? ` and ${more} more (fk task context)` : ''}.`;
}

// ---- orientation: open task, bible, parent bible ----
export function openTask(root) {
  const tasks = Object.entries(readJson(stateFile(root, 'tasks.json'), { tasks: {} }).tasks || {}).filter(([, t]) => t.start && !t.done);
  if (!tasks.length) return null;
  const [id] = tasks.sort((a, b) => Date.parse(b[1].start) - Date.parse(a[1].start))[0];
  const text = read(path.join(root, TASKS, `${id}.md`)) || '';
  return { id, title: String(frontMatter(text).title || ''), context: contextIds(text) };
}
export function parentBible(root) {
  const p = loadConfig(root).parent;
  if (!p || /^[a-z][\w+.-]*:\/\//i.test(p) || /^git@/.test(p)) return null;
  const abs = path.resolve(root, p, BIBLE);
  return fs.existsSync(abs) ? path.relative(root, abs).split(path.sep).join('/') : null;
}

// SubagentStart: appended to the role pointer (bible + the open task's ADR/lesson ids).
export function orientation(root) {
  const parts = [];
  if (fs.existsSync(path.join(root, BIBLE))) parts.push(`Bible: ${BIBLE}.`);
  const t = openTask(root);
  if (t?.context.length) parts.push(`Task ${t.id} context: ${t.context.slice(0, 5).join(', ')}.`);
  return parts.join(' ');
}

// SessionStart: one read-first line (<= 80 tokens), or null when there is nothing to point at.
const MAX_NOTE = 280; // characters: at most 80 tokens even at 3.5 characters a token
export const STALE_SUFFIX = / Bible §.*? may be stale since ADR-\d{4}\.$/; // dropped when the weekly bible note speaks
export async function readFirst(root, session, now = Date.now()) {
  const file = stateFile(root, 'session.json');
  const s = readJson(file, {});
  const prev = s.id === session ? s.prev : s.ts;
  if (s.id !== session) writeJson(file, { id: session || null, ts: now, prev: prev ?? null });
  const parts = [];
  if (fs.existsSync(path.join(root, BIBLE))) parts.push(`${BIBLE} (bible)`);
  const pb = parentBible(root);
  if (pb) parts.push(`${pb} (parent bible)`);
  const t = openTask(root);
  if (t) parts.push(`open task ${t.id}${t.title ? ` ${short(t.title, 48)}` : ''}`);
  const k = (await loadIndex(root, ['knowledge'])).knowledge;
  const adrs = (k?.adrs || []).filter(activeAdr);
  const recent = prev ? adrs.filter((a) => a.mtime > prev) : [];
  const list = (recent.length ? recent : adrs).sort((a, b) => b.id.localeCompare(a.id)).slice(0, 3).map((a) => a.id);
  if (list.length) parts.push(`${recent.length ? 'ADRs accepted since last session' : 'latest ADRs'}: ${list.join(', ')}`);
  if (!parts.length) return null;
  let text = `fk read-first: ${parts.join(' → ')}.${adrs.length ? ' Don\'t re-propose what an accepted ADR settled.' : ''}`;
  if (text.length > MAX_NOTE) text = `${text.slice(0, MAX_NOTE - 1)}…`;
  const stale = k?.bible_stale?.[0]; // at most ~20 extra tokens, only when stale (STALE_SUFFIX)
  return stale ?`${text} Bible §${short(stale.section, 16)} may be stale since ${stale.adrs[0]}.` : text;
}
