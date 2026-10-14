// fk setup [--yes] [--dry-run] [--only <tool>] [--with-gh] | fk setup --shim | fk setup --remove-shim
// Checks the kit's base tools against compat.lock.json, shows one plain-language plan, installs and configures
// what is missing after one yes, verifies, and records the result. Exit 0 when nothing is red.
import readline from 'node:readline';
import { loadLock, detect, TOOLS, osName, realExec, appendLedger, writeStatus, statusFile, shim } from './setup/core.mjs';
import { readJson } from '../../hooks/lib.mjs';

const LABEL = { green: '\x1b[32mgreen \x1b[0m', yellow: '\x1b[33myellow\x1b[0m', red: '\x1b[31mred   \x1b[0m' };
const USAGE = `usage: fk setup [--yes] [--dry-run] [--only <${TOOLS.map((t) => t.id).join('|')}>] [--with-gh] | fk setup --shim | fk setup --remove-shim`;

function table(rows, out) {
  const w = Math.max(...rows.map((r) => r.label.length));
  for (const r of rows) out(`  ${LABEL[r.level]}  ${r.label.padEnd(w)}  ${[r.version, r.note].filter(Boolean).join(', ') || 'ready'}`);
}

function askYes(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(question, (a) => { rl.close(); res(!/^\s*n/i.test(a)); }));
}

export async function runSetup(args = [], deps = {}) {
  const out = deps.out || ((s = '') => process.stdout.write(s + '\n'));
  const env = deps.env || process.env;
  const exec = deps.exec || realExec;
  const o = deps.os || osName();
  const yes = args.includes('--yes') || args.includes('-y');
  const dry = args.includes('--dry-run');
  const oi = args.indexOf('--only');
  const only = oi >= 0 ? args[oi + 1] : null;
  const lock = loadLock();
  if (!lock) { out('fk setup: compat.lock.json is missing or unreadable; reinstall the kit.'); return 2; }
  if (oi >= 0 && !TOOLS.some((t) => t.id === only)) { out(USAGE); return 2; }
  const opts = { env, os: o, withGh: args.includes('--with-gh') || only === 'gh', has: deps.has };
  const pick = (rows) => (only ? rows.filter((r) => r.id === only) : rows);
  // The user-level `fk` command (C3): the plugin's bin/ reaches only the Bash tool, not PowerShell or a terminal.
  const sopts = { env, userPath: deps.userPath, dry };
  if (args.includes('--remove-shim') || args.includes('--shim')) { shim(args.includes('--shim') ? 'add' : 'remove', sopts).forEach((l) => out(l)); return 0; }
  const addShim = () => shim('add', sopts).forEach((l) => out(l));

  let { rows, next } = await detect(lock, opts);
  rows = pick(rows);
  out('Founder Kit base tools');
  table(rows, out);
  const todo = rows.filter((r) => r.steps.length);
  const anyRed = (rs) => rs.some((r) => r.level === 'red');
  if (!todo.length) {
    if (!dry) { writeStatus(rows, lock); addShim(); }
    out(anyRed(rows) ? '\nSome tools need attention (see red rows); nothing here can be fixed automatically.' : '\nAll base tools are ready.');
    return anyRed(rows) ? 1 : 0;
  }

  out('\nPlan (everything below is free and open source):');
  todo.forEach((r, i) => {
    const verb = { missing: 'Install', 'below-floor': 'Update', 'plugin-missing': 'Add the Claude Code plugin of' }[r.reason] || 'Set up';
    out(`  ${i + 1}. ${verb} ${r.label} (${r.size}): ${r.why}.`);
    for (const s of r.steps) out(`       > ${s.cmd}`);
  });
  out('  Nothing is uninstalled or downgraded. Every change is logged with an undo hint in ~/.fk/install-ledger.jsonl.');
  if (o === 'win' && todo.some((r) => r.steps.some((s) => /winget/.test(s.cmd)))) out('  Windows may ask once for permission to install (a blue or yellow prompt). Say yes.');

  if (dry) { out('\nDry run: nothing was changed.'); return anyRed(rows) ? 1 : 0; }
  const isTTY = deps.isTTY ?? !!process.stdin.isTTY;
  const ok = yes || (isTTY && await (deps.ask || askYes)('\nInstall and set up these now? [Y/n] '));
  if (!ok) {
    writeStatus(rows, lock);
    out('\nNothing was installed. To go ahead later, run: fk setup --yes');
    return 1;
  }

  for (const r of todo) {
    out(`\n-> ${r.label}`);
    for (const s of r.steps) {
      const res = exec(s, env);
      const spec = lock.tools[r.id];
      appendLedger({ tool: r.id, action: s.action, version: spec.commit || spec.version || null, command: s.cmd, ok: !!res.ok, rollback: s.rollback });
      if (!res.ok) { out(`   failed: ${s.cmd}`); break; }
    }
  }

  ({ rows, next } = await detect(lock, opts));
  rows = pick(rows);
  const prev = readJson(statusFile(), null);
  writeStatus(only && prev ? mergeRows(prev, rows) : rows, lock);
  out('\nResult');
  table(rows, out);
  addShim();
  if (next.length || !anyRed(rows)) out('\nNext:');
  for (const n of next) out(`  - ${n}`);
  if (!anyRed(rows)) out('  - Restart Claude Code so it loads the new tools.');
  else out('\nSome items are still red. Run `fk setup` again, or ask Claude to explain the red rows.');
  return anyRed(rows) ? 1 : 0;
}

// --only keeps the other tools' last known status.
function mergeRows(prev, rows) {
  const keep = Object.entries(prev.tools || {}).filter(([id]) => !rows.some((r) => r.id === id))
    .map(([id, t]) => ({ id, ...t }));
  return [...keep, ...rows];
}

export default async function setup(args) {
  process.exitCode = await runSetup(args);
}
