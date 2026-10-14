// fk baseline record | check  (adoption A5: the ratchet)
// record: run the gate commands once and store one number each in .fk/baseline.json (+ gitleaks history count).
// check: run them again; a count above the baseline (or coverage below it) fails. Improvements tighten the baseline.
// Commands: --gate name=cmd (repeatable), else .fk/config.json `check` / `fast_gates`, else those stored in the baseline.
import path from 'node:path';
import { loadConfig, readJson } from '../../hooks/lib.mjs';
import { say, needRoot, parseArgs, pairs, fkWrite, measure, gitleaks } from './adopt/util.mjs';
import { logGateRun } from '../../hooks/authorship.mjs';

const FILE = '.fk/baseline.json';
const USAGE = 'usage: fk baseline record|check [--gate name=cmd]... [--no-gitleaks] [--no-tighten]   (a gate named *cov* is a coverage %, higher is better)';

function gatesFor(root, flags, stored) {
  const given = pairs(flags.gate);
  if (given.length) return Object.fromEntries(given);
  if (stored) return Object.fromEntries(Object.entries(stored).filter(([n, g]) => n !== 'gitleaks' && g.cmd).map(([n, g]) => [n, g.cmd]));
  const c = loadConfig(root);
  return Object.fromEntries([['check', c.check], ['fast_gates', c.fast_gates]].filter(([, v]) => v));
}

function measureAll(root, flags, stored) {
  const gates = {};
  for (const [name, cmd] of Object.entries(gatesFor(root, flags, stored))) { say(`fk baseline: running ${name}: ${cmd}`); gates[name] = measure(root, name, cmd); }
  if (!flags['no-gitleaks'] && (!stored || stored.gitleaks)) {
    const gl = gitleaks(root);
    if (gl && gl.count != null) gates.gitleaks = { cmd: null, kind: 'count', value: gl.count };
  }
  return gates;
}

export function record(root, flags = {}) {
  const gates = measureAll(root, flags, null);
  for (const g of Object.values(gates)) delete g.ms;
  fkWrite(root, FILE, { recorded: new Date().toISOString(), gates });
  if (!Object.keys(gates).length) say('fk baseline: no gate commands known yet (pass --gate name=cmd or set fk config set check "<cmd>"). Recorded an empty baseline.');
  for (const [n, g] of Object.entries(gates)) say(`baseline ${n}: ${g.value ?? 'unreadable'}${g.kind === 'coverage' ? '%' : ''}`);
  return gates;
}

export function check(root, flags = {}) {
  const base = readJson(path.join(root, FILE), null);
  if (!base) { say('fk baseline: no baseline yet. Run fk baseline record first.'); process.exitCode = 1; return; }
  const now = measureAll(root, flags, base.gates);
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
  if (compared) logGateRun(root, { source: 'baseline', ok: !worse, gates: Object.keys(now) });
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
