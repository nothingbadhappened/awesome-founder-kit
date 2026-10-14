// SessionStart (startup/clear): at most once a week, one line when the last `fk knowledge check` (run by fk audit or by
// hand) found doc statements that may contradict accepted decisions or standards. Reads the cached result only: no git.
import path from 'node:path';
import { readJson, writeJson, fkHome, rootKey, stateFile } from '../lib.mjs';

const WEEK = 7 * 24 * 60 * 60 * 1000;

export default function knowledgeNote({ root, now = Date.now() }) {
  try {
    const n = readJson(stateFile(root, 'knowledge-check.json'), null)?.clusters?.length;
    if (!n) return undefined;
    const file = path.join(fkHome(), 'knowledge-notes.json');
    const key = rootKey(root);
    const seen = readJson(file, {});
    if (now - (seen[key] || 0) < WEEK) return undefined;
    writeJson(file, { ...seen, [key]: now });
    return `fk: ${n} statement(s) in docs changed since the knowledge consolidation may contradict accepted decisions or standards. When there is a quiet moment, ask OMC's analyst to judge them (fk knowledge check).`;
  } catch { return undefined; }
}
