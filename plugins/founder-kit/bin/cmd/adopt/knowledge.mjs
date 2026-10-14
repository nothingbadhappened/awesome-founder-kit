// fk adopt knowledge: consolidate what an adopted project already wrote down (docs, agent rule files, OMC notes, Claude
// auto-memory, MemPalace) into the kit's structure with one source of truth. The CLI does the mechanics; OMC's read-only
// analyst/critic agents judge; the founder decides. Everything here lives in <kit state>/adopt/knowledge/, outside the repo.
//   inventory [--json] [--skip memory,omc,mempalace] [--max-files 300]   sources, kinds, dates per section (git blame)
//   extract [--max-statements 400]                                        sections -> normalized statements (capped)
//   candidates [--max-tokens 150000]                                      related statements -> clusters + agent work files
//   verdict [<cluster>] [--by analyst|critic] [--from <file>]             the sanctioned writer for agent verdicts (stdin otherwise)
//   report                                                                plain health report with latest-wins proposals
//   resolve <cluster> <latest|keep:S-n|both|new|drop|merge> [--note "<wording>"] | resolve --all latest [--minor]
//   compile [--dry-run] [--keep-sources]                                  (compile.mjs) drafts for fk adopt apply
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJson, writeJson, loadConfig, stateDir } from '../../../hooks/lib.mjs';
import { say, git, tool, slug, many, today } from './util.mjs';

export const kdir = (root) => path.join(stateDir(root), 'adopt', 'knowledge');
export const kfile = (root, rel) => path.join(kdir(root), rel);
export const kread = (root, rel, fb = null) => readJson(kfile(root, rel), fb);
export function kwrite(root, rel, v) {
  const f = kfile(root, rel);
  if (typeof v === 'string') { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, v); } else writeJson(f, v);
  return f;
}
const fail = (msg) => { say(msg); process.exitCode = 1; };

const DEFAULTS = { max_files: 300, max_statements: 400, max_tokens: 150000 };
export function settings(root, flags = {}) {
  const k = loadConfig(root).knowledge || {};
  const n = (flag, key) => Number(flags[flag]) || Number(k[key]) || DEFAULTS[key];
  return { max_files: n('max-files', 'max_files'), max_statements: n('max-statements', 'max_statements'), max_tokens: n('max-tokens', 'max_tokens') };
}

// ---- discovery ----
const SKIP = new Set(['node_modules', '.git', '.omc', '.fk', 'dist', 'build', 'out', 'coverage', 'target', 'vendor', 'third_party', '.venv', 'venv',
  '__pycache__', '.next', '.turbo', '.cache', '.godot', 'Library', 'Temp', 'Logs', 'obj', 'Pods', '.gradle', '.idea', '.vscode']);
const DOC = /\.(?:md|mdx|markdown|txt|rst|adoc|mdc)$/i;
export const AGENT = /(?:^|\/)(?:CLAUDE|AGENTS|GEMINI)\.md$|^\.(?:cursorrules|windsurfrules)$|^\.cursor\/rules\/.+\.mdc?$|^\.github\/copilot-instructions\.md$/i;
const NOISE = /(?:^|\/)(?:LICEN[CS]E|NOTICE|THIRD[-_]PARTY[\w-]*|CHANGELOG|CHANGES|HISTORY|CODE_OF_CONDUCT|AUTHORS|CONTRIBUTORS|SECURITY|CLAUDE\.local)(?:\.\w+)?$/i;
// Task records, archives, the journal and the knowledge map itself are history, not knowledge to consolidate.
const HISTORY = /^docs\/(?:tasks|archive)\/|^docs\/process\/(?:knowledge-map|journal|lessons-archive)\.md$/i;
const KNOW_NAME = /(?:^|[/_. -])(?:design|gdd|prd|vision|specs?|specification|roadmap|wiki|adrs?|decisions?|rfcs?|architecture|rules|conventions|guidelines|standards|lessons?|postmortems?|retros?|retrospectives?|plans?|planning|todo|notes|contributing|principles|manifesto|charter|overview|brief|pitch|mission|product)(?:[/_. -]|$)/i;
export function isKnowledge(rel) {
  if (AGENT.test(rel)) return true;
  if (!DOC.test(rel) || NOISE.test(rel) || HISTORY.test(rel)) return false;
  if (/^readme\b/i.test(rel.split('/').pop())) return rel.split('/').length <= 3;
  return /^docs?\//i.test(rel) || KNOW_NAME.test(rel.replace(DOC, '').toLowerCase());
}
function walk(root, dir = '', depth = 0, out = []) {
  let es; try { es = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return out; }
  for (const e of es) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!SKIP.has(e.name) && depth < 8) walk(root, rel, depth + 1, out); } else if (e.isFile()) out.push(rel);
  }
  return out;
}

// The kit's own structure: the accepted side for fk knowledge check.
export function kitPath(root, rel) {
  const c = loadConfig(root).paths;
  return rel === 'docs/PROJECT.md' || rel === c.constraints || rel === 'docs/process/lessons.md' || rel.startsWith(`${c.adr}/`) || rel.startsWith(`${c.standards}/`);
}

