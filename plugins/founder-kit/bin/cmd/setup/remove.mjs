// fk uninstall --system [--dry-run] [--yes] [--plugin-only] [--only <ids>] [--keep <ids>] [--rollbacks] [--projects]
// (also install.ps1 -Uninstall and install.sh --uninstall, which hand over to this). Founder only, in a terminal.
// Takes back what Founder Kit put on this computer, from the install ledger (~/.fk/install-ledger.jsonl): never anything
// that was already there (pre-existing), never anything the ledger does not name, never user files. Three groups:
//   Installed by Founder Kit (preselected), Settings Founder Kit changed (preselected; reversible ones only),
//   Data Founder Kit created (not preselected).
// Order: the kit's Claude plugins and marketplace, other plugins it added (OMC, MemPalace), settings, codebase-memory
// indexes, the Podman machine, tools (newest first, each by its recorded undo; script installs only at their recorded
// paths), the PATH entry, data. Each removal is checked afterwards; a failure is reported with the command to run by hand.
// Kit projects come first, on the founder's choice per project (or --rollbacks / --projects with --yes): the tools
// `fk provision` added there (fk provision rollback <name>), then the project's own kit setup (fk uninstall). Both need
// the kit, so they run before any removal.
// Everything this needs is imported up front: removing the founder-kit plugin can take this file's own folder away.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJson, fkHome } from '../../../hooks/lib.mjs';
import { readLedger, itemStates, appendLedger, untilde, tilde } from './ledger.mjs';
import { TOOLS, probe, realExec, shimPaths, shimMarked, winUserPathEntry } from './core.mjs';
import { kitProjects } from '../update/migrations.mjs';
import { kitSource, pluginsDir } from '../update/release.mjs';

export const AGENT_REFUSED = 'only you can take the kit out. Run it yourself in a terminal outside Claude Code.';
const USAGE = 'usage: fk uninstall --system [--dry-run] [--yes] [--plugin-only] [--only <ids>] [--keep <ids>] [--rollbacks] [--projects]   (ids: comma separated, as the --dry-run list shows them; with --yes, --rollbacks rolls back the tools fk provision added in each kit project and --projects runs fk uninstall in each)';
const FK_CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fk.mjs');
const GROUPS = [['installed', 'Installed by Founder Kit'], ['settings', 'Settings Founder Kit changed'], ['data', 'Data Founder Kit created']];
const SHARED = new Set(['git', 'node', 'uv', 'claude-code']); // other programs may use these too
const TOOL_INDEX = Object.fromEntries(TOOLS.map((t, i) => [t.id, i]));
const LABEL = Object.fromEntries(TOOLS.map((t) => [t.id, t.label]));
const BIN = Object.fromEntries(TOOLS.map((t) => [t.id, [t.bin, t.args]]));

// Only paths under the home folder (recorded as ~/...) or under the kit folder, never the home folder itself.
function safePath(p, home) {
  const abs = path.resolve(untilde(p, home));
  const inside = (dir) => { const r = path.relative(dir, abs); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };
  return (/^~[\\/]/.test(p) && inside(home)) || abs === path.resolve(fkHome()) || inside(fkHome()) ? abs : null;
}

