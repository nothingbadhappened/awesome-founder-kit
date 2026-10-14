// Who wrote what, for `fk task check` (a review counts only when an agent that wrote no code for the task wrote it).
// PostToolUse only, and only while a task is open (state: <kit state dir>/tasks.json, written by `fk task`).
// File tools log their path; a shell command logs the files git status lists whose mtime moved since the last tool
// finished (one git process). Lines: {ts, session_id, agent_id, agent_type, path} in <kit state dir>/authorship.jsonl.
// Returns the paths it logged (the first-edit area note reuses them, so no second git process).
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJson, writeJson, stateFile, relPath, shellTool } from './lib.mjs';

export const readTasks = (root) => readJson(stateFile(root, 'tasks.json'), { tasks: {} });
export const writeTasks = (root, state) => writeJson(stateFile(root, 'tasks.json'), state);
export function readLines(file) {
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
}
export const readAuthorship = (root) => readLines(stateFile(root, 'authorship.jsonl'));

const FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

export function record(root, input, tool, ti, now = Date.now()) {
  const open = Object.values(readTasks(root).tasks || {}).filter((t) => t.start && !t.done);
  if (!open.length) return [];
  const markFile = stateFile(root, 'authorship-mark.json');
  const since = Math.max(readJson(markFile, {}).ts || 0, Math.min(...open.map((t) => Date.parse(t.start))));
  let paths = [];
  if (FILE_TOOLS.includes(tool)) paths = [relPath(root, ti.file_path || ti.notebook_path || '')];
  else if (shellTool(tool)) {
    const r = spawnSync('git', ['status', '--porcelain', '-z', '--untracked-files=all', '--no-renames'], { cwd: root, encoding: 'utf8' });
    if (r.status === 0) {
      paths = r.stdout.split('\0').filter(Boolean).map((l) => l.slice(3)).filter((rel) => {
        try { return fs.statSync(path.join(root, rel)).mtimeMs > since; } catch { return true; } // deleted by this command
      });
    }
  }
  writeJson(markFile, { ts: now });
  const base = { ts: new Date(now).toISOString(), session_id: input.session_id || null, agent_id: input.agent_id || null, agent_type: input.agent_type || null };
  const kept = paths.filter((p) => p && !p.startsWith('.omc/') && !p.startsWith('.fk/'));
  if (kept.length) fs.appendFileSync(stateFile(root, 'authorship.jsonl'), kept.map((p) => JSON.stringify({ ...base, path: p }) + '\n').join(''));
  return kept;
}

// ---- the change set's fingerprint (fk task stamp): every file changed since <base>, plus untracked files git does not
// ignore; the task records (docs/tasks/), .fk/ and .omc/ are left out. path -> content hash (line-ending blind) or 'deleted'.
// Content, not authorship: an edit no hook saw (an MCP tool, a write that keeps the old file time) still changes it.
const OUTSIDE = (p) => p.startsWith('docs/tasks/') || p.startsWith('.fk/') || p.startsWith('.omc/');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const gitZ = (root, args) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return r.status === 0 ? r.stdout.split('\0').filter(Boolean) : [];
};
export const contentHash = (buf) => sha(Buffer.from(buf).toString('latin1').replace(/\r\n/g, '\n')).slice(0, 16);
export const hashOf = (root, p) => { try { return contentHash(fs.readFileSync(path.join(root, p))); } catch { return 'deleted'; } };
export function changeSet(root, base) {
  const paths = new Set([...gitZ(root, base ? ['diff', '--name-only', '--no-renames', '-z', base] : ['ls-files', '-z']), ...gitZ(root, ['ls-files', '--others', '--exclude-standard', '-z'])]);
  const out = {};
  for (const p of [...paths].filter((x) => !OUTSIDE(x)).sort()) out[p] = hashOf(root, p);
  return out;
}
export const stampOf = (files) => sha(Object.keys(files).sort().map((p) => `${p}\0${files[p]}\n`).join('')).slice(0, 12);
// The whole working tree's content in one value: the HEAD commit plus every change on top of it (untracked included).
export function treeStamp(root) {
  const r = spawnSync('git', ['rev-parse', '--verify', '-q', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const head = r.status === 0 ? r.stdout.trim() : '';
  return sha(`${head}\n${stampOf(changeSet(root, head || null))}`).slice(0, 16);
}

// Gate runs: {ts, ok, source, gates, cmds, tree, paths} in <kit state dir>/gates.jsonl. source 'configured': the
// commands in .fk/config.json, run by `fk task check` or `fk baseline check` without --gate. tree (treeStamp) ties a
// run to the exact content it ran on. paths = files changed at the time (`fk metrics` ties a later failure to a task).
export function logGateRun(root, entry) {
  const r = spawnSync('git', ['status', '--porcelain', '-z', '--untracked-files=all', '--no-renames'], { cwd: root, encoding: 'utf8' });
  const paths = r.status === 0 ? r.stdout.split('\0').filter(Boolean).map((l) => l.slice(3)) : [];
  fs.mkdirSync(path.dirname(stateFile(root, 'gates.jsonl')), { recursive: true });
  fs.appendFileSync(stateFile(root, 'gates.jsonl'), JSON.stringify({ ts: new Date().toISOString(), tree: treeStamp(root), ...entry, paths: entry.paths || paths }) + '\n');
}
export const readGateRuns = (root) => readLines(stateFile(root, 'gates.jsonl'));
