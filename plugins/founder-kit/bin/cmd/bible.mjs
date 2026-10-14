// fk bible init [--name <Project>] [--index <doc>[,<doc>]] | touch <section>... | check [--strict]
// docs/PROJECT.md is the project's north star: at most 60 lines that summarize and link (template: fk-process
// templates/PROJECT.md). Mode "own" holds the summaries; mode "index" (the project already has a vision doc, GDD or
// PRD) only points at that source of truth. Each section heading carries <!-- fk:updated YYYY-MM-DD -->; an accepted
// ADR with bible: [<section>] dated later makes that section stale. setNow() is the one writer of the "## Now" lines.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from '../../hooks/lib.mjs';
import { say, needRoot, parseArgs, today, fkWrite, git } from './adopt/util.mjs';
import { BIBLE, BIBLE_KEYS, MARK, bibleSections, loadIndex, activeAdr } from '../../hooks/knowledge.mjs';

const TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', 'fk-process', 'templates', 'PROJECT.md');
export const MAX_LINES = 60;
const HTML_TAG = /^\/?(?:a|abbr|b|br|center|code|details|div|em|hr|i|img|kbd|li|mark|ol|p|picture|pre|s|small|source|span|strong|sub|summary|sup|table|tbody|td|th|thead|tr|u|ul|video)(?:\s[^>]*)?\/?$/i;
const short = (s, n = 40) => (s.length > n ? `${s.slice(0, n - 2)}…>` : s);
const USAGE = 'usage: fk bible init [--name <Project>] [--index <doc>[,<doc>]] | fk bible touch <section>... | fk bible check [--strict]';