// One removable item per ledger item (latest state), plus the kit itself: its plugins, marketplace, fk command and folder.
export function buildItems({ rows = readLedger(), home = os.homedir(), src = kitSource(), cbmIndexes = () => [] } = {}) {
  const reg = readJson(path.join(pluginsDir(), 'installed_plugins.json'), {})?.plugins || {};
  const known = readJson(path.join(pluginsDir(), 'known_marketplaces.json'), {}) || {};
  const items = [];
  const manual = [];
  const add = (it) => { if (!items.some((x) => x.id === it.id)) items.push(it); };
  // The kit itself, whoever added it: founder-kit, its practice packs, its marketplace.
  for (const key of Object.keys(reg).filter((k) => k.endsWith(`@${src.name}`) && /^(?:founder-kit|fk-practice-[\w.-]+)@/.test(k)).sort((a, b) => (a.startsWith('founder-kit@') ? -1 : b.startsWith('founder-kit@') ? 1 : a.localeCompare(b)))) {
    const name = key.split('@')[0];
    add({ id: `${name}:plugin`, tool: name, group: 'installed', phase: 1, kitPlugin: true, plugin: key, how: 'claude plugin', undo: `claude plugin uninstall ${key}`,
      label: name === 'founder-kit' ? 'Founder Kit plugin (founder-kit)' : `Practice pack ${name}` });
  }
  if (known[src.name]) add({ id: 'founder-kit:marketplace', tool: 'founder-kit', group: 'installed', phase: 2, kitPlugin: true, marketplace: src.name, how: 'claude plugin',
    undo: `claude plugin marketplace remove ${src.name}`, label: `The kit's plugin marketplace (${src.name})` });

  for (const [id, r] of itemStates(rows)) {
    if (!['installed', 'configured', 'data'].includes(r.state) || items.some((x) => x.id === id)) continue;
    const base = { id, tool: r.tool, how: r.how, scope: r.scope, undo: r.undo || null, version: r.version || null, paths: r.paths, fn: r.fn, file: r.file, dir: r.dir, value: r.value, name: r.name };
    if (!base.undo && !base.fn && !base.paths) { manual.push(`${LABEL[r.tool] || r.tool} (${r.how}): no safe automatic undo; it stays`); continue; }
    const m = /^([\w-]+):(\w[\w-]*)$/.exec(id);
    if (m?.[2] === 'plugin') {
      const key = /^claude plugin uninstall (\S+)$/.exec(r.undo || '')?.[1];
      add({ ...base, group: 'installed', phase: 3, plugin: key, label: `${key} plugin in Claude Code` });
    } else if (m?.[2] === 'marketplace') {
      const name = /^claude plugin marketplace remove (\S+)$/.exec(r.undo || '')?.[1];
      add({ ...base, group: 'installed', phase: 4, marketplace: name, label: `${name} plugin marketplace in Claude Code` });
    } else if (id === 'podman:machine') {
      add({ ...base, group: 'settings', phase: 7, warn: true, label: 'Podman machine (the small Linux machine containers run in): the containers and images inside it are deleted with it' });
    } else if (id === 'fk-shim:path') {
      add({ ...base, group: 'settings', phase: 9, label: `${r.dir} on your user PATH (added for the fk command; kept while other programs there use it)` });
    } else if (r.state === 'configured') {
      const label = id === 'git-lfs:config' ? 'Git LFS switched on for your user (undo: git lfs uninstall)'
        : id === 'mempalace:silent-save' ? 'MemPalace setting hooks.silent_save (taken back out of its config.json)'
          : m && r.tool === 'codebase-memory-mcp' ? `codebase-memory setting ${m[2]} (set back: ${r.undo})` : `${r.tool} setting (${r.undo})`;
      add({ ...base, group: 'settings', phase: 5, label });
    } else if (r.state === 'data') {
      add({ ...base, group: 'data', phase: 10, label: id === 'mempalace:palace' ? `MemPalace memory store ${(r.paths || []).join(' ')} (your saved memories)` : `${id} ${(r.paths || []).join(' ')}` });
    } else {
      const [bin, args] = BIN[r.tool] || [];
      const where = r.paths ? `; removes ${r.paths.join(', ')}` : '';
      add({ ...base, group: 'installed', phase: 8, order: id === 'fk-shim' ? -100 : -(TOOL_INDEX[r.tool] ?? 0), bin, args,
        label: id === 'fk-shim' ? `The fk command (${(r.paths || []).join(', ')})`
          : `${LABEL[r.tool] || r.tool}${r.version ? ` ${r.version}` : ''} (${r.how}${r.scope === 'machine' ? ', for the whole computer' : ''}${where})${SHARED.has(r.tool) ? '; other programs may use it too' : ''}` });
    }
  }
  // The fk command the kit wrote before the ledger recorded it.
  const shim = shimPaths(home);
  const shimFiles = [shim.js, ...Object.keys(shim.files)].filter((f) => shimMarked(f));
  if (shimFiles.length && !items.some((x) => x.id === 'fk-shim')) {
    const paths = shimFiles.map((f) => tilde(f, home));
    add({ id: 'fk-shim', tool: 'fk-shim', group: 'installed', phase: 8, order: -100, how: 'script', paths, undo: `remove ${paths.join(' ')}`, label: `The fk command (${paths.join(', ')})` });
  }
  for (const c of cbmIndexes()) {
    add({ id: `codebase-memory-mcp:index:${c.name}`, tool: 'codebase-memory-mcp', group: 'data', phase: 6, cbm: c.name, how: 'codebase-memory-mcp',
      undo: `codebase-memory-mcp cli delete_project --project ${c.name}`, label: `codebase-memory index of ${c.root}` });
  }
  if (fs.existsSync(fkHome())) add({ id: 'fk-home', tool: 'fk-home', group: 'data', phase: 11, how: 'folder', paths: [tilde(fkHome(), home)], undo: `delete the folder ${tilde(fkHome(), home)}`,
    label: `The kit's own folder ${tilde(fkHome(), home)} (logs, approvals, caches, this install list)` });
  items.sort((a, b) => a.phase - b.phase || (a.order ?? 0) - (b.order ?? 0));
  return { items, manual };
}

