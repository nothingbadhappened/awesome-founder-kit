// SessionStart (startup/clear): bring this project's kit state up to the installed kit's state_version (migrations
// registry: bin/cmd/update/migrations.mjs). One small file read when nothing is due; never a note.
import { stateDir } from '../lib.mjs';
import { STATE_VERSION, stateVersion, migrateDir } from '../../bin/cmd/update/migrations.mjs';

export default function stateMigrations({ root }) {
  try {
    const dir = stateDir(root);
    if (stateVersion(dir) < STATE_VERSION) migrateDir(dir, root);
  } catch { /* never in the way of a session */ }
  return undefined;
}
