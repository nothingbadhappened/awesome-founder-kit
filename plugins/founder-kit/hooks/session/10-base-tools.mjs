// SessionStart note: base tools missing or below the floor -> ask the agent to offer `fk setup`; a blocking founder step
// (WSL2 for Podman) -> tell the founder once more, at most once a day. Reads only the cached <FK_HOME>/base-tools.json
// (written by `fk setup`, `fk doctor` and the installers): no processes, no network.
import path from 'node:path';
import { readJson, writeJson, fkHome } from '../lib.mjs';

const DAY = 24 * 60 * 60 * 1000;

export default function baseTools({ now = Date.now() } = {}) {
  const status = readJson(path.join(fkHome(), 'base-tools.json'), null);
  const offer = 'Ask the founder in plain words (AskUserQuestion) whether to run `fk setup` now; it shows one plan and installs only after a yes.';
  if (!status?.tools) return undefined; // never checked: fk-start step 0 runs `fk setup` itself
  const red = Object.entries(status.tools).filter(([, t]) => t?.level === 'red')
    .map(([id, t]) => `${id} (${t.reason === 'below-floor' ? `older than ${t.min}` : t.reason === 'missing' ? 'missing' : 'not set up'})`);
  const mine = Object.values(status.tools).flatMap((t) => t?.founder || []).filter((f) => f?.blocking).map((f) => f.text);
  const out = [];
  if (red.length) out.push(`fk: base tools need attention: ${red.join(', ')}. ${offer}`);
  if (mine.length) {
    const file = path.join(fkHome(), 'base-tools-note.json');
    const seen = readJson(file, {});
    if (now - (seen.founder || 0) >= DAY) {
      try { writeJson(file, { ...seen, founder: now }); } catch { /* read-only home: say it anyway */ }
      out.push(`fk: a step only the founder can do is still open; tell them in plain words: ${mine.join(' ')}`);
    }
  }
  return out.length ? out.join(' ') : undefined;
}
