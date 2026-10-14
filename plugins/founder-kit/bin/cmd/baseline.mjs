// fk baseline record | check  (adoption A5: the ratchet)
// record: run the gate commands once and store one number each in .fk/baseline.json (+ gitleaks history count). Once a
// baseline exists, recording again needs the founder's typed `fk-approve baseline <reason>` (used once): a new record
// could accept new problems as old ones.
// check: run them again; a count above the baseline (or coverage below it) fails. Improvements tighten the baseline.
// Commands: --gate name=cmd (repeatable), else .fk/config.json `check` / `fast_gates`, else those stored in the baseline.
// Only a check that ran the configured commands (no --gate) is logged as a gate run `fk task check` can count.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, readJson, log, readSnapshot, hashFile, readLog } from '../../hooks/lib.mjs';
import { say, needRoot, parseArgs, pairs, fkWrite, measure, gitleaks } from './adopt/util.mjs';
import { logGateRun } from '../../hooks/authorship.mjs';
import { takeBaselineApproval } from '../../hooks/directives/baseline.mjs';

const FILE = '.fk/baseline.json';
const USAGE = 'usage: fk baseline record|check [--gate name=cmd]... [--no-gitleaks] [--no-tighten]   (a gate named *cov* is a coverage %, higher is better)';

// .fk/config.json changed behind the kit (its hash is not the snapshot's): each gate is the last value fk config set
// logged (the sanctionedJson rule), so a hand-edited, weaker command never counts for fk task done/check.
export const configuredGates = (root) => {
  const c = loadConfig(root);
  const known = readSnapshot(root).files['.fk/config.json'];
  const sets = known && hashFile(root, '.fk/config.json') !== known
    ? readLog(root).filter((r) => r.event === 'cli' && r.decision === 'gate-change') : null;
  const val = (k) => (sets ? (sets.filter((r) => r.key === k).at(-1)?.to ?? c[k]) : c[k]);
  return Object.fromEntries([['check', val('check')], ['fast_gates', val('fast_gates')]].filter(([, v]) => v));
};

function gatesFor(root, flags, stored) {
  const given = pairs(flags.gate);
  if (given.length) return { gates: Object.fromEntries(given), source: 'given' };
  if (stored) {
    const s = Object.fromEntries(Object.entries(stored).filter(([n, g]) => n !== 'gitleaks' && g.cmd).map(([n, g]) => [n, g.cmd]));
    return { gates: s, source: JSON.stringify(s) === JSON.stringify(configuredGates(root)) ? 'configured' : 'stored' };
  }
  return { gates: configuredGates(root), source: 'configured' };
}

function measureAll(root, flags, stored) {
  const { gates: cmds, source } = gatesFor(root, flags, stored);
  const gates = {};
  for (const [name, cmd] of Object.entries(cmds)) { say(`fk baseline: running ${name}: ${cmd}`); gates[name] = measure(root, name, cmd); }
  if (!flags['no-gitleaks'] && (!stored || stored.gitleaks)) {
    const gl = gitleaks(root);
    if (gl && gl.count != null) gates.gitleaks = { cmd: null, kind: 'count', value: gl.count };
  }
  return { gates, cmds, source };
}

export function record(root, flags = {}) {
  if (fs.existsSync(path.join(root, FILE))) {
    const a = takeBaselineApproval(root);
    if (!a) {
      say('fk baseline: a baseline is already recorded; it only moves toward better (fk baseline check tightens it). Nothing recorded.');
      say('To record it again, the founder types this line alone as a message: fk-approve baseline <reason>. Then run this again.');
      log(root, { event: 'cli', guard: 'gate-guard', decision: 'baseline-record-refused' });
      process.exitCode = 1; return null;
    }
    log(root, { event: 'cli', guard: 'gate-guard', decision: 'baseline-rerecord', reason: a.reason });
  }
  const { gates } = measureAll(root, flags, null);
  for (const g of Object.values(gates)) { delete g.ms; delete g.exit; }
  fkWrite(root, FILE, { recorded: new Date().toISOString(), gates });
  if (!Object.keys(gates).length) say('fk baseline: no gate commands known yet (pass --gate name=cmd or set fk config set check "<cmd>"). Recorded an empty baseline.');
  for (const [n, g] of Object.entries(gates)) say(`baseline ${n}: ${g.value ?? 'unreadable'}${g.kind === 'coverage' ? '%' : ''}`);
  return gates;
}

export function check(root, flags = {}) {
  const base = readJson(path.join(root, FILE), null);
  if (!base) { say('fk baseline: no baseline yet. Run fk baseline record first.'); process.exitCode = 1; return; }
  const { gates: now, cmds, source } = measureAll(root, flags, base.gates);
  let worse = 0, tightened = 0, compared = 0;
  const next = { ...base.gates };
  for (const [n, g] of Object.entries(now)) {
    const b = base.gates[n];
    if (!b || b.value == null || g.value == null) { say(`new      ${n}: ${g.value ?? 'unreadable'} (no comparable baseline)`); continue; }
    compared++;
    const delta = g.kind === 'coverage' ? b.value - g.value : g.value - b.value; // > 0 means worse
    if (delta > 1e-9) { worse++; say(`WORSE    ${n}: ${b.value} -> ${g.value}${g.kind === 'coverage' ? '% coverage dropped' : ` (${delta} new)`}`); }
    else if (delta < -1e-9) { tightened++; next[n] = { ...b, value: g.value }; say(`better   ${n}: ${b.value} -> ${g.value}`); }
    else say(`same     ${n}: ${g.value}`);
  }
  // Green for `fk task check` only when nothing got worse AND every command exited 0 (no worse-than-baseline is not green).
  const ran = Object.keys(cmds);
  if (ran.length) logGateRun(root, { source, ok: !worse && ran.every((n) => now[n]?.exit === 0), gates: ran, cmds });
  for (const g of Object.values(next)) delete g.exit;
  if (tightened && !flags['no-tighten']) { fkWrite(root, FILE, { ...base, gates: next, tightened: new Date().toISOString() }); say('fk baseline: improvements locked in; the baseline only moves toward better.'); }
  if (worse) { say(`fk baseline: ${worse} gate(s) got worse than the recorded baseline. New problems must be fixed; old ones may stay.`); process.exitCode = 1; }
  else if (!compared) say('fk baseline: nothing compared with the baseline yet. Name the gate commands with fk config set check "<cmd>", then fk baseline record.');
  else say(`fk baseline: ok, ${compared} gate(s) no worse than the baseline.`);
}

export default async function baseline(args) {
  const { pos, flags } = parseArgs(args);
  const root = needRoot();
  if (pos[0] === 'record') return void record(root, flags);
  if (pos[0] === 'check') return void check(root, flags);
  say(USAGE); process.exitCode = 1;
}
