// fk setup [--yes] [--dry-run] [--with <id,id>] [--all] [--only <tool>] | fk setup --shim | fk setup --remove-shim   (--with-gh = --with gh)
// Checks the kit's base tools against compat.lock.json, shows one plain-language plan, installs and configures
// what is missing after one yes, verifies, and records the result. Exit 0 when nothing is red. Core tools are always
// planned; optional ones only when asked for (--with, --all, --only) or approved in the project's .fk/toolchain.json.
import readline from 'node:readline';
import { loadLock, detect, TOOLS, osName, realExec, appendLedger, writeStatus, statusFile, shim, wantedTools, projectTools } from './setup/core.mjs';
import { readJson, findRoot } from '../../hooks/lib.mjs';
import { describe, notePreExisting } from './setup/ledger.mjs';
import { claudeAncestor } from './steward/proc.mjs';

const LABEL = { green: '\x1b[32mgreen   \x1b[0m', yellow: '\x1b[33myellow  \x1b[0m', red: '\x1b[31mred     \x1b[0m', optional: '\x1b[2moptional\x1b[0m' };
const USAGE = `usage: fk setup [--yes] [--dry-run] [--with <id,id>] [--all] [--only <id>] | fk setup --shim | fk setup --remove-shim
  ids: ${TOOLS.map((t) => t.id).join(', ')} (core, always checked: ${TOOLS.filter((t) => t.core).map((t) => t.id).join(', ')})`;

function optionalHint(rows, out) {
  const ids = rows.filter((r) => r.level === 'optional').map((r) => r.id);
  if (ids.length) out(`\nOptional tools stay out until a project needs one (its toolchain proposal names it). To add one now: fk setup --with <id> (${ids.join(', ')}).`);
}

function table(rows, out) {
  const w = Math.max(...rows.map((r) => r.label.length));
  for (const r of rows) out(`  ${LABEL[r.level]}  ${r.label.padEnd(w)}  ${[r.version, r.note].filter(Boolean).join(', ') || 'ready'}`);
}

// Steps only the founder can take (admin rights and a restart, a browser sign-in): listed, never run.
function founderSteps(rows, out) {
  const steps = rows.flatMap((r) => r.founder || []).sort((a, b) => !!b.blocking - !!a.blocking); // blocking first (WSL2 before a sign-in)
  if (!steps.length) return;
  out('\nOnly you can do these (the kit never runs them for you; they are also in `fk actions`):');
  for (const f of steps) out(`  - ${f.text}`);
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
  const wi = args.indexOf('--with');
  const asked = [...(wi >= 0 ? String(args[wi + 1] || '').split(',').map((x) => x.trim()).filter(Boolean) : []),
    ...(args.includes('--all') ? ['all'] : []), ...(args.includes('--with-gh') ? ['gh'] : []), ...(only ? [only] : [])];
  if ((wi >= 0 && !args[wi + 1]) || asked.some((id) => id !== 'all' && !TOOLS.some((t) => t.id === id))) { out(USAGE); return 2; }
  const want = wantedTools([...asked, ...projectTools(findRoot(deps.cwd)?.root)], o);
  const opts = { env, os: o, has: deps.has, want };
  const pick = (rows) => (only ? rows.filter((r) => r.id === only) : rows);
  // The user-level `fk` command (C3): the plugin's bin/ reaches only the Bash tool, not PowerShell or a terminal.
  const sopts = { env, userPath: deps.userPath, dry };
  // Removing the user-level fk command is the founder's call, made in a terminal (CLAUDE_CODE_CHILD_SESSION, or Claude Code
  // among the parent processes: an agent shell).
  if (args.includes('--remove-shim') && (env.CLAUDE_CODE_CHILD_SESSION === '1' || (deps.underClaude || claudeAncestor)())) { out('fk setup --remove-shim: refused: only you can remove the fk command. Run it yourself in a terminal outside Claude Code.'); return 1; }
  if (args.includes('--remove-shim') || args.includes('--shim')) { shim(args.includes('--shim') ? 'add' : 'remove', sopts).forEach((l) => out(l)); return 0; }
  const addShim = () => shim('add', sopts).forEach((l) => out(l));

  let { rows, next } = await detect(lock, opts);
  rows = pick(rows);
  out('Founder Kit base tools');
  table(rows, out);
  const todo = rows.filter((r) => r.steps.length);
  const anyRed = (rs) => rs.some((r) => r.level === 'red');
  // What was already here before this run: recorded once as pre-existing, never removed by fk uninstall --system.
  const found = () => notePreExisting(rows.flatMap((r) => r.found || []));
  if (!todo.length) {
    if (!dry) { found(); writeStatus(only ? mergeRows(readJson(statusFile(), { tools: {} }), rows) : rows, lock); addShim(); }
    out(anyRed(rows) ? '\nSome tools need attention (see red rows); nothing here can be fixed automatically.' : '\nAll base tools are ready.');
    optionalHint(rows, out);
    founderSteps(rows, out);
    return anyRed(rows) ? 1 : 0;
  }

  optionalHint(rows, out);
  out('\nPlan (everything below is free and open source):');
  todo.forEach((r, i) => {
    const verb = { missing: 'Install', 'below-floor': 'Update', 'plugin-missing': 'Add the Claude Code plugin of' }[r.reason] || 'Set up';
    out(`  ${i + 1}. ${verb} ${r.label} (${r.size}): ${r.why}.`);
    for (const s of r.steps) out(`       > ${s.cmd}`);
  });
  out('  Nothing is uninstalled or downgraded. Every change is logged with an undo hint in ~/.fk/install-ledger.jsonl.');
  if (o === 'win' && todo.some((r) => r.steps.some((s) => /winget/.test(s.cmd)))) out('  Windows may ask once for permission to install (a blue or yellow prompt). Say yes.');
  if (todo.some((r) => r.steps.some((s) => /^sudo /.test(s.cmd)))) out('  Some steps use sudo: your computer password may be asked once.');
  founderSteps(rows, out);

  if (dry) { out('\nDry run: nothing was changed.'); return anyRed(rows) ? 1 : 0; }
  const isTTY = deps.isTTY ?? !!process.stdin.isTTY;
  const ok = yes || (isTTY && await (deps.ask || askYes)('\nInstall and set up these now? [Y/n] '));
  if (!ok) {
    writeStatus(rows, lock);
    out('\nNothing was installed. To go ahead later, run: fk setup --yes');
    return 1;
  }

  found();
  for (const r of todo) {
    out(`\n-> ${r.label}`);
    for (const s of r.steps) {
      const res = exec(s, env);
      const spec = lock.tools[r.id];
      appendLedger({ tool: r.id, action: s.action, version: spec.commit || spec.version || null, command: s.cmd, ok: !!res.ok, rollback: s.rollback,
        ...describe({ tool: r.id, action: s.action, cmd: s.cmd, rollback: s.rollback, fn: s.fn }, o), ...(s.file ? { file: s.file } : {}) });
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
  founderSteps(rows, out);
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
