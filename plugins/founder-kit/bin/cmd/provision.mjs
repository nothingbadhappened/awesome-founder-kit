// fk provision <id> [--dry-run] | fk provision rollback <name>
// Installs exactly the founder-approved entries of a proposal: skills and plugins are scanned with SkillSpector in quarantine
// first, every install is pinned, verified and written to .fk/ledger.jsonl with its rollback. MCP servers go into the project
// .mcp.json and the project allowlist through the sanctioned path. Failures become plain-words entries in docs/process/BLOCKED.md.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectRoot, rel, load, save, fileHash, forOs, specsFor, quarantine, skillspector, blocked, ledger, readLedger, readJson,
  contract, say, ID } from './scout/lib.mjs';

const USAGE = 'usage: fk provision <proposal-id> [--dry-run] | fk provision rollback <name>';
const SETTINGS = '.claude/settings.json';

function run(root, cmd) {
  const r = spawnSync(cmd, { shell: true, cwd: root, encoding: 'utf8', timeout: 20 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  const tail = `${r.stdout || ''}\n${r.stderr || ''}`.trim().split('\n').slice(-3).join(' | ');
  return { ok: r.status === 0, tail };
}

function addMcp(root, name, server) {
  const cap = contract().budget?.max_active_mcp_servers ?? 6;
  const mcp = readJson(path.join(root, '.mcp.json'), {});
  mcp.mcpServers = { ...(mcp.mcpServers || {}), [name]: server };
  if (Object.keys(mcp.mcpServers).length > cap) return `the project would have more than ${cap} MCP servers`;
  const settings = readJson(path.join(root, SETTINGS), {});
  settings.enabledMcpjsonServers = [...new Set([...(settings.enabledMcpjsonServers || []), name])];
  save(root, '.mcp.json', mcp);
  save(root, SETTINGS, settings);
  return null;
}

function removeMcp(root, name) {
  const mcp = readJson(path.join(root, '.mcp.json'), {});
  if (mcp.mcpServers) delete mcp.mcpServers[name];
  save(root, '.mcp.json', mcp);
  const settings = readJson(path.join(root, SETTINGS), {});
  if (settings.enabledMcpjsonServers) settings.enabledMcpjsonServers = settings.enabledMcpjsonServers.filter((n) => n !== name);
  save(root, SETTINGS, settings);
}

// Loads the approved entries; null (with a message) when the approval or the proposal does not hold up.
function approvedEntries(root, id) {
  const approval = load(root, rel.approval(id));
  if (!approval) { say(`fk provision: proposal ${id} is not approved. The founder approves it by typing: fk-approve proposal ${id}`); return null; }
  const p = load(root, rel.proposal(id));
  if (!p || fileHash(root, rel.proposal(id)) !== approval.hash) { say(`fk provision: proposal ${id} changed after the founder approved it. Nothing installed; make a delta proposal.`); return null; }
  const tc = load(root, rel.toolchain, null);
  if (!tc) { say('fk provision: .fk/toolchain.json was changed outside the kit. Nothing installed.'); return null; }
  const allowed = new Set(tc.approved || []);
  const entries = p.entries.filter((e) => approval.approved.includes(e.name));
  const missing = entries.filter((e) => specsFor(e).some((s) => !allowed.has(s)));
  if (missing.length) { say(`fk provision: not on the approved toolchain: ${missing.map((e) => e.name).join(', ')}. Nothing installed.`); return null; }
  return { p, entries };
}

function plan(e) {
  if (['service', 'account'].includes(e.kind)) return [`needs you: ${e.why}${e.cost ? ` (${e.cost})` : ''}`];
  const steps = [];
  const verify = forOs(e.verify);
  if (e.present) return [`already on this computer${verify ? `; check: ${verify}` : ''}`];
  if (verify) steps.push(`check first: ${verify} (skip if it passes)`);
  if (['skill', 'plugin'].includes(e.kind)) steps.push(`scan ${e.source} with SkillSpector in quarantine; reject on findings`);
  const install = forOs(e.install);
  if (install) steps.push(`install: ${install}`);
  else if (e.kind === 'skill') steps.push(`copy the scanned files to .claude/skills/${e.name}/`);
  if (e.kind === 'mcp' && e.mcp) steps.push(`add "${e.name}" to .mcp.json and the project MCP allowlist`);
  if (verify) steps.push(`verify: ${verify}`);
  steps.push(`ledger rollback: ${forOs(e.uninstall) || (e.kind === 'skill' ? `remove .claude/skills/${e.name}/` : e.kind === 'mcp' ? `remove "${e.name}" from .mcp.json` : 'none')}`);
  return steps;
}

function installOne(root, id, e, report) {
  const fail = (what, options) => {
    blocked(root, `${e.name} was not installed`, what, options);
    report.blocked.push(e.name);
  };
  if (['service', 'account'].includes(e.kind)) return report.later.push(e.name);
  const verify = forOs(e.verify);
  if (e.present || (verify && run(root, verify).ok)) return report.present.push(e.name);
  let scanned = null;
  if (['skill', 'plugin'].includes(e.kind)) {
    try { scanned = quarantine(e.source); } catch (err) { return fail(`Its files could not be fetched for the safety scan (${err.message}).`, ['Try again later', 'Remove it from the toolchain with a delta proposal']); }
    const s = skillspector(scanned);
    if (!s.ran) return fail(`It could not be safety-scanned: ${s.note}`, ['Install SkillSpector (see fk doctor), then run fk provision again', 'Leave this tool out']);
    if (!s.ok) return fail(`The safety scan (SkillSpector) found problems, so it was rejected: ${(s.issues || []).slice(0, 3).join('; ') || 'see its report'}.`, ['Leave it out (recommended)', 'Ask for an alternative tool in a delta proposal']);
  }
  const install = forOs(e.install);
  const undo = { name: e.name, version: e.version ?? null, proposal: id };
  if (install) {
    const r = run(root, install);
    if (!r.ok) return fail(`The install command failed: \`${install}\`. Last output: ${r.tail || 'none'}.`, ['Let Claude try once more after checking the error', 'Install it by hand and tell Claude', 'Leave it out']);
    undo.command = install;
    undo.rollback = forOs(e.uninstall) || null;
  } else if (e.kind === 'skill') {
    const dst = path.join(root, '.claude', 'skills', e.name);
    fs.rmSync(dst, { recursive: true, force: true });
    fs.cpSync(scanned, dst, { recursive: true, verbatimSymlinks: true });
    undo.command = `copy scanned ${e.source} to .claude/skills/${e.name}`;
    undo.rollback = `remove .claude/skills/${e.name}`;
    undo.path = `.claude/skills/${e.name}`;
  }
  if (e.kind === 'mcp' && e.mcp) {
    const err = addMcp(root, e.name, e.mcp);
    if (err) return fail(`It was not connected: ${err}.`, ['Drop a less useful MCP server in a delta proposal', 'Use its vendor CLI instead']);
    undo.mcp = e.name;
    undo.command ||= `add ${e.name} to .mcp.json`;
    undo.rollback ||= `remove ${e.name} from .mcp.json`;
  }
  ledger(root, { kind: 'install', ...undo });
  if (verify && !run(root, verify).ok) return fail(`It installed, but its check failed: \`${verify}\`. It can be undone with: fk provision rollback ${e.name}.`, ['Let Claude look into the check', 'Roll it back']);
  report.installed.push(e.name);
}

function environment(root, p, report, dry) {
  const env = p.environment || {};
  if (env.env_vars?.length) {
    const file = path.join(root, '.env.example');
    const have = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const add = env.env_vars.filter((n) => /^[A-Z_][A-Z0-9_]*$/.test(n) && !new RegExp(`^${n}=`, 'm').test(have));
    if (dry) { if (add.length) say(`- environment: add names to .env.example: ${add.join(', ')}`); }
    else if (add.length) fs.writeFileSync(file, have + (have && !have.endsWith('\n') ? '\n' : '') + add.map((n) => `${n}=`).join('\n') + '\n');
  }
  for (const v of env.verify || []) {
    const cmd = forOs(v);
    if (!cmd) continue;
    if (dry) { say(`- environment check: ${cmd}`); continue; }
    if (!run(root, cmd).ok) {
      blocked(root, 'an environment check failed', `The check \`${cmd}\` did not pass after setup.`, ['Let Claude look into it', 'Fix it by hand and tell Claude']);
      report.blocked.push(`check: ${cmd}`);
    }
  }
}

function rollback(root, name) {
  const rows = readLedger(root);
  const last = [...rows].reverse().find((r) => r.name === name && (r.kind === 'install' || r.kind === 'rollback'));
  if (!last || last.kind !== 'install') { say(`fk provision: nothing installed under "${name}" to roll back.`); process.exitCode = 1; return; }
  if (last.mcp) removeMcp(root, last.mcp);
  if (last.path) fs.rmSync(path.join(root, last.path), { recursive: true, force: true });
  let ok = true;
  if (last.rollback && !last.path && !/^remove .+ from \.mcp\.json$/.test(last.rollback)) {
    const r = run(root, last.rollback);
    ok = r.ok;
    if (!ok) blocked(root, `${name} could not be removed`, `The uninstall command failed: \`${last.rollback}\`. Last output: ${r.tail || 'none'}.`, ['Let Claude try again', 'Remove it by hand']);
  }
  ledger(root, { kind: 'rollback', name, version: last.version, command: last.rollback, ok });
  say(ok ? `fk provision: rolled back ${name}${last.version ? ' ' + last.version : ''}.` : `fk provision: rollback of ${name} failed; see docs/process/BLOCKED.md.`);
  if (!ok) process.exitCode = 1;
}

export default async function provision(args) {
  const [first, second] = args;
  if (!first) { say(USAGE); process.exitCode = 1; return; }
  const root = projectRoot();
  if (!root) return;
  if (first === 'rollback') { if (!second) { say(USAGE); process.exitCode = 1; return; } return rollback(root, second); }
  if (!ID.test(first)) { say(USAGE); process.exitCode = 1; return; }
  const got = approvedEntries(root, first);
  if (!got) { process.exitCode = 1; return; }
  const dry = args.includes('--dry-run');
  if (dry) {
    say(`fk provision ${first} (dry run: nothing is installed):`);
    for (const e of got.entries) { say(`- ${e.name}${e.version ? ' ' + e.version : ''} (${e.kind})`); for (const s of plan(e)) say(`    ${s}`); }
    environment(root, got.p, null, true);
    return;
  }
  const report = { installed: [], present: [], later: [], blocked: [] };
  for (const e of got.entries) installOne(root, first, e, report);
  environment(root, got.p, report, false);
  const line = (label, xs) => (xs.length ? `${label}: ${xs.join(', ')}.` : null);
  say(['fk provision: done.', line('Installed', report.installed), line('Already there', report.present),
    line('Needs you later', report.later), line('Blocked (see docs/process/BLOCKED.md)', report.blocked)].filter(Boolean).join(' '));
  if (report.blocked.length) process.exitCode = 1;
}