export async function checkBible(root) {
  let text;
  try { text = fs.readFileSync(path.join(root, BIBLE), 'utf8'); } catch { return { missing: true, lines: 0, warnings: [`${BIBLE} is missing (create it with fk bible init)`], stale: [] }; }
  const lines = text.replace(/\s+$/, '').split(/\r?\n/).length;
  const warnings = [];
  if (lines > MAX_LINES) warnings.push(`${BIBLE} has ${lines} lines, over ${MAX_LINES}: summarize and link instead of copying`);
  const dir = path.dirname(path.join(root, BIBLE));
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)) {
    const target = m[1].split('#')[0];
    if (!target || /^[a-z][\w+.-]*:/i.test(target) || /[<>{}]/.test(target)) continue; // URL, anchor or placeholder
    if (!fs.existsSync(path.resolve(dir, target))) warnings.push(`broken link: ${m[1]}`);
  }
  // Unfilled template slots ("<one or two sentences…>"), outside code; HTML tags, comments and autolinks are not slots.
  const prose = text.replace(/```[\s\S]*?```|`[^`\n]*`|<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  const slots = [...prose.matchAll(/<([^<>\n]+)>/g)].filter((m) => !HTML_TAG.test(m[1]) && !/:\/\/|@/.test(m[1]));
  if (slots.length) warnings.push(`${slots.length} unfilled placeholder(s), first ${short(slots[0][0])} on line ${prose.slice(0, slots[0].index).split('\n').length}: replace each with a short summary`);
  const k = (await loadIndex(root, ['knowledge'])).knowledge;
  const stale = k.bible_stale || [];
  const bibleOf = (a) => a.bible.length || a.supersedes.some((s) => k.adrs.find((x) => x.id === s)?.bible.length);
  for (const a of k.adrs.filter((x) => activeAdr(x) && !x.date && bibleOf(x))) warnings.push(`${a.id} has no date (Date: YYYY-MM-DD), so the bible sections it changes are not checked for staleness`);
  for (const s of stale) warnings.push(`§${s.section} may be stale: ${s.adrs.join(', ')} (accepted ${s.since}) changed it; update the section${readJson(path.join(root, '.fk', 'config.json'), {}).bible_mode === 'index' ? ' or the source doc it links' : ''}, then fk bible touch ${s.key}`);
  return { missing: false, lines, warnings, stale };
}

// Replace (or add) "- <Field>: value" lines inside "## Now"; false when there is no bible or no Now section.
export function setNow(root, fields) {
  const file = path.join(root, BIBLE);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return false; }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Now\b/i.test(l));
  if (start < 0) return false;
  let end = lines.findIndex((l, i) => i > start && /^#{1,2}\s/.test(l));
  if (end < 0) end = lines.length;
  for (const [k, v] of Object.entries(fields)) {
    const at = lines.findIndex((l, i) => i > start && i < end && new RegExp(`^\\s*[-*]\\s*${k}\\s*:`, 'i').test(l));
    if (at >= 0) { lines[at] = `- ${k}: ${v}`; continue; }
    let last = end;
    while (last - 1 > start && !lines[last - 1].trim()) last--;
    lines.splice(last, 0, `- ${k}: ${v}`);
    end++;
  }
  fs.writeFileSync(file, lines.join(eol));
  return true;
}

// .fk/config.json bible_mode: own | index (through the kit's sanctioned writer, so the gate guard sees no tamper).
export function recordMode(root, mode) {
  const rel = '.fk/config.json';
  if (!fs.existsSync(path.join(root, rel))) return;
  const cfg = readJson(path.join(root, rel), {});
  if (cfg.bible_mode !== mode) fkWrite(root, rel, { ...cfg, bible_mode: mode });
}

function init(root, flags) {
  const file = path.join(root, BIBLE);
  if (fs.existsSync(file)) return say(`kept    ${BIBLE} (already there)`);
  const name = String(flags.name || path.basename(root)).replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  let text = fs.readFileSync(TEMPLATE, 'utf8').replace(/\{\{Project\}\}/g, name).replace(/\{\{date\}\}/g, today(flags));
  const sources = [].concat(flags.index ?? []).flatMap((x) => String(x).split(',')).map((x) => x.trim()).filter(Boolean);
  if (sources.length) { // index mode: every summary section points at the project's own source of truth
    const link = sources.map((s) => `[${s}](${path.posix.relative(path.posix.dirname(BIBLE), s.split(path.sep).join('/'))})`).join(', ');
    const lines = text.split('\n'), out = [];
    for (let i = 0; i < lines.length; i++) {
      out.push(lines[i]);
      const sec = bibleSections(lines[i])[0];
      if (!sec || !BIBLE_KEYS.includes(sec.key)) continue;
      out.push('<up to 3 lines: what it says, in short>', `Source of truth: ${link} §<section>`);
      while (i + 1 < lines.length && lines[i + 1].trim()) i++; // drop the template's own placeholder lines
    }
    text = out.join('\n').replace(/^Read this first\..*$/m, 'Read this first. An index: the linked documents are the source of truth; never copy or contradict them. At most 60 lines (`fk bible check`).');
    // Links: the sources plus the kit folders that exist; the own-mode summaries (constraints, architecture) are not linked.
    const keep = (l) => { const t = /\]\(([^)\s]+)\)/.exec(l)?.[1]; return t && !/^- (?:Constraints|Architecture):/.test(l) && fs.existsSync(path.resolve(root, path.dirname(BIBLE), t)); };
    text = text.replace(/^## Links\n([\s\S]*)$/m, (all, body) => `${['## Links', `- Source of truth: ${link}`, ...body.split('\n').filter(keep)].join('\n')}\n`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  recordMode(root, sources.length ? 'index' : 'own');
  say(`created ${BIBLE} (${sources.length ? 'index of ' + sources.join(', ') : 'own summaries'}). Fill each section with a short summary and a link (no copied content); keep it within ${MAX_LINES} lines.`);
}

// A section's body: the lines under its heading up to the next ## heading (line endings and outer blank lines ignored).
const sectionBody = (text, key) => {
  const lines = String(text).split(/\r?\n/);
  const s = bibleSections(text).find((x) => x.key === key);
  if (!s) return null;
  let end = lines.findIndex((l, i) => i > s.line && /^##?\s/.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(s.line + 1, end).join('\n').trim();
};

// A stale section is marked updated only when its text changed since the accepted ADR made it stale: compared with the
// last commit of the bible before that ADR's date. (No such commit: nothing to compare, so it is taken as updated.)
async function touch(root, keys) {
  const file = path.join(root, BIBLE);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { say(`fk bible: ${BIBLE} is missing.`); process.exitCode = 1; return; }
  const want = keys.map((k) => k.toLowerCase().replace(/^§/, ''));
  const stale = (await checkBible(root)).stale || [];
  const unchanged = [];
  for (const s of stale.filter((x) => want.includes(x.key))) {
    const c = git(root, ['log', '-1', `--before=${s.since}T00:00:00`, '--format=%H', '--', BIBLE]).stdout.trim();
    const old = c ? git(root, ['show', `${c}:${BIBLE}`]) : null;
    if (old?.status === 0 && sectionBody(old.stdout, s.key) === sectionBody(text, s.key)) unchanged.push(s);
  }
  for (const s of unchanged) say(`fk bible: §${s.section} is unchanged since ${s.adrs.join(', ')} (accepted ${s.since}) made it stale; update its text first, then run this again.`);
  if (unchanged.length) { process.exitCode = 1; return; }
  const lines = text.split(/\r?\n/);
  const done = [];
  for (const s of bibleSections(text)) {
    if (!want.includes(s.key)) continue;
    lines[s.line] = `${lines[s.line].replace(MARK, '').trimEnd()} <!-- fk:updated ${today()} -->`;
    done.push(s.key);
  }
  const missing = want.filter((k) => !done.includes(k));
  if (missing.length) { say(`fk bible: no section ${missing.join(', ')} (sections: ${BIBLE_KEYS.join(', ')}).`); process.exitCode = 1; }
  if (!done.length) return;
  fs.writeFileSync(file, lines.join(text.includes('\r\n') ? '\r\n' : '\n'));
  say(`fk bible: marked ${want.filter((k) => done.includes(k)).join(', ')} as updated ${today()}.`);
}

async function check(root, flags) {
  const r = await checkBible(root);
  if (!r.warnings.length) return say(`fk bible: ${BIBLE} ${r.lines}/${MAX_LINES} lines, links ok, no stale sections.`);
  for (const w of r.warnings) say(`fk bible: WARNING ${w}.`);
  if (flags.strict) process.exitCode = 1;
}

export default async function bible(args) {
  const { pos, flags } = parseArgs(args);
  const root = needRoot();
  const sub = { init: () => init(root, flags), check: () => check(root, flags), touch: () => touch(root, pos.slice(1)) }[pos[0]];
  if (sub && (pos[0] !== 'touch' || pos[1])) return sub();
  say(USAGE); process.exitCode = 1;
}
