// fk knowledge check [--json] [--since <commit|YYYY-MM-DD>]: after a knowledge consolidation (docs/process/knowledge-map.md
// carries its date and commit), re-read only the project docs changed since then, extract their new statements and pair
// each with accepted ADRs, standards and bible lines on the same topic. The pairs are candidates for an agent to judge
// (OMC's analyst, read-only); the CLI never decides. Cached in the kit state (knowledge-check.json): fk audit and the
// weekly session note read the cache, so no hook runs git or an LLM.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readJson, writeJson, stateFile, loadConfig } from '../../hooks/lib.mjs';
import { loadIndex, activeAdr, BIBLE, BIBLE_KEYS } from '../../hooks/knowledge.mjs';
import { say, git, needRoot, parseArgs } from './adopt/util.mjs';
import { isKnowledge, kitPath, fileKind, describe, readSource, statementsOf, similarity, signals, words, entities, THRESHOLD } from './adopt/knowledge.mjs';
import { MAP, lastMarker } from './adopt/compile.mjs';

export const CACHE = 'knowledge-check.json';
export const APPLIED = 'knowledge-applied.json'; // fk adopt apply: the docs it touched (hash) and the lines it added
export const sha1 = (t) => crypto.createHash('sha1').update(String(t)).digest('hex');
// Recall without noise: the statement kind counts as a topic word, and a reversal word on either side lowers the bar
// for a pair that shares at least one topic keyword.
const REVERSAL = /\b(?:never|no longer|retired?|back|instead|stop(?:ped)?|drop(?:ped)?)\b/i;
const LOW = 0.25;
const kinded = (s) => ({ ...s, topic: [...(s.topic || []), `kind:${s.kind}`] });
// A reversal ("back", "no longer", "never") lowers the bar: further with two shared keywords, so a change of direction
// is caught wherever it is written (meeting notes, NOTES.md), not only in files named like a vision doc.
const shared = (n, a) => n.keywords.filter((w) => a.keywords.includes(w)).length;
const bar = (n, a) => (REVERSAL.test(n.text) || REVERSAL.test(a.text) ? (shared(n, a) >= 2 ? 0.2 : shared(n, a) ? LOW : THRESHOLD) : THRESHOLD);
const mtime = (abs) => { try { return fs.statSync(abs).mtimeMs; } catch { return 0; } };
const ls = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const pick = (s) => ({ file: s.file, section: s.section, lines: s.lines, text: s.text, ...(s.ref ? { ref: s.ref } : {}) });

// Changed line ranges per file since `base` (working tree included); untracked files count whole.
function changes(root, base) {
  const out = new Map();
  if (base) {
    let file = null;
    for (const l of git(root, ['diff', '-U0', '--no-color', '--no-renames', '--no-ext-diff', base, '--']).stdout.split('\n')) {
      if (l.startsWith('+++ ')) { file = l === '+++ /dev/null' ? null : l.slice(6); if (file && !out.has(file)) out.set(file, []); continue; }
      const h = file && /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(l);
      if (h && Number(h[2] ?? 1) > 0) out.get(file).push([Number(h[1]), Number(h[1]) + Number(h[2] ?? 1) - 1]);
    }
  }
  for (const f of git(root, ['ls-files', '--others', '--exclude-standard']).stdout.split('\n').filter(Boolean)) out.set(f, 'all');
  return out;
}

// The accepted side: active ADRs (title + Decision), standards, and the bible's summary sections.
async function accepted(root) {
  const c = loadConfig(root).paths;
  const out = [];
  const add = (file, kind, keepSection, ref) => {
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) return;
    const src = describe(root, file, kind, fs.statSync(abs), null);
    src.sections = src.sections.filter((s) => keepSection(s.title));
    out.push(...statementsOf(root, src, readSource(root, file) || '').map((s) => ({ ...s, ref: ref || `${file} §${s.title}` })));
  };
  for (const a of (await loadIndex(root, ['knowledge'])).knowledge.adrs.filter(activeAdr)) {
    add(a.file, 'decisions', (t) => /^decision\b/i.test(t), a.id);
    out.push({ file: a.file, section: 'title', title: a.title, lines: [1, 1], kind: 'decisions', kit: true, text: a.title, ref: a.id, keywords: words(a.title), topic: [], entities: entities(` ${a.title}`) });
  }
  for (const f of ls(path.join(root, c.standards)).filter((n) => n.endsWith('.md'))) add(`${c.standards}/${f}`, 'rules', () => true);
  add(BIBLE, 'bible', (t) => BIBLE_KEYS.includes(t.toLowerCase().split(/[\s(]/)[0]));
  return out;
}