// ---- classification: bible | rules | architecture | decisions | lessons | plans | memory | other ----
export const KINDS = ['rules', 'decisions', 'bible', 'architecture', 'lessons', 'memory', 'plans', 'other']; // cap priority
const W = (s) => new RegExp(`(?:^|[/_. -])(?:${s})(?:[/_. -]|$)`, 'i');
const FILE_KIND = [
  ['rules', W('rules|conventions|guidelines|standards|style[-_ ]?guide|contributing|coding')],
  ['decisions', W('adrs?|decisions?|decision[-_ ]?log|rfcs?|rfc[-_ ]?\\d+')],
  ['lessons', W('lessons?|postmortems?|post-mortems?|retros?|retrospectives?|incidents?|learnings?|gotchas')],
  ['plans', W('plans?|planning|roadmap|todo|tasks?|backlog|milestones?')],
  ['architecture', W('architecture|arch|system[-_ ]?design|tech(?:nical)?[-_ ]?design|tech[-_ ]?stack|stack|infrastructure')],
  ['bible', W('vision|mission|gdd|game[-_ ]?design(?:[-_ ]?doc(?:ument)?)?|prd|product|overview|charter|manifesto|principles|pitch|brief|design|specs?|specification|wiki')],
];
const HEAD_KIND = [
  ['bible', /^(?:(?:product|game|our|the)\s+)?(?:vision|mission|purpose|pitch|principles|design pillars|pillars|goals?|non-negotiables|red lines|users|audience|target audience|players|who (?:it'?s|this is) for|overview|about|core loop|values)\b/i],
  ['decisions', /^(?:decisions?|decision log|decided|we (?:chose|decided))\b/i],
  ['architecture', /^(?:architecture|tech(?:nical)? stack|stack|components|data model|storage|infrastructure|system design|services|modules)\b/i],
  ['rules', /^(?:rules|conventions|guidelines|standards|coding (?:standards|style)|code style|style guide|do'?s and don'?ts|don'?ts|workflow|git|commits?|testing|security)\b/i],
  ['lessons', /^(?:lessons?(?: learned)?|post-?mortems?|gotchas|pitfalls|learnings|known issues)\b/i],
  ['plans', /^(?:roadmap|todo|to-do|next steps|milestones?|plan|backlog)\b/i],
];
export function fileKind(root, rel) {
  if (/^(?:\.omc\/|auto-memory\/|mempalace\/)/.test(rel)) return 'memory';
  if (AGENT.test(rel)) return 'rules';
  const c = loadConfig(root).paths;
  if (rel === 'docs/PROJECT.md' || rel === c.constraints) return 'bible';
  if (rel.startsWith(`${c.adr}/`)) return 'decisions';
  if (rel.startsWith(`${c.standards}/`)) return 'rules';
  const p = rel.replace(DOC, '').toLowerCase();
  return FILE_KIND.find(([, re]) => re.test(p))?.[0] || 'other';
}
const headKind = (title) => HEAD_KIND.find(([, re]) => re.test(title.replace(/^[\d.)\s]+/, '')))?.[0] || null;

// ---- sources outside the repo (read-only; only names and sizes are stored, never a local path) ----
const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
export const memoryDir = (root) => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects', real(root).replace(/[^a-zA-Z0-9]/g, '-'), 'memory');
// JSON notes (.omc/project-memory.json) read as "## key path" + "- value" lines.
function jsonToMd(text) {
  let j; try { j = JSON.parse(text); } catch { return ''; }
  const out = [];
  const go = (v, p) => {
    if (typeof v === 'string') { if (v.trim().split(/\s+/).length >= 3) out.push(`## ${p || 'notes'}`, `- ${v.replace(/\s+/g, ' ').trim()}`, ''); }
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) go(x, Array.isArray(v) ? p : p ? `${p} > ${k}` : k);
  };
  go(j, '');
  return out.join('\n');
}
export function readSource(root, file) {
  try {
    if (file.startsWith('auto-memory/')) return fs.readFileSync(path.join(memoryDir(root), file.slice(12)), 'utf8');
    if (file.startsWith('mempalace/')) return fs.readFileSync(kfile(root, file), 'utf8');
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    return file.endsWith('.json') ? jsonToMd(text) : text;
  } catch { return null; }
}

// ---- markdown sections: every heading starts one; (top) is what comes before the first ----
const cleanTitle = (t) => t.replace(/<!--.*?-->/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').replace(/:$/, '').trim();
export function parseSections(text) {
  const lines = String(text).split(/\r?\n/);
  let fmEnd = 0;
  if (lines[0] === '---') { const e = lines.indexOf('---', 1); if (e > 0) fmEnd = e + 1; }
  const out = [], stack = [];
  let cur = { title: '(top)', path: '(top)', start: fmEnd + 1 }, fence = false;
  for (let i = fmEnd; i < lines.length; i++) {
    if (/^\s*(?:```|~~~)/.test(lines[i])) { fence = !fence; continue; }
    const m = !fence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    if (!m) continue;
    out.push({ ...cur, end: i });
    const level = m[1].length, title = cleanTitle(m[2]);
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    stack.push({ level, title });
    cur = { title, path: stack.map((s) => s.title).join(' > '), start: i + 1 };
  }
  out.push({ ...cur, end: lines.length });
  return out.filter((s) => s.end >= s.start);
}

// ---- dates: git blame per line, run-length encoded [from, to, ms, commit]; uncommitted lines have no commit ----
const iso = (t) => new Date(t).toISOString().slice(0, 10);
function blame(root, rel) {
  const r = git(root, ['blame', '--line-porcelain', '--', rel]);
  if (r.status !== 0) return null;
  const runs = [];
  let sha = '', t = 0, n = 0;
  for (const l of r.stdout.split('\n')) {
    if (/^[0-9a-f]{40} \d+ \d+/.test(l)) { sha = l.slice(0, 40); t = 0; } else if (l.startsWith('author-time ')) t = Number(l.slice(12)) * 1000;
    else if (l.startsWith('\t')) {
      n++;
      const c = /^0+$/.test(sha) ? null : sha.slice(0, 10);
      const last = runs[runs.length - 1];
      if (last && last[3] === c && last[2] === (c ? t : 0) && last[1] === n - 1) last[1] = n; else runs.push([n, n, c ? t : 0, c]);
    }
  }
  return runs;
}
export function dateOf(runs, a, b) {
  let best = null;
  for (const [s, e, t, c] of runs || []) if (e >= a && s <= b && c && (!best || t > best[0])) best = [t, c];
  return best ? { date: iso(best[0]), commit: best[1] } : null;
}

// A decision record's own status (front matter or a "Status:" line near the top): superseded and rejected ones are history.
export function docStatus(text) {
  const head = String(text).split(/\r?\n/).slice(0, 40).join('\n');
  const w = /^[\s>*-]*\**status\**\s*:\s*\**\s*(superseded|rejected|deprecated|withdrawn)\b/im.exec(head)?.[1]?.toLowerCase();
  return !w ? null : w === 'superseded' || w === 'deprecated' ? 'superseded' : 'rejected';
}

export function describe(root, file, kind, stat, runs) {
  const text = readSource(root, file) ?? '';
  const sections = parseSections(text).map((s) => {
    const d = dateOf(runs, s.start, s.end);
    return { title: s.title, path: s.path, kind: kind === 'memory' ? 'memory' : headKind(s.title) || kind, lines: [s.start, s.end], date: d?.date ?? null, commit: d?.commit ?? null, undated: !d };
  });
  const status = kind === 'decisions' ? docStatus(text) : null;
  return { file, kind, kit: kitPath(root, file), tracked: !!runs, bytes: stat.size, mtime: iso(stat.mtimeMs), ...(status ? { status } : {}), sections, runs: runs || [] };
}

const MAX_BYTES = 512 * 1024;
// Auto-memory types (front matter "type:"): user memories are personal and only listed, never read into statements.
const personal = (name, text) => /^user[_-]/i.test(name) || /^type:\s*user\b/im.test(/^---\r?\n([\s\S]*?)\r?\n---/.exec(text || '')?.[1] || '');

function mempalace(root) {
  if (tool('mempalace', ['--version'], { timeout: 10000 }).status !== 0) return { installed: false };
  const r = tool('mempalace', ['search', 'decided rule must never always lesson', '--wing', slug(root), '--results', '20'], { timeout: 60000 });
  const out = (r.stdout || '').trim();
  if (r.status !== 0 || !out || /\bno (?:results|drawers|matches)\b/i.test(out)) return { installed: true, wing: false };
  kwrite(root, 'mempalace/search.md', `# MemPalace search (wing ${slug(root)})\n${out.split(/\r?\n/).map((l) => (l.trim() ? `- ${l.trim()}` : '')).join('\n')}\n`);
  return { installed: true, wing: true, file: 'mempalace/search.md' };
}

export function inventory(root, flags = {}) {
  const cfg = settings(root, flags);
  const skip = new Set(many(flags.skip).flatMap((s) => String(s).split(',')));
  const tracked = new Set(git(root, ['ls-files', '-z']).stdout.split('\0').filter(Boolean));
  const files = walk(root).filter(isKnowledge);
  if (!skip.has('omc')) {
    for (const f of ['.omc/project-memory.json', '.omc/notepad.md']) if (fs.existsSync(path.join(root, f))) files.push(f);
    files.push(...walk(root, '.omc/wiki').filter((f) => DOC.test(f)));
  }
  const sources = [], skipped = [];
  for (const rel of files) {
    const st = fs.statSync(path.join(root, rel));
    if (st.size > MAX_BYTES) { skipped.push({ file: rel, why: 'larger than 512 KB' }); continue; }
    sources.push(describe(root, rel, fileKind(root, rel), st, tracked.has(rel) ? blame(root, rel) : null));
  }
  const memory = { found: false, files: [] };
  if (!skip.has('memory')) {
    const dir = memoryDir(root);
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort(); } catch { /* none */ }
    for (const name of names) {
      const st = fs.statSync(path.join(dir, name));
      const text = fs.readFileSync(path.join(dir, name), 'utf8');
      const row = { name, bytes: st.size, personal: personal(name, text), index: name === 'MEMORY.md' };
      memory.files.push(row);
      if (!row.personal && !row.index) sources.push(describe(root, `auto-memory/${name}`, 'memory', st, null));
    }
    memory.found = names.length > 0;
  }
  const mp = skip.has('mempalace') ? { skipped: true } : mempalace(root);
  if (mp.file) sources.push(describe(root, mp.file, 'memory', fs.statSync(kfile(root, mp.file)), null));
  sources.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.bytes - b.bytes);
  for (const s of sources.splice(cfg.max_files)) skipped.push({ file: s.file, why: `over the ${cfg.max_files}-file cap` });
  sources.sort((a, b) => a.file.localeCompare(b.file));
  return { created: new Date().toISOString(), repo: slug(root), sources, skipped, memory, mempalace: mp };
}

// ---- statements ----
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/;
const NORM = /\b(?:must|never|always|should|shall|don'?t|do not|avoid|prefer|use[sd]?|using|required?|forbidden|only|no longer|decided|chose|choose|will|won'?t|instead|switch(?:ed)? to|replaced?|keep|run|write|need)\b/i;
// Plain docs: a statement of how things are counts too ("the game stays single-player").
const STATE = /\b(?:is|are|stays?|remains?|becomes?|will be|has to|have to)\b/i;
const ANNOTATION = /\(fk knowledge-map\)/;
const PRIVATE = /[\w.+-]+@[\w-]+\.\w|[A-Za-z]:\\|\/(?:home|Users)\/\w/;
const plain = (s) => s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();

// Items of one section: bullets (with indented continuation lines) and the sentences of paragraphs; 1-based lines.
export function sectionItems(text, sec) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  let cur = null, fence = false;
  const flush = () => { if (cur) out.push(cur); cur = null; };
  for (let n = sec.title === '(top)' ? sec.lines[0] : sec.lines[0] + 1; n <= sec.lines[1]; n++) {
    let l = lines[n - 1] ?? '';
    if (/^\s*(?:```|~~~)/.test(l)) { fence = !fence; flush(); continue; }
    if (fence || /^\s*(?:\||<!--|-->|---\s*$|#)/.test(l) || ANNOTATION.test(l)) { flush(); continue; }
    l = l.replace(/^\s*>\s?/, '');
    if (!l.trim()) { flush(); continue; }
    const b = BULLET.exec(l);
    if (b) { flush(); cur = { text: b[1], a: n, b: n, bullet: true }; continue; }
    if (cur && (!cur.bullet || /^\s{2,}\S/.test(l))) { cur.text += ` ${l.trim()}`; cur.b = n; continue; }
    flush();
    cur = { text: l.trim(), a: n, b: n, bullet: false };
  }
  flush();
  return out.flatMap((it) => (it.bullet ? [it] : plain(it.text).split(/(?<=[.!?])\s+(?=[A-Z0-9"'`(])/).map((t) => ({ ...it, text: t }))))
    .map((it) => ({ ...it, text: plain(it.text) }));
}
export function keep(text, kind) {
  const words = text.split(/\s+/).filter((w) => /\w/.test(w));
  if (words.length < 3 || /^(?:see|read|source|link|more)\b/i.test(text) || /^`[^`]+`$/.test(text)) return false;
  // Record metadata ("Date: ... · Status: accepted", "Deciders: ...") is not a statement.
  if (/^(?:date|status|author|owner|deciders?|supersed\w*|tags?)\s*:/i.test(text) || /\bStatus\s*:\s*(?:accepted|proposed|superseded|rejected|draft)\b/i.test(text)) return false;
  if (kind === 'memory' && PRIVATE.test(text)) return false; // never carry a mail address or a local path out of memory
  return kind === 'plans' ? NORM.test(text) : kind === 'other' ? NORM.test(text) || STATE.test(text) : true;
}

// Topic words: lower case, stop words out, crude stemming; entities: code spans and capitalised names.
const STOP = new Set(('the a an and or of to in on for with is are was were be been being it its this that these those from by at as not no do does did when then than '
  + 'into can cannot never always must should shall will would could may might our your their we us you they he she i me my but though yet also too all any each every '
  + 'more most only very just so if there which what who whom how why where have has had about after before over under up out here new use uses used using make made get '
  + 'set like one two per via etc e g ie eg keep run write need needs instead prefer avoid don t doesn isn won only both same other others such').split(' '));
const stem = (w) => (w.length < 4 ? w : w.replace(/(x|s|sh|ch)es$/, '$1').replace(/ies$/, 'y').replace(/s$/, '').replace(/(ing|ed)$/, '')) || w;
export const words = (s) => [...new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)).map(stem))];
export const entities = (s) => [...new Set([...String(s).matchAll(/`([^`]+)`|(?<=\s)([A-Z][a-zA-Z0-9]+(?:[A-Z][a-z0-9]+)*)\b/g)].map((m) => (m[1] || m[2]).toLowerCase()))];

export function statementsOf(root, src, text, only = null) {
  const out = [];
  for (const sec of src.sections) {
    for (const it of sectionItems(text, sec)) {
      if (only && !only(it.a, it.b)) continue;
      if (!keep(it.text, sec.kind)) continue;
      const d = dateOf(src.runs, it.a, it.b);
      out.push({ file: src.file, section: sec.path, title: sec.title, lines: [it.a, it.b], date: d?.date ?? null, commit: d?.commit ?? null,
        undated: !d, mtime: src.mtime, kind: sec.kind, kit: src.kit, ...(src.status ? { retired: src.status } : {}), keywords: words(it.text).slice(0, 16), topic: words(sec.title), entities: entities(` ${it.text}`),
        text: it.text.length > 400 ? `${it.text.slice(0, 399)}…` : it.text });
    }
  }
  return out;
}

export function extract(root, flags = {}) {
  const inv = kread(root, 'inventory.json');
  if (!inv) return null;
  const { max_statements: max } = settings(root, flags);
  const all = [];
  for (const src of inv.sources) {
    const text = readSource(root, src.file);
    if (text != null) all.push(...statementsOf(root, src, text));
  }
  const order = [...all].sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || !a.date - !b.date || String(b.date || '').localeCompare(String(a.date || ''))); // undated last, never by file time
  const kept = new Set(order.slice(0, max));
  const skipped = order.slice(max);
  const count = (xs, key) => xs.reduce((o, s) => ({ ...o, [s[key]]: (o[s[key]] || 0) + 1 }), {});
  const statements = all.filter((s) => kept.has(s)).map((s, i) => ({ id: `S-${String(i + 1).padStart(4, '0')}`, ...s }));
  return { created: new Date().toISOString(), max, total: all.length, kept: statements.length,
    skipped: { count: skipped.length, by_kind: count(skipped, 'kind'), by_file: count(skipped, 'file') }, statements };
}

// ---- candidate clusters ----
const jac = (a, b) => { if (!a.length || !b.length) return 0; const B = new Set(b); const n = a.filter((x) => B.has(x)).length; return n / (a.length + b.length - n); };
export function similarity(a, b) {
  const topic = a.topic.some((w) => b.topic.includes(w)) ? 0.15 : 0;
  const ent = Math.min(0.2, 0.1 * a.entities.filter((e) => b.entities.includes(e)).length);
  return jac(a.keywords, b.keywords) + topic + ent;
}
export const THRESHOLD = 0.35;
const WEIGHT = { rules: 3, decisions: 3, bible: 3, architecture: 2, lessons: 1, memory: 1, plans: 0.5, other: 0.5 };
export const IMPORTANT = new Set(['rules', 'decisions', 'bible']);
const NEG = /\b(?:not|never|no|don'?t|without|avoid|instead|retired?|no longer|stop)\b/i;
export function signals(ss) {
  const out = [];
  const neg = ss.filter((s) => NEG.test(s.text)).length;
  if (neg && neg < ss.length) out.push('negation');
  if (new Set(ss.filter((s) => s.date).map((s) => s.date)).size > 1) out.push('dates differ');
  if (ss.some((s) => s.undated)) out.push('undated');
  return out;
}
const est = (ss) => Math.ceil(ss.reduce((n, s) => n + s.text.length + s.file.length + s.section.length + 40, 0) / 3.5) + 150;
// OVERHEAD: what one analyst agent costs before it reads its work file (system prompt, tools, the verdict command).
export const BATCH = 8000, OVERHEAD = 10000;

export function cluster(statements) {
  const pairs = [];
  for (let i = 0; i < statements.length; i++) {
    for (let j = i + 1; j < statements.length; j++) {
      const a = statements[i], b = statements[j];
      if ((a.file === b.file && a.section === b.section) || a.retired || b.retired) continue; // a superseded or rejected record is history
      const s = similarity(a, b);
      if (s >= THRESHOLD) pairs.push([s, i, j]);
    }
  }
  pairs.sort((x, y) => y[0] - x[0]);
  const parent = statements.map((_, i) => i), size = statements.map(() => 1), best = statements.map(() => 0);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const [s, i, j] of pairs) {
    const a = find(i), b = find(j);
    if (a === b || size[a] + size[b] > 6) continue;
    parent[b] = a; size[a] += size[b]; best[a] = Math.max(best[a], best[b], s);
  }
  const groups = new Map();
  statements.forEach((s, i) => { const r = find(i); if (size[r] > 1) groups.set(r, [...(groups.get(r) || []), s]); });
  return [...groups.entries()].map(([r, ss]) => {
    const sig = signals(ss);
    const shared = ss[0].keywords.filter((w) => ss.slice(1).every((s) => s.keywords.includes(w) || s.topic.includes(w)));
    return { ids: ss.map((s) => s.id), kinds: [...new Set(ss.map((s) => s.kind))], topic: (shared.length ? shared : ss[0].topic).slice(0, 4).join(', ') || ss[0].title,
      impact: Math.max(...ss.map((s) => WEIGHT[s.kind] ?? 0.5)) * 2 + sig.length + Math.min(ss.length, 4) / 2, score: Number(best[r].toFixed(2)), signals: sig, tokens: est(ss) };
  }).sort((a, b) => b.impact - a.impact || b.score - a.score);
}

const line = (s) => `- ${s.id} [${s.kind}] ${s.file} §${s.section} L${s.lines[0]}${s.lines[1] > s.lines[0] ? `-${s.lines[1]}` : ''}, ${s.date || `no date (file changed ${s.mtime})`}: "${s.text}"`;
const WORK_HEAD = (by) => `Read only this file. For each cluster decide one verdict: duplicate (the same rule or fact twice), contradiction (they cannot both hold), stale (outdated: replaced, or no longer true), or ok (related but compatible). Explain each in one plain line a non-programmer understands.
Record all verdicts with ONE shell command and nothing else (PowerShell: pipe a here-string @'...'@ into the same command):

fk adopt knowledge verdict --by ${by} <<'EOF'
cluster: C-001
verdict: contradiction
ids: S-0003 S-0010
scope: same
why: <one plain line>

cluster: C-002
verdict: ok
why: <one plain line>
EOF

ids = the statements the verdict is about (for stale: the outdated ones). scope: different = both can hold, for different parts or situations.
`;

export function candidates(root, flags = {}) {
  const st = kread(root, 'statements.json');
  if (!st) return null;
  const { max_tokens } = settings(root, flags);
  const byId = new Map(st.statements.map((s) => [s.id, s]));
  const all = cluster(st.statements).map((c, i) => ({ id: `C-${String(i + 1).padStart(3, '0')}`, ...c }));
  // Token budget: three quarters for the analyst pass (work files + one verdict line each + per-agent overhead), the rest
  // for the critic's second look and the founder interview. Clusters are ranked by impact, so the cut drops the least.
  const share = Math.floor(max_tokens * 0.75);
  const clusters = [], deferred = [];
  let used = 0, batch = 1, inBatch = 0;
  for (const c of all) {
    const fresh = inBatch === 0 || inBatch + c.tokens > BATCH; // a new batch costs one more agent's overhead
    const cost = c.tokens + (fresh ? OVERHEAD : 0);
    if (used + cost > share) { deferred.push(c); continue; }
    if (fresh && inBatch > 0) { batch++; inBatch = 0; }
    used += cost;
    inBatch += c.tokens;
    clusters.push({ ...c, batch });
  }
  fs.rmSync(kfile(root, 'work'), { recursive: true, force: true });
  const batches = [...new Set(clusters.map((c) => c.batch))];
  for (const b of batches) {
    const cs = clusters.filter((c) => c.batch === b);
    kwrite(root, `work/batch-${String(b).padStart(2, '0')}.md`, `# Knowledge health check, batch ${b} of ${batches.length} (${cs[0].id} to ${cs[cs.length - 1].id})\n\n${WORK_HEAD('analyst')}\n`
      + cs.map((c) => `## ${c.id}: ${c.topic} (impact ${c.impact}${c.signals.length ? `; ${c.signals.join(', ')}` : ''})\n${c.ids.map((id) => line(byId.get(id))).join('\n')}\n`).join('\n'));
  }
  const inCluster = new Set(all.flatMap((c) => c.ids));
  return { created: new Date().toISOString(), budget: { max_tokens, analyst_share: share, estimated: used, batches: batches.length },
    clusters, deferred: deferred.map(({ batch, ...c }) => c), unclustered: st.statements.filter((s) => !inCluster.has(s.id)).length };
}

// ---- verdicts: the one sanctioned writer for agents (state dir writes are otherwise denied by the gate guard) ----
const VERDICTS = ['duplicate', 'contradiction', 'stale', 'ok'];
export function parseVerdicts(text, cluster) {
  const t = String(text).trim();
  if (/^[[{]/.test(t)) return [].concat(JSON.parse(t)).map((v) => ({ cluster, ...v, ids: [].concat(v.ids || []) }));
  return t.split(/\r?\n\s*\r?\n/).filter((b) => b.trim()).map((b) => {
    const v = { cluster };
    for (const l of b.split(/\r?\n/)) {
      const m = /^\s*(cluster|verdict|ids|scope|why)\s*:\s*(.*)$/i.exec(l);
      if (m) v[m[1].toLowerCase()] = m[2].trim();
    }
    v.ids = String(v.ids || '').split(/[\s,]+/).filter(Boolean);
    return v;
  });
}
function verdict(root, pos, flags) {
  const cand = kread(root, 'candidates.json');
  if (!cand) return fail('fk adopt knowledge: run fk adopt knowledge candidates first.');
  const by = String(flags.by || 'analyst').toLowerCase();
  if (!['analyst', 'critic'].includes(by)) return fail('fk adopt knowledge verdict: --by is analyst or critic.');
  const text = flags.from ? fs.readFileSync(path.resolve(String(flags.from)), 'utf8') : fs.readFileSync(0, 'utf8');
  let vs;
  try { vs = parseVerdicts(text, pos[0]); } catch { return fail('fk adopt knowledge verdict: not readable (blocks of "cluster: / verdict: / ids: / scope: / why:" lines, or JSON).'); }
  const known = new Map([...cand.clusters, ...cand.deferred].map((c) => [c.id, c]));
  const errors = [];
  for (const v of vs) {
    const c = known.get(v.cluster);
    v.verdict = String(v.verdict || '').toLowerCase();
    v.why = String(v.why || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    if (!c) { errors.push(`${v.cluster || '(no cluster)'}: no such cluster`); continue; }
    if (!VERDICTS.includes(v.verdict)) errors.push(`${v.cluster}: verdict must be ${VERDICTS.join(' | ')}`);
    if (!v.why) errors.push(`${v.cluster}: why is missing`);
    if (v.ids.some((id) => !c.ids.includes(id))) errors.push(`${v.cluster}: ids must come from the cluster (${c.ids.join(' ')})`);
    if (['duplicate', 'contradiction'].includes(v.verdict) && v.ids.length < 2) v.ids = [...c.ids];
    if (v.verdict === 'stale' && !v.ids.length) errors.push(`${v.cluster}: name the stale statement ids`);
  }
  if (!vs.length) errors.push('no verdict given');
  if (errors.length) return fail(`fk adopt knowledge verdict: nothing recorded.\n${errors.map((e) => `- ${e}`).join('\n')}`);
  for (const v of vs) {
    const rel = `verdicts/${v.cluster}.json`;
    const rec = kread(root, rel, { cluster: v.cluster });
    rec[by] = { verdict: v.verdict, ids: v.ids, scope: /^diff/i.test(v.scope || '') ? 'different' : 'same', why: v.why, ts: new Date().toISOString() };
    kwrite(root, rel, rec);
    say(`fk adopt knowledge: recorded ${v.cluster} ${v.verdict} (${by}).`);
  }
}

// ---- report: latest wins by default; undated, same-date or different-scope conflicts go to the founder ----
// Newest first; on the same date a project doc before an agent rule file (those are never rewritten).
const byDate = (ss) => [...ss].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || AGENT.test(a.file) - AGENT.test(b.file));
export function buildReport(root) {
  const st = kread(root, 'statements.json'), cand = kread(root, 'candidates.json');
  if (!st || !cand) return null;
  const byId = new Map(st.statements.map((s) => [s.id, s]));
  const res = kread(root, 'resolutions.json', {});
  const rep = { created: new Date().toISOString(), contradictions: [], duplicates: [], stale: [], ok: 0, pending: [], deferred: cand.deferred.map((c) => c.id), critic: [] };
  for (const c of [...cand.clusters, ...cand.deferred]) {
    const rec = kread(root, `verdicts/${c.id}.json`);
    const v = rec?.critic || rec?.analyst;
    if (!v) { if (!rep.deferred.includes(c.id)) rep.pending.push(c.id); continue; }
    const ss = (v.ids.length ? v.ids : c.ids).map((id) => byId.get(id)).filter(Boolean);
    const important = ss.some((s) => IMPORTANT.has(s.kind));
    const base = { cluster: c.id, topic: c.topic, ids: ss.map((s) => s.id), why: v.why, important, by: rec.critic ? 'critic' : 'analyst', resolution: res[c.id] || null };
    if (v.verdict === 'ok') rep.ok++;
    else if (v.verdict === 'contradiction') {
      const sorted = byDate(ss);
      const ambiguous = ss.some((s) => s.undated) ? 'a statement has no date in the history'
        : sorted[0].date === sorted[1]?.date ? 'both were written on the same day'
          : v.scope === 'different' ? 'both may hold, for different parts or situations' : null;
      rep.contradictions.push({ ...base, winner: ambiguous ? null : sorted[0].id, ambiguous });
      if (important && !rec.critic) rep.critic.push(c.id);
    } else if (v.verdict === 'duplicate') {
      const sorted = byDate(ss);
      rep.duplicates.push({ ...base, keep: sorted[0].id, merge: sorted.slice(1).map((s) => s.id) });
    } else rep.stale.push(base);
  }
  rep.undated = st.statements.filter((s) => s.undated && IMPORTANT.has(s.kind)).map((s) => s.id);
  return rep;
}
const q = (s) => `"${s.text}" (${s.file} §${s.section}, ${s.date || 'no date'})`;
function reportMd(root, rep) {
  const st = kread(root, 'statements.json'), cand = kread(root, 'candidates.json');
  const byId = new Map(st.statements.map((s) => [s.id, s]));
  const S = (id) => byId.get(id);
  const settled = rep.contradictions.filter((c) => !c.ambiguous).length;
  const res = (r) => (r.resolution ? `\n- Decided: ${r.resolution.choice}${r.resolution.note ? ` ("${r.resolution.note}")` : ''}.` : '');
  return `# Knowledge health: ${slug(root)}

Read from ${new Set(st.statements.map((s) => s.file)).size} documents: ${st.kept} statements${st.skipped.count ? ` (${st.skipped.count} more skipped by the ${st.max}-statement cap, least important first)` : ''}. Agents compared ${cand.clusters.length} groups of related statements${rep.deferred.length ? `; ${rep.deferred.length} groups were left out to stay within the token budget` : ''}.

## In short
- ${rep.contradictions.length} contradiction(s): ${settled} settle by "the newer statement wins", ${rep.contradictions.length - settled} need your decision.
- ${rep.duplicates.length} duplicate(s) to merge into one place.
- ${rep.stale.length} stale item(s) to drop.
- ${rep.undated.length} rule(s), decision(s) or vision statement(s) have no date in the history: they count, but cannot win a "newer wins" tie.
${rep.pending.length ? `- ${rep.pending.length} group(s) not judged yet: ${rep.pending.join(', ')}.\n` : ''}
## Contradictions
${rep.contradictions.map((c) => `### ${c.cluster}${c.important ? ' (important)' : ''}: ${c.topic}
${c.ids.map((id) => `- ${id}: ${q(S(id))}`).join('\n')}
- Why: ${c.why}
- Proposal: ${c.ambiguous ? `needs you (${c.ambiguous}).` : `newer wins, keep ${c.winner} (${S(c.winner).date}).`}${res(c)}`).join('\n\n') || 'None found.'}

## Duplicates to merge
${rep.duplicates.map((d) => `- ${d.cluster}: keep ${d.keep} ${q(S(d.keep))}; merge ${d.merge.join(', ')} into it. ${d.why}${res(d)}`).join('\n') || 'None found.'}

## Stale
${rep.stale.map((s) => `- ${s.cluster}: ${s.ids.map((id) => `${id} ${q(S(id))}`).join('; ')}. ${s.why}${res(s)}`).join('\n') || 'None found.'}

## No date (ask if they still hold)
${rep.undated.slice(0, 10).map((id) => `- ${id}: ${q(S(id))}`).join('\n') || 'None.'}${rep.undated.length > 10 ? `\n- and ${rep.undated.length - 10} more.` : ''}
${rep.deferred.length ? `\n## Not checked (token budget)\n- ${rep.deferred.join(', ')}: raise knowledge.max_tokens or check them in a later session.\n` : ''}`;
}
function report(root) {
  const rep = buildReport(root);
  if (!rep) return fail('fk adopt knowledge: run inventory, extract and candidates first.');
  kwrite(root, 'report.json', rep);
  const md = kwrite(root, 'report.md', reportMd(root, rep));
  const settled = rep.contradictions.filter((c) => !c.ambiguous).length;
  say(`fk adopt knowledge: ${rep.contradictions.length} contradiction(s) (${settled} settle by newer-wins, ${rep.contradictions.length - settled} need the founder), ${rep.duplicates.length} duplicate(s), ${rep.stale.length} stale, ${rep.undated.length} undated. Report: ${md}`);
  if (rep.pending.length) say(`Not judged yet: ${rep.pending.join(', ')}.`);
  const crit = rep.critic.filter((id) => !kread(root, `verdicts/${id}.json`)?.critic);
  if (crit.length) {
    const st = kread(root, 'statements.json'), cand = kread(root, 'candidates.json');
    const byId = new Map(st.statements.map((s) => [s.id, s]));
    const f = kwrite(root, 'work/critic.md', `# Second look: important contradictions\n\n${WORK_HEAD('critic')}\nThe analyst's verdict is shown; confirm it or correct it.\n\n`
      + crit.map((id) => { const c = cand.clusters.find((x) => x.id === id) || cand.deferred.find((x) => x.id === id); const a = kread(root, `verdicts/${id}.json`).analyst;
        return `## ${id}: ${c.topic}\nAnalyst: ${a.verdict} (${a.ids.join(' ')}), ${a.scope} scope: ${a.why}\n${c.ids.map((x) => line(byId.get(x))).join('\n')}\n`; }).join('\n'));
    say(`Second look for OMC's critic (${crit.length} important contradiction(s)): ${f}`);
  }
}

// ---- resolutions (the founder's answers, recorded by the agent) ----
function itemOf(rep, id) {
  for (const [verdict, list] of [['contradiction', rep.contradictions], ['duplicate', rep.duplicates], ['stale', rep.stale]]) {
    const it = list.find((x) => x.cluster === id);
    if (it) return { verdict, ...it };
  }
  return null;
}
function decide(it, choice, note) {
  const others = (k) => it.ids.filter((x) => !k.includes(x));
  if (choice === 'latest' || choice === 'merge') {
    if (it.verdict === 'contradiction') return it.ambiguous ? `${it.cluster} has no clear newer side (${it.ambiguous}): ask the founder (keep:S-n, both or new)` : { keep: [it.winner], drop: others([it.winner]) };
    if (it.verdict === 'duplicate') return { keep: [it.keep], drop: it.merge };
    return { keep: [], drop: it.ids };
  }
  const k = /^keep:(S-\d{4})$/i.exec(choice)?.[1]?.toUpperCase();
  if (k) return it.ids.includes(k) ? { keep: [k], drop: others([k]) } : `${k} is not in ${it.cluster} (${it.ids.join(' ')})`;
  if (choice === 'both' || choice === 'new') {
    if (it.verdict !== 'contradiction') return `${choice} is for contradictions`;
    return note ? { keep: [], drop: it.ids, note } : `${choice} needs --note "<the wording that holds from now on>"`;
  }
  if (choice === 'drop') return { keep: [], drop: it.ids };
  return `unknown choice ${choice} (latest | keep:S-n | both | new | drop | merge)`;
}
function resolve(root, pos, flags) {
  const rep = kread(root, 'report.json');
  if (!rep) return fail('fk adopt knowledge: run fk adopt knowledge report first.');
  const res = kread(root, 'resolutions.json', {});
  const date = today(flags);
  const todo = [];
  if (flags.all) {
    if (pos[0] !== 'latest') return fail('usage: fk adopt knowledge resolve --all latest [--minor]');
    for (const it of [...rep.contradictions.map((x) => ({ verdict: 'contradiction', ...x })), ...rep.duplicates.map((x) => ({ verdict: 'duplicate', ...x })), ...rep.stale.map((x) => ({ verdict: 'stale', ...x }))]) {
      if (res[it.cluster] || (flags.minor && it.important) || it.ambiguous) continue;
      todo.push([it, 'latest']);
    }
  } else {
    const it = itemOf(rep, String(pos[0] || '').toUpperCase());
    if (!it || !pos[1]) return fail('usage: fk adopt knowledge resolve <cluster> <latest|keep:S-n|both|new|drop|merge> [--note "<wording>"] | resolve --all latest [--minor]');
    todo.push([it, String(pos[1]).toLowerCase()]);
  }
  for (const [it, choice] of todo) {
    const d = decide(it, choice, flags.note && String(flags.note).trim());
    if (typeof d === 'string') return fail(`fk adopt knowledge resolve: ${d}.`);
    res[it.cluster] = { cluster: it.cluster, verdict: it.verdict, ids: it.ids, choice: choice.startsWith('keep:') ? `keep:${choice.slice(5).toUpperCase()}` : choice, ...d, date };
    say(`fk adopt knowledge: ${it.cluster} (${it.verdict}) resolved: ${res[it.cluster].choice}.`);
  }
  kwrite(root, 'resolutions.json', res);
  const open = rep.contradictions.filter((c) => !res[c.cluster]);
  say(open.length ? `Still for the founder: ${open.map((c) => `${c.cluster}${c.ambiguous ? ` (${c.ambiguous})` : ''}`).join('; ')}.` : 'Every contradiction is resolved. Next: fk adopt knowledge compile --dry-run.');
}

const USAGE = `usage: fk adopt knowledge inventory [--json] [--skip memory,omc,mempalace] | extract [--max-statements 400] | candidates [--max-tokens 150000]
       fk adopt knowledge verdict [<cluster>] [--by analyst|critic] [--from <file>] | report
       fk adopt knowledge resolve <cluster> <latest|keep:S-n|both|new|drop|merge> [--note "<wording>"] | resolve --all latest [--minor]
       fk adopt knowledge compile [--dry-run] [--keep-sources]`;
const tally = (xs, key) => Object.entries(xs.reduce((o, x) => ({ ...o, [x[key]]: (o[x[key]] || 0) + 1 }), {})).map(([k, n]) => `${k} ${n}`).join(', ');

export default async function knowledge(root, pos, flags) {
  const sub = pos[0], rest = pos.slice(1);
  if (sub === 'inventory') {
    const inv = inventory(root, flags);
    const f = kwrite(root, 'inventory.json', inv);
    if (flags.json) return say(JSON.stringify(inv, null, 2));
    const undated = inv.sources.reduce((n, s) => n + s.sections.filter((x) => x.undated).length, 0);
    const mem = inv.memory.files;
    say(`fk adopt knowledge: ${inv.sources.length} source(s) (${tally(inv.sources, 'kind') || 'none'}); ${undated} section(s) without a date in the git history.`);
    say(`Claude auto-memory: ${mem.length ? `${mem.length} file(s), ${mem.filter((m) => m.personal).length} personal (listed only, never read)` : 'none'}. MemPalace: ${inv.mempalace.skipped ? 'skipped' : inv.mempalace.wing ? 'searched' : 'not used'}.`);
    if (inv.skipped.length) say(`Skipped ${inv.skipped.length}: ${inv.skipped.slice(0, 3).map((s) => `${s.file} (${s.why})`).join(', ')}${inv.skipped.length > 3 ? ', ...' : ''}.`);
    return say(`Written to ${f} (outside the repo). Next: fk adopt knowledge extract.`);
  }
  if (sub === 'extract') {
    const st = extract(root, flags);
    if (!st) return fail('fk adopt knowledge: run fk adopt knowledge inventory first.');
    const f = kwrite(root, 'statements.json', st);
    say(`fk adopt knowledge: ${st.kept} statement(s) (${tally(st.statements, 'kind') || 'none'})${st.skipped.count ? `; ${st.skipped.count} skipped by the ${st.max} cap (${Object.entries(st.skipped.by_kind).map(([k, n]) => `${k} ${n}`).join(', ')})` : ''}.`);
    return say(`Written to ${f}. Next: fk adopt knowledge candidates.`);
  }
  if (sub === 'candidates') {
    const c = candidates(root, flags);
    if (!c) return fail('fk adopt knowledge: run fk adopt knowledge extract first.');
    kwrite(root, 'candidates.json', c);
    say(`fk adopt knowledge: ${c.clusters.length} group(s) of related statements to judge in ${c.budget.batches} batch(es), an estimated ${Math.round(c.budget.estimated / 1000)}k tokens (including about ${OVERHEAD / 1000}k agent overhead per batch) of the ${Math.round(c.budget.max_tokens / 1000)}k-token budget${c.deferred.length ? `; ${c.deferred.length} lower-impact group(s) left out (budget)` : ''}.`);
    const one = OVERHEAD + Math.min(...[...c.clusters, ...c.deferred].map((x) => x.tokens));
    if (Number.isFinite(one) && c.budget.analyst_share < one) say(`The budget is too small for even one analyst batch (about ${Math.ceil(one / 1000)}k tokens, three quarters of the budget go to the analyst). Use at least --max-tokens ${Math.ceil(one / 0.75 / 1000) * 1000}.`);
    if (c.clusters.length) say(`Work files for OMC's analyst (read-only): ${kfile(root, 'work')}`);
    return;
  }
  if (sub === 'verdict') return verdict(root, rest, flags);
  if (sub === 'report') return report(root);
  if (sub === 'resolve') return resolve(root, rest, flags);
  if (sub === 'compile') return (await import('./compile.mjs')).compile(root, flags);
  fail(USAGE);
}
