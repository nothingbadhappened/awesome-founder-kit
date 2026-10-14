// fk update [--check] [--to <version>] [--dry-run] [--yes]
// Shows what changed (CHANGELOG.md entries between the installed and the new version), then one plan: refresh the kit's
// marketplace, update the founder-kit plugin and any installed practice packs, check the base tools against the new
// compat.lock.json (fk setup --dry-run; asked once more when something needs installing), bring the kit state up to
// date (migrations), fk doctor. Never automatic, never a downgrade. From an agent shell it shows the plan and the line the
// founder types (fk-approve update <version> <reason>); `fk update --yes` there runs only after that line. Hidden: --refresh (the session note's background check),
// --migrate (run by the new version after an update).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJson, cmpVer, findRoot, log } from '../../hooks/lib.mjs';
import { takeUpdateApproval } from '../../hooks/directives/update.mjs';
import { realExec } from './setup/core.mjs';
import { kitVersion, kitSource, fetchKitLatest, readChangelog, sliceChangelog, lockChanges, pluginsDir } from './update/release.mjs';
import { migrateAll } from './update/migrations.mjs';

const SELF = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fk.mjs');
const USAGE = 'usage: fk update [--check] [--to <version>] [--dry-run] [--yes]';

function askYes(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(question, (a) => { rl.close(); res(!/^\s*n/i.test(a)); }));
}
const runFkDefault = (cli, args, { capture = false, env = process.env } = {}) => {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
  return { code: r.status ?? 1, stdout: r.stdout || '' };
};

// The kit's plugins Claude Code has installed from the kit's marketplace: founder-kit and fk-practice-* packs.
export function kitPlugins(name, file = path.join(pluginsDir(), 'installed_plugins.json')) {
  const keys = Object.keys(readJson(file, {})?.plugins || {});
  return keys.filter((k) => k === `founder-kit@${name}`).concat(keys.filter((k) => new RegExp(`^fk-practice-[\\w.-]+@${name.replace(/[.]/g, '\\.')}$`).test(k)).sort());
}
function installedKit(name, file = path.join(pluginsDir(), 'installed_plugins.json')) {
  const e = [].concat(readJson(file, {})?.plugins?.[`founder-kit@${name}`] || [])[0];
  if (!e) return null;
  return { path: e.installPath || null, version: (e.installPath && kitVersion(e.installPath)) || e.version || null };
}

