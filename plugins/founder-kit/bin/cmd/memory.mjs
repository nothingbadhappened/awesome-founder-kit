// fk memory setup | status | forget --purge [--yes]   (§9.1 context hygiene, §9.2 local stewardship)
// setup: merges permissions.deny for heavy memory tools into the project's .claude/settings.json (never removes or
// rewrites existing keys) and optionally project-scoped enabledPlugins false entries (--disable plugin@marketplace).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJson, writeJson } from '../../hooks/lib.mjs';
import { say, needRoot, parseArgs, many, sanctioned, slug, tool, fkWrite } from './adopt/util.mjs';

export const MEMORY = '.fk/memory.json';

const MP = 'mcp__plugin_mempalace_mempalace__mempalace_';
const CBM = 'mcp__codebase-memory-mcp__';
// MemPalace 3.10.0 logstream, task, patch, artifact, tunnel and hallway tools: agent-coordination features the kit does not use.
export const MP_DENY = ['event_ack', 'event_append', 'event_list', 'event_wait', 'task_create', 'patch_submit', 'artifact_get', 'artifact_put',
  'create_tunnel', 'delete_tunnel', 'follow_tunnels', 'find_tunnels', 'list_tunnels', 'delete_hallway', 'list_hallways'].map((t) => MP + t);
// codebase-memory-mcp 0.9.0 tools outside the kit allowlist (search_graph, trace_path, get_code_snippet, get_architecture,
// detect_changes, index_status, index_repository, search_code).
export const CBM_DENY = ['query_graph', 'get_graph_schema', 'list_projects', 'delete_project', 'manage_adr', 'ingest_traces'].map((t) => CBM + t);
const KIT_PLUGINS = /^(founder-kit|oh-my-claudecode|mempalace)@/;
const CAPS = { cbmMb: 300, mpDrawers: 20000 };
const USAGE = 'usage: fk memory setup [--disable plugin@marketplace]... | fk memory status [--wing <name>] | fk memory forget --purge [--wing <name>] [--yes]';

function setup(root, flags) {
  const rel = '.claude/settings.json';
  const file = path.join(root, rel);
  let s = {};
  if (fs.existsSync(file)) {
    try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { say(`fk memory: ${rel} is not valid JSON; left unchanged. Fix it, then run this again.`); process.exitCode = 1; return; }
  }
  const before = JSON.stringify(s);
  const deny = (s.permissions ||= {}).deny ||= [];
  const added = [...MP_DENY, ...CBM_DENY].filter((t) => !deny.includes(t));
  deny.push(...added);
  const disabled = [];
  for (const p of many(flags.disable)) {
    if (!/^[\w.-]+@[\w.-]+$/.test(p)) { say(`fk memory: "${p}" is not plugin@marketplace; skipped.`); continue; }
    s.enabledPlugins ||= {};
    if (p in s.enabledPlugins) { say(`kept    enabledPlugins.${p} = ${s.enabledPlugins[p]} (already set by the project)`); continue; }
    s.enabledPlugins[p] = false;
    disabled.push(p);
  }
  if (JSON.stringify(s) === before) say(`fk memory: ${rel} already has the memory tool limits; unchanged.`);
  else {
    writeJson(file, s);
    // What the kit added, so `fk uninstall` can take exactly that back out.
    if (fs.existsSync(path.join(root, '.fk'))) {
      const m = readJson(path.join(root, MEMORY), {});
      fkWrite(root, MEMORY, { deny_added: [...new Set([...(m.deny_added || []), ...added])], plugins_disabled: [...new Set([...(m.plugins_disabled || []), ...disabled])] });
    }
    sanctioned(root, [rel],{ decision: 'memory-setup', reason: `deny +${added.length}${disabled.length ? `, plugins off: ${disabled.join(', ')}` : ''}` });
    say(`fk memory: ${rel}: ${added.length} memory tool(s) denied${disabled.length ? `, ${disabled.length} plugin(s) off for this project` : ''}; other settings kept.`);
  }
  // Guidance only: user-level plugins that load here too. Project false wins over user true (Claude Code settings precedence).
  const user = readJson(path.join(os.homedir(), '.claude', 'settings.json'), {}).enabledPlugins || {};
  const extra = Object.keys(user).filter((p) => user[p] === true && !KIT_PLUGINS.test(p) && !((s.enabledPlugins || {})[p] === false));
  if (extra.length) say(`fk memory: these user-level plugins also load in this project. If the toolchain does not need one, turn it off here with --disable: ${extra.join(', ')}`);
}

