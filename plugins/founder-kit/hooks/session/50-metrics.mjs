// SessionStart (startup/clear): at most once a week, a one-line note when 3 or more tasks closed since the last
// `fk metrics` summary. Reads two small JSON files; the throttle lives in <FK_HOME> (~/.fk), keyed like fk metrics.
import path from 'node:path';
import crypto from 'node:crypto';
import { readJson, writeJson, fkHome, stateFile, rootKey } from '../lib.mjs';

const WEEK = 7 * 24 * 60 * 60 * 1000;

export default function metricsNote({ root, now = Date.now() }) {
  try {
    const file = path.join(fkHome(), 'metrics-notes.json');
    const key = rootKey(root);
    const all = readJson(file, {});
    const seen = all[key] || {};
    if (now - (seen.noted || 0) < WEEK) return undefined;
    const tasks = Object.values(readJson(stateFile(root, 'tasks.json'), {}).tasks || {});
    const closed = tasks.filter((t) => t.done && Date.parse(t.done) > (seen.summary || 0)).length;
    if (closed < 3) return undefined;
    writeJson(file, { ...all, [key]: { ...seen, noted: now } });
    return `fk: ${closed} tasks closed since the last process summary. When there is a quiet moment, run fk metrics (add --write to save docs/process/metrics.md) and tell the founder in plain words what it shows.`;
  } catch { return undefined; }
}
