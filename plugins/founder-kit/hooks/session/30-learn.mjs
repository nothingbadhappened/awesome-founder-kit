// SessionStart (startup/clear): at most once a week, a one-line note when lessons qualify for promotion.
// Reads only the "## " header lines of docs/process/lessons.md; the throttle lives in <FK_HOME> (~/.fk) (never in the project's .fk/,
// whose files are snapshotted for the gate guard).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readJson, writeJson, fkHome, rootKey } from '../lib.mjs';
import { parseHead, isCandidate, FILE } from '../../bin/cmd/lessons.mjs';

const WEEK = 7 * 24 * 60 * 60 * 1000;

export default function learnNote({ root }) {
  try {
    let text;
    try { text = fs.readFileSync(path.join(root, FILE), 'utf8'); } catch { return undefined; }
    const n = text.split(/\r?\n/).filter((l) => l.startsWith('## ')).map(parseHead).filter((h) => h && isCandidate(h)).length;
    if (!n) return undefined;
    const file = path.join(fkHome(), 'learn-notes.json');
    const key = rootKey(root);
    const seen = readJson(file, {});
    if (Date.now() - (seen[key] || 0) < WEEK) return undefined;
    writeJson(file, { ...seen, [key]: Date.now() });
    return `fk: ${n} lesson(s) in ${FILE} qualify for promotion (seen >= 2 or severity high). When there is a quiet moment, ask OMC's critic to promote them (fk lessons promote-candidates).`;
  } catch { return undefined; }
}
