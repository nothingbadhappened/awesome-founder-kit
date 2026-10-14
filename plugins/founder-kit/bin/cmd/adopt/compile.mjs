// fk adopt knowledge compile [--dry-run] [--keep-sources]: the consolidated knowledge as kit drafts, outside the repo.
// Resolved contradictions -> accepted ADRs (supersedes: the source locations they replace), decisions -> ADRs, bible and
// vision statements -> docs/PROJECT.md (own mode; index mode when the founder keeps the docs as the source of truth),
// rules -> docs/standards/<slot>.md, lessons and memory items -> docs/process/lessons.md, and docs/process/knowledge-map.md
// (source §section -> destination, resolution ids). --dry-run writes a preview only; without it the drafts land in the
// adopt workspace, where `fk adopt apply` installs them (never over an existing file: append + mark, or keep).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, stateDir } from '../../../hooks/lib.mjs';
import { BIBLE_KEYS, bibleSections, parseAdr } from '../../../hooks/knowledge.mjs';
import { say, git, today } from './util.mjs';
import { kread, kwrite, kfile, AGENT } from './knowledge.mjs';
import { parse as parseLessons, findDuplicate, claudeMdLines } from '../lessons.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TEMPLATE = (n) => path.join(KIT, 'skills', 'fk-process', 'templates', n);
export const MAP = 'docs/process/knowledge-map.md';
const MARKER = /<!--\s*fk:consolidated\s+(\d{4}-\d{2}-\d{2})\s+commit\s+([0-9a-f]+|none)\s*-->/g;
export const lastMarker = (text) => { const all = [...String(text || '').matchAll(MARKER)]; const m = all[all.length - 1]; return m ? { date: m[1], commit: m[2] } : null; };
const fail = (msg) => { say(msg); process.exitCode = 1; };
const ls = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const pad = (n) => String(n).padStart(4, '0');
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '') || 'decision';
const cell = (s) => String(s).replace(/\|/g, '\\|');
const loc = (s) => `${s.file} §${s.title}`;
const draftsDir = (root) => path.join(stateDir(root), 'adopt', 'drafts');
// The entries of a compiled lessons draft: from the first dated entry on (the template's fenced example is not one).
const FIRST = /\n## \d{4}-\d{2}-\d{2} — /;
const entriesOf = (text) => { const i = text.search(FIRST); return i < 0 ? '' : text.slice(i + 1); };

const BIBLE_OF = [['users', /\b(?:users?|audience|players?|customers?|personas?|who)\b/i], ['non-negotiables', /\b(?:non-negotiables?|red lines?|constraints?)\b/i],
  ['principles', /\b(?:principles?|values?|pillars?|tenets?|philosophy)\b/i], ['architecture', /\b(?:architecture|stack)\b/i], ['mission', /./]];
const bibleKey = (title) => BIBLE_OF.find(([, re]) => re.test(title))[0];
const SLOTS = [['security', /\b(?:secrets?|auth\w*|passwords?|tokens?|keys?|permissions?|privacy|encrypt\w*|credentials?)\b/i],
  ['testing', /\b(?:tests?|testing|coverage|specs?|tdd|qa)\b/i],
  ['data', /\b(?:postgres\w*|mysql|sqlite|databases?|db|orm|migrations?)\b/i], // -> standards/data.md when the repo has one, else architecture
  ['process', /\b(?:commits?|branch\w*|pull requests?|prs?|reviews?|releases?|deploy\w*|ci|merge|tasks?|changelog|versions?)\b/i],
  ['architecture', /\b(?:layers?|modules?|boundar\w*|imports?|depend\w*|services?|databases?|apis?|schemas?|storage|backend|frontend|server|architecture)\b/i]];
const slot = (s) => (s.kind === 'architecture' ? 'architecture' : SLOTS.find(([, re]) => re.test(`${s.title} ${s.text}`))?.[0] || 'coding');
const title = (s) => s[0].toUpperCase() + s.slice(1);