function cbmProject(root) {
  const r = tool('codebase-memory-mcp', ['cli', 'list_projects'], { shim: true });
  if (r.error || r.status !== 0) return { installed: false };
  let j; try { j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))); } catch { return { installed: true, project: null }; }
  const norm = (p) => path.resolve(p).toLowerCase();
  return { installed: true, project: (j.projects || []).find((p) => p.root_path && norm(p.root_path) === norm(root)) || null };
}

function mpWing(wing) {
  const r = tool('mempalace', ['status'], { timeout: 60000 });
  if (r.error) return { installed: false };
  let drawers = null, inWing = false;
  for (const l of `${r.stdout}`.split(/\r?\n/)) {
    const w = /^\s*WING:\s*(.+?)\s*$/.exec(l);
    if (w) { inWing = w[1] === wing; if (inWing) drawers = 0; continue; }
    const room = /ROOM:.*?(\d+)\s+drawers/.exec(l);
    if (room && inWing) drawers += Number(room[1]);
  }
  return { installed: true, palace: !/No palace found/i.test(r.stdout + r.stderr), drawers };
}

function status(root, flags) {
  const c = cbmProject(root);
  if (!c.installed) say('CBM       codebase-memory-mcp not found on PATH.');
  else if (!c.project) say('CBM       this repo is not indexed yet (index it with the MCP tool index_repository).');
  else {
    const mb = Math.round((c.project.size_bytes || 0) / 1048576);
    say(`CBM       ${c.project.name}: ${c.project.nodes} nodes, ${mb} MB${mb > CAPS.cbmMb ? `  WARNING over the ${CAPS.cbmMb} MB cap: re-index with mode "fast" or exclude generated folders` : ''}`);
  }
  const wing = flags.wing || slug(root);
  const m = mpWing(wing);
  if (!m.installed) say('MemPalace not found on PATH.');
  else if (!m.palace) say('MemPalace no palace yet (mempalace init).');
  else if (m.drawers == null) say(`MemPalace wing "${wing}" does not exist yet.`);
  else say(`MemPalace wing "${wing}": ${m.drawers} drawers${m.drawers > CAPS.mpDrawers ? `  WARNING over the ${CAPS.mpDrawers}-drawer cap: dedupe or mine fewer sessions` : ''}`);
}

function forget(root, flags) {
  if (!flags.purge) { say(USAGE); process.exitCode = 1; return; }
  const wing = flags.wing || slug(root);
  const c = cbmProject(root);
  const cmd = c.project ? ['cli', 'delete_project', '--project', c.project.name] : null;
  if (!c.installed) say('CBM: codebase-memory-mcp not found; nothing to remove.');
  else if (!cmd) say('CBM: this repo has no index; nothing to remove.');
  else if (!flags.yes) say(`CBM: would run: codebase-memory-mcp ${cmd.join(' ')}`);
  else {
    const r = tool('codebase-memory-mcp', cmd, { shim: true });
    say(r.status === 0 ? `CBM: index ${c.project.name} removed.` : `CBM: removal failed: ${(r.stderr || r.stdout || '').trim().split('\n').pop()}`);
  }
  // MemPalace 3.10.0 has no CLI command that deletes a wing; it is done through its MCP tools.
  say(`MemPalace: wing "${wing}" is removed from Claude, not the CLI: list its drawers with mempalace_list_drawers (wing "${wing}"), `
    + 'then for each source file call mempalace_delete_by_source with dry_run true, check the count, then dry_run false.');
  if (!flags.yes) say('Nothing was deleted. Add --yes to remove the CBM index.');
}

export default async function memory(args) {
  const { pos, flags } = parseArgs(args);
  const root = needRoot();
  const sub = { setup: () => setup(root, flags), status: () => status(root, flags), forget: () => forget(root, flags) }[pos[0]];
  if (sub) return sub();
  say(USAGE); process.exitCode = 1;
}
