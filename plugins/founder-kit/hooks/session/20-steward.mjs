// SessionStart (startup/clear) steward note: at most one per session, cheap file reads only (no network, no process).
// Order: expired ledger items (at most every 12 h) > weekly sweep/budget check (7 d) > toolchain re-scout (90 d).
import fs from 'node:fs';
import path from 'node:path';
import { fingerprint, readLedger, expired, readState, writeState, DAY } from '../../bin/cmd/steward/lib.mjs';
import { readJson, fkHome } from '../lib.mjs';

const age = (iso, now) => (iso ? now - Date.parse(iso) : Infinity);

export default function steward(ctx) {
  try {
    const { root } = ctx;
    const now = ctx.now ?? Date.now();
    const iso = new Date(now).toISOString();
    const s = readState(root);
    if (!s.first_seen) { writeState(root, { first_seen: iso }); return undefined; } // baseline, no note on day one
    const run = s.last_run || {}, note = s.last_note || {};
    const say = (key, text) => { writeState(root, { last_note: { [key]: iso } }); return text; };

    const fp = fingerprint(root);
    const stale = readLedger(root).filter((e) => e.fp === fp && !e.pre_existing && expired(e, now));
    if (stale.length && age(note.expired, now) >= DAY / 2) {
      return say('expired', `fk steward: ${stale.length} item(s) agents started are past their time limit (${stale.slice(0, 3).map((e) => `${e.kind} ${path.basename(String(e.id))}`).join(', ')}). Run \`fk sweep --dry-run\`, then \`fk sweep\`.`);
    }
    const lastCare = Math.max(age(run.sweep || s.first_seen, now), age(run.budget_check || s.first_seen, now));
    if (lastCare >= 7 * DAY && age(note.weekly, now) >= 7 * DAY) {
      // The Podman machine status comes from the cache fk setup / fk doctor wrote: no process on this path.
      const machine = readJson(path.join(fkHome(), 'base-tools.json'), {})?.tools?.podman?.machine;
      const vm = machine?.running ? ' The Podman machine was running at the last check (it holds memory while idle): if no containers are needed, stop it with `podman machine stop`.' : '';
      return say('weekly', `fk steward: weekly upkeep is due. Run \`fk sweep --dry-run\` (leftover servers, containers, worktrees) and \`fk budget check\` (are the billing caps still set?).${vm} Load fk-steward for details.`);
    }
    let scouted = s.first_seen;
    try { scouted = fs.statSync(path.join(root, '.fk', 'toolchain.json')).mtime.toISOString(); } catch { /* no toolchain yet */ }
    if (age(scouted, now) >= 90 * DAY && age(note.rescout, now) >= 90 * DAY) {
      return say('rescout', 'fk steward: the approved toolchain is over 90 days old. Tools and prices change; suggest re-running fk-scout to the founder (AskUserQuestion), never install without a yes.');
    }
    return undefined;
  } catch { return undefined; }
}