// Is the item still on this computer? (Before listing it, and after removing it.)
export function isPresent(it, { env = process.env, home = os.homedir(), cbmNames = () => [] } = {}) {
  if (it.plugin) return !!(readJson(path.join(pluginsDir(), 'installed_plugins.json'), {})?.plugins || {})[it.plugin];
  if (it.marketplace) return !!(readJson(path.join(pluginsDir(), 'known_marketplaces.json'), {}) || {})[it.marketplace];
  if (it.fn === 'silent-save') return readJson(untilde(it.file || '', home), {})?.hooks?.silent_save === true;
  if (it.fn === 'user-path') return winUserPathEntry(untilde(it.dir, home));
  if (it.cbm) return cbmNames().includes(it.cbm);
  if (it.id === 'git-lfs:config') return !!probe('git', ['config', '--global', '--get', 'filter.lfs.process'], env)?.out;
  if (it.id === 'podman:machine') return (probe('podman', ['machine', 'list', '--format', 'json'], env)?.out || '').includes(`"${it.name}"`);
  if (it.tool === 'codebase-memory-mcp' && it.value !== undefined) return probe('codebase-memory-mcp', ['config', 'get', it.id.split(':')[1]], env)?.out === it.value;
  if (it.paths) return it.paths.some((p) => fs.existsSync(untilde(p, home)));
  if (it.bin) return it.how === 'mise' ? !!probe('mise', ['exec', '--', it.bin, '--version'], env) : !!probe(it.bin, it.args, env);
  return true;
}

function removeOne(it, { exec, home }) {
  if (it.fn === 'silent-save') {
    const f = untilde(it.file || '', home);
    const cfg = readJson(f, null);
    if (cfg?.hooks?.silent_save === true) { delete cfg.hooks.silent_save; if (!Object.keys(cfg.hooks).length) delete cfg.hooks; fs.writeFileSync(f, JSON.stringify(cfg, null, 2) + '\n'); }
    return;
  }
  if (it.fn === 'user-path') { winUserPathEntry(untilde(it.dir, home), { remove: true }); return; }
  if (it.paths && (it.how === 'script' || it.group === 'data') && !/^codebase-memory-mcp uninstall/.test(it.undo || '')) {
    for (const p of it.paths) { const abs = safePath(p, home); if (abs) fs.rmSync(abs, { recursive: true, force: true }); }
    return;
  }
  exec({ cmd: it.undo });
}

// The PATH entry stays while anything is left in that folder (uv, claude and others the founder installed put files there).
const blocked = (it, home) => {
  if (it.fn !== 'user-path') return null;
  let left = [];
  try { left = fs.readdirSync(untilde(it.dir, home)); } catch { /* gone */ }
  return left.length ? `kept: other programs in ${it.dir} still use it` : null;
};

function parseIds(args, flag) {
  const out = [];
  for (let i = 0; i < args.length; i++) if (args[i] === flag && args[i + 1]) out.push(...args[++i].split(',').map((s) => s.trim()).filter(Boolean));
  return out;
}
const matches = (it, ids) => ids.some((x) => it.id === x || it.id.startsWith(`${x}:`) || it.tool === x);

