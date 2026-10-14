// SessionStart note: base tools missing or below the floor -> ask the agent to offer `fk setup`.
// Reads only the cached <FK_HOME>/base-tools.json (written by `fk setup` and the installers): no processes, no network.
import path from 'node:path';
import { readJson, fkHome } from '../lib.mjs';

export default function baseTools() {
  const status = readJson(path.join(fkHome(), 'base-tools.json'), null);
  const offer = 'Ask the founder in plain words (AskUserQuestion) whether to run `fk setup` now; it shows one plan and installs only after a yes.';
  if (!status?.tools) return undefined; // never checked: fk-start step 0 runs `fk setup` itself
  const red = Object.entries(status.tools).filter(([, t]) => t?.level === 'red')
    .map(([id, t]) => `${id} (${t.reason === 'below-floor' ? `older than ${t.min}` : t.reason === 'missing' ? 'missing' : 'not set up'})`);
  if (!red.length) return undefined;
  return `fk: base tools need attention: ${red.join(', ')}. ${offer}`;
}
