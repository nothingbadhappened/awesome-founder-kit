// Kit state migrations. Each project's kit state (<FK_HOME>/state/<project key>/) carries state.json { state_version, root };
// a new kit version that changes the shape of that state adds one entry here. Run by `fk update` (every project the
// machine knows) and at SessionStart for the open project when its state is behind (one small file read otherwise).
// Every migration is idempotent: running it twice changes nothing more. A migration that cannot run yet (it needs the
// project folder and only the state folder is known) returns false: the version stays, and the next session start
// in that project finishes it.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, fkHome, legacyRunner, hashFile, readSnapshot, refreshSnapshot } from '../../../hooks/lib.mjs';

export const MIGRATIONS = [
  {
    to: 1,
    what: 'record the project folder in its kit state, so fk uninstall --system can list the projects still set up for the kit',
    run: ({ state, root }) => {
      if (!root) return false;
      state.root = path.resolve(root);
      return true;
    },
  },
  {
    to: 2,
    what: 'drop the runner "npm run" that fk init wrote into every config before v1 (never chosen with fk config set)',
    run: ({ root }) => {
      if (!root) return false;
      const rel = '.fk/config.json';
      const file = path.join(root, rel);
      const cfg = readJson(file, null);
      if (!cfg || !legacyRunner(cfg, root)) return true;
      const trusted = readSnapshot(root).files?.[rel] === hashFile(root, rel); // never vouch for a hand-edited config
      writeJson(file, { ...cfg, runner: null });
      if (trusted) refreshSnapshot(root, [rel]);
      return true;
    },
  },
];
export const STATE_VERSION = MIGRATIONS.at(-1).to;
export const STATE_FILE = 'state.json';

const KEY = /^[0-9a-f]{16}$/; // project state folders are named by rootKey() (hooks/lib.mjs); the rest are machine caches

export const stateVersion = (dir) => readJson(path.join(dir, STATE_FILE), {})?.state_version || 0;

// Brings one state folder up to STATE_VERSION. Returns the migrations that ran.
export function migrateDir(dir, root = null) {
  const file = path.join(dir, STATE_FILE);
  const state = readJson(file, {}) || {};
  const from = state.state_version || 0;
  const ran = [];
  for (const m of MIGRATIONS) {
    if (m.to <= (state.state_version || 0)) continue;
    if (!m.run({ dir, state, root: root || state.root || null })) break;
    state.state_version = m.to;
    ran.push(m);
  }
  if (ran.length || (root && !state.root)) writeJson(file, state);
  return { from, to: state.state_version || 0, ran };
}

export const projectStateDirs = (home = fkHome()) => {
  const base = path.join(home, 'state');
  try { return fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory() && KEY.test(e.name)).map((e) => path.join(base, e.name)); }
  catch { return []; }
};

export function migrateAll(home = fkHome()) {
  return projectStateDirs(home).map((dir) => ({ dir, ...migrateDir(dir) }));
}

// Project folders the kit knows (recorded by migration 1) that still have a .fk/ folder.
export const kitProjects = (home = fkHome()) => [...new Set(projectStateDirs(home).map((d) => readJson(path.join(d, STATE_FILE), {})?.root).filter(Boolean))]
  .filter((r) => fs.existsSync(path.join(r, '.fk')));