function list(items, sel, out, numbered) {
  let n = 0;
  for (const [g, title] of GROUPS) {
    const gi = items.filter((it) => it.group === g);
    if (!gi.length) continue;
    out(`\n${title}${g === 'data' ? ' (not selected unless you choose it)' : ''}:`);
    for (const it of gi) {
      n = items.indexOf(it) + 1;
      out(`  [${sel.has(it.id) ? 'x' : ' '}] ${numbered ? `${String(n).padStart(2)}. ` : ''}${it.label}${numbered ? '' : `   id: ${it.id}`}`);
    }
  }
}

async function choose(items, sel, { ask, out }) {
  for (;;) {
    list(items, sel, out, true);
    out('\nType numbers to switch items on or off (for example: 3 5), a = all, n = none, p = the Founder Kit plugin only. Press Enter when done.');
    const a = String(await ask('> ')).trim().toLowerCase();
    if (!a) return sel;
    if (a === 'a') sel = new Set(items.map((it) => it.id));
    else if (a === 'n') sel = new Set();
    else if (a === 'p') sel = new Set(items.filter((it) => it.kitPlugin).map((it) => it.id));
    else {
      const nums = a.split(/[\s,]+/).map(Number);
      if (nums.some((x) => !Number.isInteger(x) || x < 1 || x > items.length)) { out(`Not understood: "${a}". Use numbers from 1 to ${items.length}, a, n, p, or Enter.`); continue; }
      for (const x of nums) { const id = items[x - 1].id; if (sel.has(id)) sel.delete(id); else sel.add(id); }
    }
  }
}

// The tools `fk provision` added to a project and has not rolled back (the latest ledger line per name is an install), from
// <project>/.fk/ledger.jsonl. [] without a ledger; null when it exists but cannot be read.
export function provisioned(root) {
  const file = path.join(root, '.fk', 'ledger.jsonl');
  if (!fs.existsSync(file)) return [];
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const last = new Map();
  for (const l of text.split('\n').filter(Boolean)) {
    let r = null;
    try { r = JSON.parse(l); } catch { /* a broken line */ }
    if (r?.name && (r.kind === 'install' || r.kind === 'rollback')) last.set(r.name, r);
  }
  return [...last.values()].filter((r) => r.kind === 'install').map((r) => ({ name: r.name, version: r.version || null }));
}

function showProjects(plan, out) {
  out('\nProjects set up for the kit (cleaning them up needs the kit, so it comes before anything is removed):');
  for (const p of plan) {
    out(`  ${p.root}`);
    if (p.tools === null) out('    Tools added with fk provision: their list (.fk/ledger.jsonl) could not be read. In that project, fk provision rollback <name> takes each one back out.');
    else if (p.tools.length) out(`    Tools added with fk provision: ${p.tools.map((t) => (t.version ? `${t.name} ${t.version}` : t.name)).join(', ')} (each comes back out with: fk provision rollback <name>, in that project)`);
    out('    The kit\'s setup in the project (.fk/, git hook settings, the rules it added; your docs stay) comes out with: fk uninstall, in that project.');
  }
}

// Per project: y = yes, Enter or s = skip, a = yes for this and every later project, n = no for every later project.
async function askProjects(plan, io, out) {
  const all = {};
  const ask = async (key, q) => {
    if (key in all) return all[key];
    const a = String(await io.ask(`${q} [y = yes, s = skip, a = yes for every project, n = no for every project] `)).trim().toLowerCase();
    if (a === 'a' || a === 'n') all[key] = a === 'a';
    return a === 'a' || a.startsWith('y');
  };
  for (const p of plan) {
    out(`\n${p.root}`);
    if (p.tools?.length) p.rollback = await ask('rollback', `Roll back the tools fk provision added here (${p.tools.map((t) => t.name).join(', ')})?`);
    p.uninstall = await ask('uninstall', 'Take the kit out of this project (fk uninstall)?');
  }
}

