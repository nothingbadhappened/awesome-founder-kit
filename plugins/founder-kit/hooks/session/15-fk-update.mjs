// SessionStart (startup/clear): at most once a day, one line when a newer Founder Kit is published. Reads the cache only
// (<FK_HOME>/state/fk-latest.json); a cache older than a day is refreshed in the background (fk update --refresh, 2 s
// network budget, silent offline) for the next session. Never updates anything itself.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cmpVer } from '../lib.mjs';
import { kitLatestCached, kitVersion, readKitCache, writeKitCache } from '../../bin/cmd/update/release.mjs';

const FK_CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'fk.mjs');
const DAY = 24 * 60 * 60 * 1000;

export default function kitUpdateNote({ now = Date.now(), refresh = true } = {}) {
  try {
    const { latest, stale } = kitLatestCached(now);
    if (stale && refresh) { try { spawn(process.execPath, [FK_CLI, 'update', '--refresh'], { detached: true, stdio: 'ignore' }).unref(); } catch { /* best effort */ } }
    const have = kitVersion();
    if (!latest || !have || cmpVer(latest, have) <= 0) return undefined;
    if (now - (readKitCache().notified || 0) < DAY) return undefined;
    writeKitCache({ notified: now });
    return `fk: Founder Kit ${latest} is available (you have ${have}): ask the founder whether to run fk update (AskUserQuestion). It shows what changed and asks before changing anything; never update without a yes.`;
  } catch { return undefined; }
}