// Folders a statement names that exist in the repo -> applies_to globs (at most 3).
function appliesTo(root, texts) {
  const out = new Set();
  for (const t of texts) for (const m of t.matchAll(/`?((?:[\w.-]+\/)+[\w.*-]*)`?/g)) {
    const p = m[1].replace(/\/+$/, '').replace(/\/\*+$/, '');
    if (!p || p.startsWith('.') || /:\/\//.test(t)) continue;
    try { out.add(fs.statSync(path.join(root, p)).isDirectory() ? `${p}/**` : p); } catch { /* not a path here */ }
  }
  return [...out].slice(0, 3);
}
// An original that is itself an ADR of the project's ADR folder: the new ADR supersedes it by id too.
function adrIdOf(root, adrDir, file) {
  if (!file.startsWith(`${adrDir}/`)) return null;
  return parseAdr(read(path.join(root, file)) || '', file)?.id || null;
}
const fm = (o) => `---\napplies_to: [${o.applies.join(', ')}]\nbible: [${o.bible.join(', ')}]\n${o.supersedes.length ? `supersedes: [${o.supersedes.map((s) => (/^ADR-\d{4}$/.test(s) ? s : `"${s.replace(/"/g, "'")}"`)).join(', ')}]\n` : ''}fit: []\n---\n`;

export function compile(root, flags = {}) {
  const st = kread(root, 'statements.json'), rep = kread(root, 'report.json');
  if (!st || !rep) return fail('fk adopt knowledge: run inventory, extract, candidates, the agents\' verdicts and report first.');
  const res = kread(root, 'resolutions.json', {});
  const dry = !!flags['dry-run'];
  const open = rep.contradictions.filter((c) => !res[c.cluster]);
  if (open.length && !dry) return fail(`fk adopt knowledge compile: ${open.length} contradiction(s) still need the founder: ${open.map((c) => c.cluster).join(', ')}. Record each answer with fk adopt knowledge resolve, or preview with --dry-run.`);
  const date = today(flags);
  const head = git(root, ['rev-parse', '--short=10', 'HEAD']);
  const commit = head.status === 0 ? head.stdout.trim() : 'none';
  const cfg = loadConfig(root), c = cfg.paths;
  const index = !!flags['keep-sources'] || cfg.bible_mode === 'index';
  const byId = new Map(st.statements.map((s) => [s.id, s]));
  const prev = kread(root, 'compiled.json', {});
  const own = new Set(prev.out === 'drafts' ? prev.files || [] : []);

  // What happens to each statement.
  const fate = new Map();
  for (const o of open) for (const id of o.ids) fate.set(id, { status: 'held', cluster: o.cluster });
  for (const r of Object.values(res)) for (const id of r.drop) fate.set(id, { status: r.verdict === 'duplicate' ? 'merged' : r.verdict === 'stale' ? 'stale' : 'superseded', cluster: r.cluster, into: r.keep[0] });
  for (const r of Object.values(res)) for (const id of r.keep) fate.set(id, { status: 'kept', cluster: r.cluster });

  // ADRs: numbered after every ADR already in the repo or in the drafts (except this command's own earlier drafts).
  const nums = [...ls(path.join(root, c.adr)), ...ls(path.join(draftsDir(root), 'adr')).filter((n) => !own.has(`adr/${n}`))].map((n) => Number(/^(\d{3,4})/.exec(n)?.[1] || 0));
  let next = Math.max(0, ...nums) + 1;
  const files = {}, adrs = [], notes = [];
  for (const r of Object.values(res).filter((x) => x.verdict === 'contradiction').sort((a, b) => a.cluster.localeCompare(b.cluster))) {
    const ss = r.ids.map((id) => byId.get(id)).filter(Boolean);
    const kept = r.keep.map((id) => byId.get(id)).filter(Boolean), losers = ss.filter((s) => !r.keep.includes(s.id));
    const newest = [...ss].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
    const name = short(r.note || kept[0]?.text || `${newest.title}: none of the earlier statements holds`, 70).replace(/[.:]$/, '');
    const n = next++, id = `ADR-${pad(n)}`;
    for (const s of ss) fate.set(s.id, { ...fate.get(s.id), adr: id });
    if (r.note) notes.push({ ...newest, id: r.cluster, text: r.note, adr: id, kit: false });
    const verdict = rep.contradictions.find((x) => x.cluster === r.cluster);
    const supersedes = [...losers.map(loc), ...losers.map((s) => adrIdOf(root, c.adr, s.file)).filter(Boolean)];
    const decision = r.note || kept.map((s) => s.text).join('\n') || 'None of the earlier statements holds any more.';
    files[`adr/${pad(n)}-${slugify(name)}.md`] = `${fm({ applies: appliesTo(root, [decision]), bible: [...new Set(ss.filter((s) => s.kind === 'bible').map((s) => bibleKey(s.title)))], supersedes })}# ${pad(n)} — ${name}
Date: ${date} · Status: accepted (founder, knowledge consolidation ${r.cluster})

## Context
The project's documents disagreed (knowledge health check ${r.cluster}):
${ss.map((s) => `- ${loc(s)} (${s.date || 'no date'}): "${s.text}"`).join('\n')}
${verdict?.why ? `Why they conflict: ${verdict.why}\n` : ''}The founder chose: ${r.choice === 'latest' ? 'the newer statement wins' : r.choice === 'both' ? 'both hold, each for its own scope' : r.choice === 'new' ? 'a new wording' : r.choice === 'drop' ? 'neither holds' : `keep ${r.keep.join(', ')}`}.

## Decision
${decision}

## Replaces
${losers.map((s) => `- ${loc(s)} (L${s.lines[0]}, ${s.date || 'no date'})`).join('\n') || '- nothing (all earlier wording now reads as above)'}

## Consequences
- The older wording stays in its document; ${MAP} points from it to this ADR.
`;
    adrs.push({ id, cluster: r.cluster });
  }

  // Everything still standing; statements already in the kit's structure stay where they are.
  const gone = new Set(['merged', 'superseded', 'stale', 'held']);
  const pool = [...st.statements.filter((s) => !gone.has(fate.get(s.id)?.status) && !s.kit && !s.retired), ...notes];
  const tagOf = (s) => s.adr || fate.get(s.id)?.adr || null;
  const dest = new Map(); // statement id -> destinations
  const to = (s, d) => dest.set(s.id, [...(dest.get(s.id) || []), d]);

  // Decisions not settled by a conflict: one ADR per source section.
  const groups = new Map();
  for (const s of pool.filter((x) => x.kind === 'decisions' && !tagOf(x))) groups.set(`${s.file}\n${s.section}`, [...(groups.get(`${s.file}\n${s.section}`) || []), s]);
  for (const ss of groups.values()) {
    const s0 = ss[0], parts = s0.section.split(' > ');
    const name = short(/^(?:decisions?|\(top\))$/i.test(s0.title) ? (parts.length > 1 ? parts[0] : s0.text) : s0.title, 70).replace(/[.:]$/, '');
    const dated = ss.map((s) => s.date).filter(Boolean).sort().pop();
    const n = next++, id = `ADR-${pad(n)}`;
    files[`adr/${pad(n)}-${slugify(name)}.md`] = `${fm({ applies: appliesTo(root, ss.map((s) => s.text)), bible: [], supersedes: [] })}# ${pad(n)} — ${name}
Date: ${dated || date} · Status: accepted (written down in ${loc(s0)} before the kit)

## Context
${dated ? `Recorded in ${loc(s0)} on ${dated}` : `Recorded in ${loc(s0)} (no date in the history)`}; consolidated on ${date}.

## Decision
${ss.map((s) => `- ${s.text}`).join('\n')}
`;
    for (const s of ss) to(s, id);
  }

  // The bible: summaries (at most 3 lines a section); the full list goes to standards/product.md when it does not fit.
  const secs = {};
  for (const s of pool.filter((x) => x.kind === 'bible' || x.kind === 'architecture')) {
    const k = s.kind === 'architecture' ? 'architecture' : bibleKey(s.title);
    (secs[k] ||= []).push(s);
  }
  const overflow = !index && Object.entries(secs).some(([k, x]) => k !== 'architecture' && x.length > 3);
  const bibleSrc = pool.filter((x) => x.kind === 'bible');
  if (Object.keys(secs).length) {
    const readme = read(path.join(root, 'README.md'));
    const project = /^#\s+(.+)$/m.exec(readme || '')?.[1]?.trim() || title(path.basename(root).replace(/[-_]+/g, ' '));
    const lines = fs.readFileSync(TEMPLATE('PROJECT.md'), 'utf8').replace(/\{\{Project\}\}/g, project).replace(/\{\{date\}\}/g, date).split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      out.push(lines[i]);
      const sec = bibleSections(lines[i])[0];
      const items = sec && BIBLE_KEYS.includes(sec.key) ? secs[sec.key] || [] : [];
      if (!items.length) continue;
      if (index) {
        const src = [...items].filter((s) => !/^(?:auto-memory|mempalace)\//.test(s.file)).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0] || items[0];
        out.push(...items.slice(0, 3).map((s) => short(s.text, 160)), `Source of truth: [${src.file}](${path.posix.relative('docs', src.file)}) §${src.title}`);
      } else out.push(...items.slice(0, 3).map((s) => `- ${short(s.text, 160)}${tagOf(s) ? ` (${tagOf(s)})` : ''}`));
      for (const s of items.slice(0, 3)) to(s, `docs/PROJECT.md §${sec.title}${index ? ' (index)' : ''}`);
      while (i + 1 < lines.length && lines[i + 1].trim()) i++;
    }
    let text = out.join('\n');
    if (index) text = text.replace(/^Read this first\..*$/m, 'Read this first. An index: the linked documents are the source of truth; never copy or contradict them. At most 60 lines (`fk bible check`).');
    text = text.replace(/^## Links\n/m, `## Links\n- Knowledge map (where the earlier docs went): [process/knowledge-map.md](process/knowledge-map.md)\n${overflow ? '- Product details: [standards/product.md](standards/product.md)\n' : ''}`);
    files['PROJECT.md'] = text;
  }
  if (overflow) {
    files['standards/product.md'] = `# Product\n\nWhat the product is, for whom and how it trades off, gathered from the project's earlier docs on ${date}; ${'`docs/PROJECT.md`'} summarizes it. Sources: [knowledge map](../process/knowledge-map.md).\n\n`
      + bibleSrc.map((s) => `- ${s.text}${tagOf(s) ? ` (${tagOf(s)})` : ''}`).join('\n') + '\n';
    for (const s of bibleSrc) to(s, 'docs/standards/product.md');
  }

  // Rules and architecture -> standards slots.
  const slots = {};
  const data = fs.existsSync(path.join(root, c.standards, 'data.md')) ? 'data' : 'architecture'; // drydock's data.md, when present
  for (const s of pool.filter((x) => x.kind === 'rules' || x.kind === 'architecture')) {
    const k = slot(s) === 'data' ? data : slot(s);
    if (!(slots[k] ||= []).some((x) => x.text === s.text)) slots[k].push(s);
    to(s, `${c.standards}/${k}.md`);
  }
  const mapLink = path.posix.relative(c.standards, MAP);
  for (const [k, ss] of Object.entries(slots)) {
    files[`standards/${k}.md`] = `# ${title(k)} standards\n\nRules gathered from the project's earlier docs on ${date}; where each came from: [knowledge map](${mapLink}).\n\n${ss.map((s) => `- ${s.text}${tagOf(s) ? ` (${tagOf(s)})` : ''}`).join('\n')}\n`;
  }

  // Lessons and memory items -> lessons (deduplicated against the repo's lessons).
  const existing = parseLessons(read(path.join(root, 'docs', 'process', 'lessons.md')) || '').entries;
  const entries = [];
  for (const s of pool.filter((x) => x.kind === 'lessons' || x.kind === 'memory')) {
    const t = s.text.replace(/[[\]]/g, '').replace(/[.:;!]+$/, '').split(/\s+/).slice(0, 9).join(' ');
    const dup = findDuplicate(existing, t, s.text);
    if (dup) { to(s, `docs/process/lessons.md (already: ${dup.head.title})`); continue; }
    entries.push(`## ${s.date || date} — ${t}  [seen: 1] [severity: med] [paths: **] [status: open]\n- Context: ${s.file} §${s.title}\n- What happened: -\n- Lesson: ${s.text}\n- Evidence: -`);
    to(s, 'docs/process/lessons.md');
  }
  if (entries.length) {
    const pre = (read(TEMPLATE('lessons.md')) || '# Lessons').split(/\nStarter lessons/)[0].trim();
    files['lessons.md'] = `${pre}\n\n${entries.join('\n\n')}\n`;
  }

  // The knowledge map: one row per source section.
  const where = (s) => {
    const f = fate.get(s.id);
    if (f?.status === 'held') return `waiting for the founder (${f.cluster})`;
    if (f?.adr && res[f.cluster]?.note) return `replaced by the founder's wording in ${f.adr}`;
    if (f?.status === 'superseded') return `superseded by ${f.adr || f.cluster}`;
    if (f?.status === 'stale') return 'stale, not carried over';
    if (f?.status === 'merged') return `merged into ${f.into} (${(dest.get(f.into) || []).join(', ') || 'kit'})`;
    if (s.kit) return 'already in the kit structure';
    if (s.retired) return `left in place (the record itself says ${s.retired})`;
    const d = [...(dest.get(s.id) || []), ...(tagOf(s) ? [tagOf(s)] : [])];
    if (d.length) return [...new Set(d)].join(', ');
    return s.kind === 'plans' ? 'left in place (plans: OMC owns them)' : 'left in place (not compiled)';
  };
  const rows = new Map();
  for (const s of st.statements) {
    const k = `${s.file}\n${s.section}`;
    const r = rows.get(k) || { s, date: s.date, went: new Set(), res: new Set() };
    if (s.date && (!r.date || s.date > r.date)) r.date = s.date;
    r.went.add(where(s));
    const f = fate.get(s.id);
    if (f?.cluster) r.res.add(`${f.cluster} ${res[f.cluster]?.choice || 'open'}`);
    rows.set(k, r);
  }
  const decided = Object.values(res).sort((a, b) => a.cluster.localeCompare(b.cluster));
  files['knowledge-map.md'] = `# Knowledge map
<!-- fk:consolidated ${date} commit ${commit} -->
Where the project's earlier docs went when the kit consolidated them on ${date}. From now on the destinations are the source of truth; the originals were left as they were. \`fk knowledge check\` compares later edits of those docs with the accepted decisions and standards.

## Founder decisions
${decided.map((r) => `- ${r.cluster} (${r.verdict}): ${r.choice}${r.note ? ` ("${r.note}")` : ''}${adrs.find((a) => a.cluster === r.cluster) ? ` -> ${adrs.find((a) => a.cluster === r.cluster).id}` : ''}`).join('\n') || '- none needed'}

## Sources
| Source § section | Date | Went to | Resolution |
|---|---|---|---|
${[...rows.values()].map((r) => `| ${cell(r.s.file)} §${cell(r.s.section)} | ${r.date || 'no date'} | ${cell([...r.went].join('; '))} | ${cell([...r.res].join(', ') || '-')} |`).join('\n')}
`;

  // The bible links only what exists after apply: files already in the repo or compiled here.
  if (files['PROJECT.md']) {
    const made = (rel) => fs.existsSync(path.join(root, rel)) || rel === MAP || (rel === 'docs/process/lessons.md' && !!files['lessons.md'])
      || Object.keys(files).some((n) => (n.startsWith('adr/') && `${c.adr}/` === `${rel}/`) || (n.startsWith('standards/') && (`${c.standards}/` === `${rel}/` || `${c.standards}/${n.slice(10)}` === rel)));
    let inLinks = false;
    files['PROJECT.md'] = files['PROJECT.md'].split('\n').filter((l) => {
      if (/^## /.test(l)) inLinks = /^## Links\b/.test(l);
      const href = inLinks && /\]\(([^)#]+)\)/.exec(l)?.[1];
      return !href || /^[a-z]+:/i.test(href) || made(path.posix.normalize(path.posix.join('docs', href)).replace(/\/$/, ''));
    }).join('\n');
  }

  // Targets: create, append (merge, marked) or keep (an existing bible is never replaced).
  const target = (name) => (name === 'PROJECT.md' ? 'docs/PROJECT.md' : name === 'lessons.md' ? 'docs/process/lessons.md' : name === 'knowledge-map.md' ? MAP
    : name.startsWith('adr/') ? `${c.adr}/${name.slice(4)}` : `${c.standards}/${name.slice(10)}`);
  const appendable = (name) => /^(?:lessons\.md|knowledge-map\.md|standards\/)/.test(name);
  const targets = Object.keys(files).sort().map((name) => {
    const t = target(name);
    return { draft: name, target: t, action: fs.existsSync(path.join(root, t)) ? (appendable(name) ? 'append' : 'keep') : 'create' };
  });
  const outDir = dry ? kfile(root, 'preview') : draftsDir(root);
  if (dry) fs.rmSync(outDir, { recursive: true, force: true });
  else for (const f of own) fs.rmSync(path.join(outDir, f), { force: true });
  const written = [];
  for (const [name, text] of Object.entries(files)) {
    const abs = path.join(outDir, name);
    const theirs = !dry && fs.existsSync(abs); // a draft written earlier in A2 by an agent: never replaced
    if (theirs && name === 'PROJECT.md') { kwrite(root, 'bible.md', text); say(`kept    drafts/PROJECT.md (written earlier); the compiled bible is in ${kfile(root, 'bible.md')} to merge by hand`); continue; }
    if (theirs) { const old = fs.readFileSync(abs, 'utf8'); const body = name === 'lessons.md' ? entriesOf(text) : text.slice(text.indexOf('\n## ') + 1); if (body.trim() && !old.includes(body.trim())) fs.writeFileSync(abs, `${old.trimEnd()}\n\n${body}`); continue; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
    written.push(name);
  }

  // Originals: annotated only by `fk adopt apply --annotate` (founder approval). Agent rule files: never rewritten.
  // Per original: what happened to each section ("§Vision superseded by ADR-0002", "§Git workflow -> docs/standards/process.md").
  const sources = {};
  for (const s of st.statements) {
    const f = fate.get(s.id), o = (sources[s.file] ||= { sections: {} });
    const d = (dest.get(f?.status === 'merged' ? f.into : s.id) || []).filter((x) => !x.endsWith('(index)')).map((x) => x.replace(/ §.*| \(.*$/, ''));
    // One part per destination ("-> x"); annotate() joins them under one arrow.
    const parts = f?.status === 'superseded' ? [`superseded by ${f.adr || f.cluster}`] : f?.status === 'stale' ? ['out of date']
      : [...d, ...(tagOf(s) && f?.status === 'kept' ? [tagOf(s)] : [])].map((x) => `-> ${x}`);
    if (parts.length) o.sections[s.title] = [...new Set([...(o.sections[s.title] || []), ...parts])];
  }
  kwrite(root, 'compiled.json', { date, commit, out: dry ? 'preview' : 'drafts', bible_mode: files['PROJECT.md'] ? (index ? 'index' : 'own') : null, files: dry ? [] : written, targets, sources });
  const moved = (f) => Object.keys(sources[f].sections).length > 0;
  const agents = Object.keys(sources).filter((f) => AGENT.test(f) && moved(f));
  const pointer = '## Project knowledge\n- Read docs/PROJECT.md first. Decisions: docs/adr/. Rules: docs/standards/. Where the older docs went: docs/process/knowledge-map.md.\n';
  kwrite(root, 'agent-pointer.md', pointer);

  say(`fk adopt knowledge compile${dry ? ' (dry run)' : ''}: nothing in the project changed.`);
  const what = (t) => (t.draft.startsWith('adr/') ? 'decision' : t.draft === 'PROJECT.md' ? `bible, ${index ? 'index' : 'own'} mode` : t.draft === 'knowledge-map.md' ? 'source -> destination map' : 'entries');
  for (const t of targets) say(`${t.action.padEnd(7)} ${t.target} (${what(t)})`);
  const notable = Object.keys(sources).filter((f) => moved(f) && annotatable(root, f)).length;
  say(`Original docs stay as they are. With the founder's yes, \`fk adopt apply --annotate\` adds one header line to each of the ${notable} consolidated original doc(s); agent rule files, notes and memory are never touched.`);
  if (agents.length) say(`Agent rule files (${agents.join(', ')}) are never rewritten. Proposed pointer section (2 lines; CLAUDE.md would have ${claudeMdLines(root) + 2}/40 lines): ${kfile(root, 'agent-pointer.md')}`);
  say(dry ? `Preview: ${outDir}. Run without --dry-run to turn it into drafts for fk adopt apply.` : `Drafts: ${outDir}. Next: fk adopt apply installs them (existing files are appended to and marked, never replaced).`);
}

// ---- used by fk adopt apply ----
const APPENDABLE = /^(?:lessons\.md|knowledge-map\.md|standards\/)/;
export function compiledDraft(root, name) {
  const kc = kread(root, 'compiled.json');
  return !!kc && kc.out === 'drafts' && (kc.files || []).includes(name) && APPENDABLE.test(name);
}
// Append a compiled draft to an existing kit file under a review marker; false when it is already there.
export function appendDraft(abs, name, text, date) {
  const old = fs.readFileSync(abs, 'utf8');
  const body = (name === 'lessons.md' ? entriesOf(text) : text.split('\n').slice(1).join('\n')).trim();
  if (!body || old.includes(body)) return false;
  fs.writeFileSync(abs, `${old.trimEnd()}\n\n<!-- fk:knowledge appended ${date}: consolidated from the earlier docs; review and merge -->\n${body}\n`);
  return true;
}
// Originals that may carry a header: project docs, not agent rule files, notes, memory or the kit's own files.
function annotatable(root, file) {
  const c = loadConfig(root).paths;
  return /\.(?:md|mdx|markdown|txt)$/i.test(file) && !AGENT.test(file) && !/^(?:\.omc|auto-memory|mempalace)\//.test(file)
    && !(file === 'docs/PROJECT.md' || file === c.constraints || file.startsWith(`${c.adr}/`) || file.startsWith(`${c.standards}/`) || file === 'docs/process/lessons.md');
}
// One header line on each consolidated original (tracked, clean, not an agent rule file, not memory or .omc).
export function annotate(root, dirty, date) {
  const kc = kread(root, 'compiled.json');
  if (!kc || !fs.existsSync(path.join(root, MAP))) return [];
  const tracked = new Set(git(root, ['ls-files', '-z']).stdout.split('\0').filter(Boolean));
  const out = [];
  for (const [file, o] of Object.entries(kc.sources || {}).sort()) {
    const parts = Object.entries(o.sections).map(([t, p]) => {
      const to = p.filter((x) => x.startsWith('-> ')).map((x) => x.slice(3));
      return `§${t} ${[...(to.length ? [`-> ${[...new Set(to)].join(', ')}`] : []), ...p.filter((x) => !x.startsWith('-> '))].join(', ')}`;
    });
    if (!parts.length || !annotatable(root, file) || !tracked.has(file) || dirty.has(file)) continue;
    const abs = path.join(root, file);
    const text = fs.readFileSync(abs, 'utf8');
    if (/\(fk knowledge-map\)/.test(text.split(/\r?\n/).slice(0, 8).join('\n'))) continue;
    const header = `> Consolidated on ${date} (fk knowledge-map): ${parts.slice(0, 3).join('; ')}${parts.length > 3 ? `; ${parts.length - 3} more section(s) in ${MAP}` : ''}.`;
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const at = lines[0] === '---' && lines.indexOf('---', 1) > 0 ? lines.indexOf('---', 1) + 1 : 0;
    lines.splice(at, 0, header, '');
    fs.writeFileSync(abs, lines.join(eol));
    out.push({ file, header });
  }
  return out;
}
