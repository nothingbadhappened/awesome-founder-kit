// fk gates build: compile the fit: rules of accepted ADRs into scripts/fk-boundaries.mjs, a dependency-free checker the
// project commits and runs in its check command. Rule kinds: forbid_import {from, to}, require_file <path>, forbid_path <glob>.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../hooks/lib.mjs';
import { loadIndex, activeAdr } from '../../hooks/knowledge.mjs';
import { say, needRoot, parseArgs } from './adopt/util.mjs';

const TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates', 'gates', 'fk-boundaries.mjs');
export const SCRIPT = 'scripts/fk-boundaries.mjs';
const USAGE = 'usage: fk gates build';
const list = (v) => [].concat(v ?? []).map(String).filter(Boolean);

// One fit: entry -> a rule, or a plain reason it was skipped.
export function compile(adr, entry) {
  const [kind, v] = Object.entries(entry)[0] || [];
  const base = { adr: adr.id, title: adr.title, kind };
  if (kind === 'forbid_import') {
    const from = list(v?.from), to = list(v?.to);
    return from.length && to.length ? { ...base, from, to } : `${adr.id}: forbid_import needs from: and to:`;
  }
  if (kind === 'require_file' || kind === 'forbid_path') {
    const p = list(typeof v === 'object' && !Array.isArray(v) ? v.path : v);
    return p.length ? { ...base, path: p } : `${adr.id}: ${kind} needs a path`;
  }
  return `${adr.id}: unknown rule kind "${kind}" (known: forbid_import, require_file, forbid_path)`;
}

async function build(root) {
  const adrs = (await loadIndex(root, ['knowledge'])).knowledge.adrs.filter(activeAdr);
  const rules = [], skipped = [];
  for (const a of adrs) for (const f of a.fit) { const r = compile(a, f); if (typeof r === 'string') skipped.push(r); else rules.push(r); }
  for (const s of skipped) say(`fk gates: skipped ${s}.`);
  if (!rules.length) return say('fk gates: no fit: rules in accepted ADRs, so nothing was written. Add them to an ADR front matter (fk-process ADR template).');
  const src = fs.readFileSync(TEMPLATE, 'utf8').replace('/*FK_RULES*/[]', `/*FK_RULES*/${JSON.stringify(rules, null, 2)}`);
  // A dropped fit rule must be visible: compare with the rules in the script being replaced.
  let before = [];
  try { before = JSON.parse(/\/\*FK_RULES\*\/(\[[\s\S]*?\n?\]);/.exec(fs.readFileSync(path.join(root, SCRIPT), 'utf8'))[1]); } catch { /* first build */ }
  const sig = (r) => `${r.adr} ${JSON.stringify({ ...r, adr: undefined })}`;
  const gone = before.filter((r) => !rules.some((n) => sig(n) === sig(r)));
  if (gone.length) say(`fk gates: ${gone.length} rule(s) no longer present (${[...new Set(gone.map((r) => r.adr))].join(', ')}). If that was not a deliberate superseding ADR, tell the founder.`);
  fs.mkdirSync(path.join(root, path.dirname(SCRIPT)), { recursive: true });
  fs.writeFileSync(path.join(root, SCRIPT), src);
  say(`fk gates: wrote ${SCRIPT} (${rules.length} rule(s) from ${new Set(rules.map((r) => r.adr)).size} ADR(s)). Commit it.`);
  const r = spawnSync(process.execPath, [path.join(root, SCRIPT)], { cwd: root, encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
  const { check, protected_extra: guarded = [] } = loadConfig(root);
  if (check && check.includes('fk-boundaries')) say('It already runs in the check command.');
  else say(`Run it in the gates: fk config set check "${check ? `${check} && ` : ''}node ${SCRIPT}" (prove it red once on a planted violation).`);
  // ADRs stay freely editable (superseding is normal work); the generated script is what gets protected.
  if (!guarded.includes(SCRIPT)) say(`So the gate can't be edited by hand, protect it: fk config set protected_extra "${SCRIPT}".`);
}

export default async function gates(args) {
  const { pos } = parseArgs(args);
  const root = needRoot();
  if (pos[0] === 'build') return build(root);
  say(USAGE); process.exitCode = 1;
}