export async function check(root, flags = {}) {
  let map = '';
  try { map = fs.readFileSync(path.join(root, MAP), 'utf8'); } catch { /* not consolidated */ }
  const m = lastMarker(map);
  const since = flags.since ? String(flags.since) : m ? (m.commit !== 'none' ? m.commit : m.date) : null;
  if (!since) return { consolidated: false };
  let base = since;
  if (/^\d{4}-\d{2}-\d{2}$/.test(since)) base = git(root, ['rev-list', '-1', `--before=${since}T23:59:59`, 'HEAD']).stdout.trim();
  else if (git(root, ['rev-parse', '--verify', '-q', `${since}^{commit}`]).status !== 0) base = '';
  const ch = changes(root, base);
  const files = [...ch.keys()].filter((f) => isKnowledge(f) && !kitPath(root, f) && !f.startsWith('.omc/')).sort();
  const c = loadConfig(root).paths;
  const kit = [BIBLE, ...ls(path.join(root, c.adr)).map((n) => `${c.adr}/${n}`), ...ls(path.join(root, c.standards)).map((n) => `${c.standards}/${n}`)];
  const key = crypto.createHash('sha1').update(JSON.stringify([since, base, git(root, ['rev-parse', 'HEAD']).stdout.trim(),
    files.map((f) => [f, ch.get(f), mtime(path.join(root, f))]), kit.map((f) => [f, mtime(path.join(root, f))])])).digest('hex');
  const file = stateFile(root, CACHE);
  const cached = readJson(file, null);
  if (cached?.key === key) return cached;
  // The consolidation's own edits (apply's header and pointer lines) are the baseline, not new claims.
  const applied = readJson(stateFile(root, APPLIED), { files: {}, added: {} });
  const fresh = [];
  for (const f of files) {
    const abs = path.join(root, f), r = ch.get(f);
    const st = fs.statSync(abs);
    if (st.size > 512 * 1024) continue;
    const text = readSource(root, f) || '';
    if (applied.files?.[f] && applied.files[f] === sha1(text)) continue; // unchanged since apply wrote it
    const own = new Set((applied.added?.[f] || []).map(norm));
    fresh.push(...statementsOf(root, describe(root, f, fileKind(root, f), st, null), text, r === 'all' ? null : (a, b) => r.some(([x, y]) => a <= y && b >= x))
      .filter((s) => !s.retired && !own.has(norm(s.text))));
  }
  const acc = await accepted(root);
  const clusters = [];
  for (const n of fresh) {
    if (acc.some((a) => norm(a.text) === norm(n.text))) continue; // the accepted wording itself, not a new claim
    const nk = kinded(n);
    const hits = acc.map((a) => [similarity(nk, kinded(a)), a]).filter(([s, a]) => s >= bar(n, a)).sort((x, y) => y[0] - x[0])
      .filter(([, a], i, all) => all.findIndex(([, b]) => b.ref === a.ref) === i).slice(0, 3);
    if (hits.length) clusters.push({ id: `K-${String(clusters.length + 1).padStart(3, '0')}`, new: pick(n), accepted: hits.map(([s, a]) => ({ ...pick(a), score: Number(s.toFixed(2)) })), signals: signals([n, ...hits.map((h) => h[1])]) });
  }
  const result = { key, ts: new Date().toISOString(), consolidated: true, since: { ...m, base: base.slice(0, 10) || null }, changed: files, statements: fresh.length, clusters };
  writeJson(file, result);
  fs.writeFileSync(stateFile(root, 'knowledge-check.md'), `# Knowledge check: new statements next to accepted ones\n\nRead only this file. For each pair decide: contradiction (the new statement goes against the accepted decision or standard), duplicate, or ok. A contradiction needs the founder: either the new doc is wrong (fix it) or the decision changes (a new ADR that supersedes the old one).\n\n`
    + clusters.map((k) => `## ${k.id}\n- new: ${k.new.file} §${k.new.section} L${k.new.lines[0]}: "${k.new.text}"\n${k.accepted.map((a) => `- accepted: ${a.ref}: "${a.text}"`).join('\n')}\n`).join('\n'));
  return result;
}

export default async function knowledge(args) {
  const { pos, flags } = parseArgs(args);
  if (pos[0] !== 'check') { say('usage: fk knowledge check [--json] [--since <commit|YYYY-MM-DD>]'); process.exitCode = 1; return; }
  const root = needRoot();
  const r = await check(root, flags);
  if (flags.json) return say(JSON.stringify(r, null, 2));
  if (!r.consolidated) return say(`fk knowledge: no consolidation recorded yet (${MAP}); run the fk-adopt knowledge steps first, or pass --since <commit|date>.`);
  say(`fk knowledge check: ${r.changed.length} doc(s) changed since the consolidation${r.since.date ? ` on ${r.since.date}` : ''}: ${r.statements} new statement(s); ${r.clusters.length} may contradict accepted decisions or standards.`);
  for (const k of r.clusters.slice(0, 10)) say(`- ${k.id} ${k.new.file} L${k.new.lines[0]} "${k.new.text.slice(0, 80)}" ~ ${k.accepted.map((a) => a.ref).join(', ')}${k.signals.includes('negation') ? ' (one says no)' : ''}`);
  if (r.clusters.length) say(`Ask OMC's analyst (read-only) to judge them: ${stateFile(root, 'knowledge-check.md')}. A real contradiction becomes a superseding ADR, or a fix to the doc.`);
}
