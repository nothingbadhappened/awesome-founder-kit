// SessionStart (startup/clear): at most once a week, one line when a bible section has been stale for over 7 days
// (an accepted ADR with bible: [<section>] is newer than the section's fk:updated marker). Reads the cached index the
// read-first note already loaded; the throttle lives in <FK_HOME> (~/.fk), keyed by project.
import path from 'node:path';
import { readJson, writeJson, fkHome, rootKey } from '../lib.mjs';
import { loadIndex, BIBLE } from '../knowledge.mjs';

const DAY = 24 * 60 * 60 * 1000;

export default async function bibleNote({ root, now = Date.now() }) {
  try {
    const old = ((await loadIndex(root, ['knowledge'])).knowledge?.bible_stale || []).filter((s) => now - Date.parse(s.since) > 7 * DAY);
    if (!old.length) return undefined;
    const file = path.join(fkHome(), 'bible-notes.json');
    const key = rootKey(root);
    const seen = readJson(file, {});
    if (now - (seen[key] || 0) < 7 * DAY) return undefined;
    writeJson(file, { ...seen, [key]: now });
    return `fk: update ${BIBLE} ${old.map((s) => `§${s.section}`).join(', ')} (fk bible check): ${[...new Set(old.flatMap((s) => s.adrs))].slice(0, 3).join(', ')} changed it over a week ago.`;
  } catch { return undefined; }
}