// Runs the chosen project steps with the kit's own CLI, inside each project. A project whose rollback failed keeps its kit
// setup: its ledger is what fk provision rollback needs. Returns the number of steps that failed.
function runProjects(plan, { runFk, out }) {
  let failed = 0;
  for (const p of plan) {
    let ok = true;
    for (const t of p.rollback ? p.tools || [] : []) {
      out(`- ${p.root}: fk provision rollback ${t.name}`);
      const r = runFk(['provision', 'rollback', t.name], p.root);
      if (r.ok) { out('  rolled back'); continue; }
      ok = false; failed++;
      out(`  could not roll it back${r.tail ? ` (${r.tail})` : ''}. In that project, run: fk provision rollback ${t.name}`);
    }
    if (!p.uninstall) continue;
    if (!ok) { failed++; out(`- ${p.root}: the kit stays in this project, because a rollback failed (its list in .fk/ is still needed). Once that is sorted, run fk uninstall there.`); continue; }
    out(`- ${p.root}: fk uninstall`);
    const r = runFk(['uninstall'], p.root);
    if (r.ok) out('  the kit is out of this project (docs/ and .omc/ stay)');
    else { failed++; out(`  could not take it out${r.tail ? ` (${r.tail})` : ''}. In that project, run: fk uninstall`); }
  }
  return failed;
}

function lineReader() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return { ask: (q) => new Promise((res) => rl.question(q, res)), close: () => rl.close() };
}