export async function runUpdate(args = [], deps = {}) {
  const out = deps.out || ((s = '') => process.stdout.write(s + '\n'));
  const env = deps.env || process.env;
  const get = deps.fetch || globalThis.fetch;
  const exec = deps.exec || ((step) => realExec(step, env));
  const runFk = deps.runFk || runFkDefault;
  const src = deps.src || kitSource();
  if (args.includes('--refresh')) { await fetchKitLatest({ fetch: get, repo: src.repo, force: true }); return 0; }
  if (args.includes('--migrate')) {
    const done = migrateAll().filter((r) => r.ran.length);
    out(done.length ? `fk update: kit state brought up to date in ${done.length} project(s).` : 'fk update: kit state already up to date.');
    return 0;
  }
  const ti = args.indexOf('--to');
  const to = ti >= 0 ? /^v?(\d+\.\d+\.\d+)$/.exec(args[ti + 1] || '')?.[1] : null;
  if (ti >= 0 && !to) { out(USAGE); return 2; }
  const check = args.includes('--check'), dry = args.includes('--dry-run'), yes = args.includes('--yes') || args.includes('-y');
  const agent = env.CLAUDE_CODE_CHILD_SESSION === '1';
  const cur = deps.current || kitVersion();

  const latest = await fetchKitLatest({ fetch: get, repo: src.repo, force: true });
  const target = to || latest;
  if (!target) { out('fk update: could not reach GitHub to see the newest version (offline?). Nothing was changed; try again later.'); return 1; }
  if (cmpVer(target, cur) < 0) { out(`fk update: ${target} is older than the installed ${cur}. fk update never goes back to an older version.`); return 1; }
  if (latest && to && cmpVer(to, latest) > 0) { out(`fk update: ${to} is not published yet (the newest is ${latest}).`); return 1; }
  if (cmpVer(target, cur) === 0) { out(`Founder Kit ${cur} is installed${to ? '' : ': the newest version'}. Nothing to update.`); return 0; }

  out(`Founder Kit ${cur} is installed; ${target} is ${to && to !== latest ? 'the version you asked for' : 'the newest'}.`);
  const notes = sliceChangelog(await readChangelog({ fetch: get, src }), cur, target);
  out('\nWhat changed:');
  if (!notes.length) out('  (no notes were published for these versions)');
  for (const n of notes) out(`  ${n.version}${n.date ? ` (${n.date})` : ''}: ${n.body.replace(/\s*\n\s*/g, ' ')}`);
  if (check) { out(`\nTo update: fk update${to ? ` --to ${to}` : ''}`); return 0; }

  const plugins = kitPlugins(src.name);
  if (to && latest && cmpVer(to, latest) < 0) {
    // Claude Code follows one ref per marketplace (owner/repo#ref); a marketplace can only move to another tag by being
    // added again, and removing it also takes its plugins out until they are installed again. That is the founder's call.
    out(`\n${to} is not the newest version, so Claude Code has to follow the kit at that tag. That means adding the kit's marketplace again,`);
    out('and removing it takes the kit\'s plugins out until they are installed again. Run these yourself in a terminal, in this order:');
    out(`  claude plugin marketplace remove ${src.name}`);
    out(`  claude plugin marketplace add ${src.repo}#v${to}`);
    for (const p of plugins.length ? plugins : [src.plugin]) out(`  claude plugin install ${p}`);
    out('  fk setup');
    out('  fk doctor');
    out('Then restart Claude Code. To follow the newest version again later: remove and add the marketplace without #v<version>, then fk update.');
    return 0;
  }

  const steps = [`claude plugin marketplace update ${src.name}`, ...(plugins.length ? plugins : [src.plugin]).map((p) => `claude plugin update ${p}`)];
  const pins = await lockChanges({ fetch: get, src, version: target });
  out('\nPlan:');
  out('  1. Update the kit (founder-kit plugin' + (plugins.length > 1 ? ' and the practice packs you have' : '') + '):');
  for (const s of steps) out(`       > ${s}`);
  out('  2. Check the base tools against the new version\'s pinned list (fk setup --dry-run). If anything needs installing or updating, you are asked once more first.');
  if (pins?.length) out(`       pinned versions that change: ${pins.map((c) => `${c.id} ${c.from || '-'} -> ${c.to || '-'}`).join(', ')}`);
  out('  3. Bring the kit\'s saved state up to date for the new version.');
  out('  4. Run fk doctor.');
  out('  Nothing is downgraded or removed. Afterwards, restart Claude Code to load the new version.');
  if (dry) { out('\nDry run: nothing was changed.'); return 0; }
  // From an agent shell, --yes needs the founder's own typed line (fk-approve update <version> <reason>, used once,
  // within 30 minutes), like every other approval: an agent's "the founder said yes" is not one.
  const typeLine = `fk-approve update ${target} <reason>`;
  if (agent) {
    const root = deps.root !== undefined ? deps.root : findRoot(process.cwd())?.root;
    const a = yes && root ? takeUpdateApproval(root, target) : null;
    if (!a) {
      out(`\nThis changes the installed kit. Show the founder this plan in plain words. To go ahead, the founder types this line alone as a message${root ? '' : ' (in a session inside a project set up with fk init)'}:`);
      out(`  ${typeLine}`);
      out('Then run: fk update --yes. Or the founder runs fk update in a terminal.');
      if (yes) out('Nothing was changed: no founder-typed approval for this version.');
      return yes ? 1 : 0;
    }
    log(root, { event: 'cli', guard: 'fk', decision: 'update-approved', version: target, reason: a.reason });
  } else if (!yes) {
    const tty = deps.isTTY ?? !!process.stdin.isTTY;
    if (!tty) { out('\nNothing was changed. To go ahead, run: fk update --yes'); return 1; }
    if (!await (deps.ask || askYes)('\nUpdate now? [Y/n] ')) { out('Nothing was changed.'); return 1; }
  }

  for (const cmd of steps) {
    out(`\n-> ${cmd}`);
    if (!exec({ cmd }).ok) {
      out(`   failed. Nothing after this step was run. Run it yourself to see why: ${cmd}`);
      return 1;
    }
  }
  const now = deps.installed ? deps.installed() : installedKit(src.name);
  if (!now?.version || cmpVer(now.version, target) < 0) {
    out(`\nThe plugin still reports ${now?.version || 'no version'} after the update, not ${target}. Run \`claude plugin update ${src.plugin}\` yourself to see why, then restart Claude Code.`);
    return 1;
  }
  out(`\nFounder Kit ${now.version} is installed.`);
  const cli = now.path && fs.existsSync(path.join(now.path, 'bin', 'fk.mjs')) ? path.join(now.path, 'bin', 'fk.mjs') : SELF;
  const plan = runFk(cli, ['setup', '--dry-run'], { capture: true, env });
  out(plan.stdout.trimEnd());
  if (/\nPlan \(/.test(plan.stdout)) {
    const tty = deps.isTTY ?? !!process.stdin.isTTY;
    if (agent) out('\nThe new version needs base tool changes (above). Ask the founder (AskUserQuestion); after a yes run: fk setup --yes');
    else if (tty && await (deps.ask || askYes)('\nInstall and set up these now? [Y/n] ')) runFk(cli, ['setup', '--yes'], { env });
    else out('\nBase tools were not changed. When you are ready, run: fk setup --yes');
  }
  runFk(cli, ['update', '--migrate'], { env });
  runFk(cli, ['doctor'], { env });
  out('\nRestart Claude Code to load the new version.');
  return 0;
}

export default async function update(args) {
  process.exitCode = await runUpdate(args);
}
