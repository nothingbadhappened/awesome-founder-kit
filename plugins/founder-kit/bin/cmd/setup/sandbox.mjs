// What `fk init` adds to the project's .claude/settings.json so Claude Code itself keeps agents away from the kit folder
// in the home directory (<home>/.fk: state, caches). Merged, never overwritten; what was added is recorded in
// .fk/guard-settings.json so `fk uninstall` takes exactly that back out.
//   permissions.deny  Read(<kit>/**), Edit(<kit>/**): Claude's file tools and the file commands Claude Code recognises
//                     in Bash (cat, tee, > file). Not a Python or Node script that opens files itself.
//   sandbox.filesystem.denyWrite <kit>: with the sandbox on, no sandboxed command (or its child processes) writes there.
//   sandbox.excludedCommands "fk *": the kit's own CLI writes its state, so it runs outside the sandbox (Claude Code then
//                     asks before it runs, unless the founder allows it).
// The sandbox itself stays the founder's choice (/sandbox): it also limits network access, which changes normal work.
// It runs on macOS, Linux and WSL2; native Windows has none (docs: code.claude.com/docs/en/sandboxing).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fkHome, readJson, writeJson } from '../../../hooks/lib.mjs';

export const GUARD_FILE = '.fk/guard-settings.json';
const SETTINGS = '.claude/settings.json';
const posix = (p) => p.split(path.sep).join('/');

// The kit folder as Claude Code paths: permission rules use ~/ (home) or // (filesystem root, Windows drive as /c/...);
// sandbox paths use ~/ or a plain absolute path.
export function kitPaths(home = os.homedir(), kit = fkHome()) {
  const rel = path.relative(home, kit);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return { rule: `~/${posix(rel)}`, sandbox: `~/${posix(rel)}` };
  const abs = posix(path.resolve(kit)).replace(/^([A-Za-z]):/, (m, d) => `/${d.toLowerCase()}`);
  return { rule: `/${abs}`, sandbox: posix(path.resolve(kit)) };
}
export function wanted() {
  const k = kitPaths();
  return { deny: [`Read(${k.rule}/**)`, `Edit(${k.rule}/**)`], denyWrite: [k.sandbox], excluded: ['fk *'] };
}
const addAll = (list, items) => { const added = items.filter((x) => !list.includes(x)); list.push(...added); return added; };

// Returns lines to print; null when the settings file is not valid JSON (left alone).
export function addGuardSettings(root) {
  const file = path.join(root, SETTINGS);
  let s = {};
  if (fs.existsSync(file)) { try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
  const w = wanted();
  const sb = (s.sandbox ||= {});
  const added = {
    deny: addAll((s.permissions ||= {}).deny ||= [], w.deny),
    denyWrite: addAll((sb.filesystem ||= {}).denyWrite ||= [], w.denyWrite),
    excluded: addAll(sb.excludedCommands ||= [], w.excluded),
  };
  const any = Object.values(added).some((a) => a.length);
  if (any) writeJson(file, s);
  const prev = readJson(path.join(root, GUARD_FILE), {});
  const merged = Object.fromEntries(Object.keys(added).map((k) => [k, [...new Set([...(prev[k] || []), ...added[k]])]]));
  writeJson(path.join(root, GUARD_FILE), merged);
  return any;
}

// Takes out exactly what addGuardSettings recorded; the project's own settings stay.
export function removeGuardSettings(root) {
  const rec = readJson(path.join(root, GUARD_FILE), null);
  const file = path.join(root, SETTINGS);
  const s = rec && readJson(file, null);
  if (!s) return false;
  const drop = (obj, key, items) => {
    if (!Array.isArray(obj?.[key])) return;
    obj[key] = obj[key].filter((x) => !(items || []).includes(x));
    if (!obj[key].length) delete obj[key];
  };
  drop(s.permissions, 'deny', rec.deny);
  drop(s.sandbox?.filesystem, 'denyWrite', rec.denyWrite);
  drop(s.sandbox, 'excludedCommands', rec.excluded);
  for (const [o, k] of [[s.sandbox, 'filesystem'], [s, 'sandbox'], [s, 'permissions']]) if (o?.[k] && !Object.keys(o[k]).length) delete o[k];
  writeJson(file, s);
  return true;
}

// fk doctor "guard strength": green only when Claude Code's sandbox is on (not native Windows, filesystem layer not
// switched off) and deny rules cover the kit folder. Settings scopes read: user, project, project local.
export function guardStrength(root, { platform = process.platform, configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude') } = {}) {
  const scopes = [path.join(configDir, 'settings.json'), ...(root ? [path.join(root, SETTINGS), path.join(root, '.claude', 'settings.local.json')] : [])].map((f) => readJson(f, {}) || {});
  let enabled = false;
  for (const s of scopes) if (typeof s.sandbox?.enabled === 'boolean') enabled = s.sandbox.enabled; // later scopes win
  const fsOff = scopes[0].sandbox?.filesystem?.disabled === true;
  const deny = scopes.flatMap((s) => s.permissions?.deny || []);
  const covered = wanted().deny.every((r) => deny.includes(r));
  const WEAK = 'Without Claude Code\'s sandbox, the guards stop drifting agents, not a determined one.';
  if (platform === 'win32') return { level: 'yellow', note: `${WEAK} Claude Code has no sandbox on native Windows; run it inside WSL2 for the strong form.${covered ? '' : ' Run fk init to add the deny rules for ~/.fk.'}` };
  if (!enabled || fsOff) return { level: 'yellow', note: `${WEAK} Turn it on with /sandbox${fsOff ? ' (and remove sandbox.filesystem.disabled from your user settings)' : ''}.${covered ? ' The deny rules for ~/.fk are in place.' : ' Then run fk init to add the deny rules for ~/.fk.'}` };
  if (!covered) return { level: 'yellow', note: `the sandbox is on, but no deny rules cover ~/.fk yet: run fk init. ${WEAK}` };
  return { level: 'green', note: 'Claude Code\'s sandbox is on and ~/.fk is write-denied to agent commands and file tools.' };
}
