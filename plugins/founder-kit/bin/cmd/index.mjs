// fk index [--json]: (re)build the knowledge index in the kit state dir (<state>/index.json, never committed):
// ADRs (status, supersedes, applies_to, fit), lessons, tasks (files, cited ADRs and lessons, backlinks), standards.
// Every reader rebuilds it lazily when a source file changed; this command only shows it.
// drift(): the knowledge part of `fk audit`, in plain words.
import fs from 'node:fs';
import path from 'node:path';
import { stateFile } from '../../hooks/lib.mjs';
import { loadIndex, activeAdr, relevant, BIBLE } from '../../hooks/knowledge.mjs';
import { say, needRoot, parseArgs, git, today } from './adopt/util.mjs';

const LESSON_DAYS = 14;
// History is allowed to name what it named then: ADRs themselves, task records, the journal, archives.
const HISTORY = ['docs/adr', 'docs/tasks', 'docs/archive', 'docs/process/journal.md', 'docs/process/lessons-archive.md'];

export async function drift(root, flags = {}) {
  const idx = await loadIndex(root);
  const k = idx.knowledge, out = [];
  const byId = new Map(k.adrs.map((a) => [a.id, a]));
  // 1. Closed tasks that changed an ADR-covered area without citing the ADR.
  for (const t of idx.tasks.items.filter((x) => x.done && x.files.length)) {
    for (const h of relevant(k, t.files).filter((x) => x.kind === 'adr' && !t.cites.includes(x.id))) {
      const f = t.files.find((p) => relevant(k, [p]).some((x) => x.id === h.id));
      out.push(`${t.id} changed ${f}, an area ${h.id} (${h.title}) covers, but its Context did not cite ${h.id}.`);
    }
  }
  // 2. Code and docs that still name a superseded ADR.
  const old = k.adrs.filter((a) => a.status === 'superseded');
  if (old.length) {
    const nums = old.map((a) => a.id.slice(4)).join('|');
    const r = git(root, ['grep', '-n', '-I', '--untracked', '-E', `ADR-?(${nums})\\b`, '--', '.', ...HISTORY.map((h) => `:(exclude)${h}`)]);
    const seen = new Set();
    for (const l of r.stdout.split('\n').filter(Boolean)) {
      const m = /^(.+?):(\d+):(.*)$/.exec(l);
      if (!m) continue;
      for (const id of [...m[3].matchAll(/ADR-?(\d{4})\b/g)].map((x) => `ADR-${x[1]}`).filter((id) => byId.get(id)?.status === 'superseded')) {
        if (seen.has(`${m[1]}|${id}`)) continue;
        seen.add(`${m[1]}|${id}`);
        const by = byId.get(id).superseded_by;
        out.push(`${m[1]}:${m[2]} still names ${id}, which ${by ? `${by} superseded` : 'is superseded'}.`);
      }
    }
  }
  // 3. Lessons seen twice or more, still open after two weeks.
  const now = Date.parse(today(flags));
  for (const l of k.lessons) {
    const days = Math.floor((now - Date.parse(l.date)) / 864e5);
    if (/^open/i.test(l.status) && l.seen >= 2 && days > LESSON_DAYS) out.push(`Lesson ${l.id} (${l.title}) was seen ${l.seen} times and is still open after ${days} days: promote it (fk lessons promote-candidates).`);
  }
  // 4. The bible's Now section behind the latest finished task.
  const last = idx.tasks.items.filter((t) => t.done).sort((a, b) => Date.parse(b.done) - Date.parse(a.done))[0];
  let bible = null;
  try { bible = fs.readFileSync(path.join(root, BIBLE), 'utf8'); } catch { /* none */ }
  if (bible && last) {
    const now = /^##\s+Now\b[\s\S]*?(?=^##\s|(?![\s\S]))/m.exec(bible)?.[0] || '';
    if (!new RegExp(`\\b${last.id}\\b`).test(now)) out.push(`${BIBLE} "Now" does not mention the latest finished task ${last.id}; fk task done updates it.`);
  }
  // 5. Bible sections an accepted ADR changed after they were last updated.
  for (const st of k.bible_stale || []) out.push(`${BIBLE} §${st.section} may be stale: ${st.adrs.join(', ')} (accepted ${st.since}) changed it; update it, then fk bible touch ${st.key}.`);
  return { lines: out, checked: k.adrs.length + k.lessons.length + (bible ? 1 : 0) };
}

export default async function index(args) {
  const { flags } = parseArgs(args);
  const root = needRoot();
  const idx = await loadIndex(root);
  if (flags.json) return say(JSON.stringify(idx, null, 2));
  const k = idx.knowledge, t = idx.tasks;
  const adrs = k.adrs.length ? `${k.adrs.length} ADRs (${k.adrs.filter(activeAdr).length} accepted, ${k.adrs.filter((a) => a.status === 'superseded').length} superseded, ${k.adrs.filter((a) => a.applies_to.length).length} with applies_to, ${k.adrs.filter((a) => a.fit.length).length} with fit rules)` : '0 ADRs';
  say(`fk index: ${adrs}, ${k.lessons.length} lessons, ${t.items.length} tasks, ${k.standards.length} standards files.`);
  say(`Written to ${stateFile(root, 'index.json')} (kit state, not committed).`);
}