export async function runSystemUninstall(args = [], deps = {}) {
  const out = deps.out || ((s = '') => process.stdout.write(s + '\n'));
  const env = deps.env || process.env;
  if (env.CLAUDE_CODE_CHILD_SESSION === '1') { out(`fk uninstall --system: refused: ${AGENT_REFUSED}`); return 1; }
  const home = deps.home || os.homedir();
  const known = new Set(['--system', '--dry-run', '--yes', '-y', '--plugin-only', '--only', '--keep', '--rollbacks', '--projects']);
  const bad = args.filter((a, i) => a.startsWith('-') && !known.has(a) && !['--only', '--keep'].includes(args[i - 1]));
  if (bad.length) { out(USAGE); return 2; }
  const dry = args.includes('--dry-run'), yes = args.includes('--yes') || args.includes('-y'), pluginOnly = args.includes('--plugin-only');
  const only = parseIds(args, '--only'), keep = parseIds(args, '--keep');
  const exec = deps.exec || ((step) => realExec(step, env));
  const cbmList = deps.cbmList || (() => cbmProjects(env));
  const present = deps.present || ((it) => isPresent(it, { env, home, cbmNames: () => cbmList().map((p) => p.name) }));
  const projects = deps.projects || (() => kitProjects());
  const runFk = deps.runFk || ((fkArgs, cwd) => {
    const r = spawnSync(process.execPath, [FK_CLI, ...fkArgs], { cwd, env, encoding: 'utf8', timeout: 20 * 60 * 1000 });
    return { ok: r.status === 0, tail: `${r.stdout || ''}\n${r.stderr || ''}`.trim().split('\n').slice(-2).join(' | ') };
  });

  const roots = projects();
  const plan = roots.map((root) => ({ root, tools: provisioned(root), rollback: false, uninstall: false }));
  const norm = (p) => path.resolve(p).toLowerCase();
  const { items: all, manual } = buildItems({ home, rows: deps.rows, src: deps.src || kitSource(),
    cbmIndexes: () => cbmList().filter((p) => roots.some((r) => norm(r) === norm(p.root_path || ''))).map((p) => ({ name: p.name, root: p.root_path })) });
  const items = all.filter((it) => present(it)); // gone already: nothing to do
  if (!items.length) { out('fk uninstall --system: nothing Founder Kit installed is left on this computer.'); return 0; }
  const unknown = [...only, ...keep].filter((x) => !items.some((it) => matches(it, [x])));
  if (unknown.length) { out(`fk uninstall --system: unknown id(s): ${unknown.join(', ')}. The ids are listed by: fk uninstall --system --dry-run`); return 2; }

  let sel = new Set(items.filter((it) => (pluginOnly ? it.kitPlugin : only.length ? matches(it, only) : it.group !== 'data') && !matches(it, keep)).map((it) => it.id));
  out('Founder Kit: what it put on this computer');
  out('Only things the kit installed, changed or created are listed. Anything that was here before the kit is never touched.');
  if (manual.length) out(`Left in place: ${manual.join('; ')}.`);
  const tty = deps.isTTY ?? !!process.stdin.isTTY;
  const io = deps.ask ? { ask: deps.ask, close: () => {} } : (!dry && !yes && tty ? lineReader() : null);
  try {
    if (dry || yes || !io) {
      list(items, sel, out, false);
      if (plan.length) {
        showProjects(plan, out);
        for (const p of plan) { p.rollback = args.includes('--rollbacks'); p.uninstall = args.includes('--projects'); }
        out(`With --yes: ${args.includes('--rollbacks') ? 'the tools above are rolled back (--rollbacks)' : 'add --rollbacks to roll the tools above back'}; ${args.includes('--projects') ? 'fk uninstall runs in each project (--projects)' : 'add --projects to run fk uninstall in each project'}.`);
      }
      if (dry) { out('\nDry run: nothing was changed.'); return 0; }
      if (!yes) { out('\nNothing was changed. To remove the [x] items, run: fk uninstall --system --yes (change the choice with --only <ids>, --keep <ids> or --plugin-only).'); return 1; }
    } else sel = await choose(items, sel, { ask: io.ask, out });

    let chosen = items.filter((it) => sel.has(it.id));
    if (!chosen.length) { out('Nothing selected; nothing was changed.'); return 0; }
    if (!yes) {
      const machine = chosen.find((it) => it.warn);
      if (machine && !/^y/i.test(String(await io.ask('\nThe Podman machine holds your containers and images; they are deleted with it. Remove it? [y/N] ')).trim())) {
        chosen = chosen.filter((it) => it !== machine);
      }
      out('\nWill remove:');
      for (const it of chosen) out(`  - ${it.label}`);
      out('Everything else stays.');
      if (chosen.some((it) => /^sudo /.test(it.undo || ''))) out('Some steps use sudo: your computer password may be asked.');
      if (plan.length && chosen.some((it) => it.id === 'founder-kit:plugin')) { showProjects(plan, out); await askProjects(plan, io, out); }
      if (/^n/i.test(String(await io.ask('Remove these now? [Y/n] ')).trim())) { out('Nothing was changed.'); return 1; }
    }

    const projectFailures = runProjects(plan, { runFk, out });
    const failed = [];
    for (const it of chosen) {
      const why = blocked(it, home);
      if (why) { out(`- ${it.label}: ${why}`); continue; }
      out(`- ${it.label}`);
      try { removeOne(it, { exec, home }); } catch (e) { out(`  error: ${e.message}`); }
      if (present(it)) { failed.push(it); out(`  could not remove it. To do it yourself: ${it.undo}`); continue; }
      out('  removed');
      if (it.id !== 'fk-home' && fs.existsSync(fkHome())) {
        try { appendLedger({ via: 'fk uninstall --system', tool: it.tool, item: it.id, kind: 'removed', action: 'remove', ok: true }); } catch { /* the folder may be going too */ }
      }
    }
    out(`\nRemoved ${chosen.length - failed.length} of ${chosen.length}.${failed.length || projectFailures ? ' The steps that failed are above, each with the command to run yourself; nothing was retried.' : ''}`);
    const still = roots.filter((r) => fs.existsSync(path.join(r, '.fk')));
    if (still.length) out(`Projects still set up for the kit (their .fk/ folder): ${still.join(', ')}. In each, run \`fk uninstall\` to take the kit out of the project.`);
    if (chosen.some((it) => it.plugin)) out('Restart Claude Code so it stops loading the removed plugins.');
    return failed.length || projectFailures ? 1 : 0;
  } finally { io?.close(); }
}

// codebase-memory-mcp's indexed projects ({ name, root_path }); [] when it is not installed.
function cbmProjects(env) {
  const r = probe('codebase-memory-mcp', ['cli', 'list_projects'], env);
  if (!r) return [];
  try { return JSON.parse(r.out.slice(r.out.indexOf('{'))).projects || []; } catch { return []; }
}
