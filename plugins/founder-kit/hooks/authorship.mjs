// Who wrote what, for `fk task check` (a review counts only when an agent that wrote no code for the task wrote it).
// PostToolUse only, and only while a task is open (state: <kit state dir>/tasks.json, written by `fk task`).
// File tools log their path; a shell command logs the files git status lists whose mtime moved since the last tool
// finished (one git process). Lines: {ts, session_id, agent_id, agent_type, path} in <kit state dir>/authorship.jsonl.
import fs from 'node:fs';
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
  if (!open.length) return;
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
  const lines = paths.filter((p) => p && !p.startsWith('.omc/') && !p.startsWith('.fk/')).map((p) => JSON.stringify({ ...base, path: p }) + '\n');
  if (lines.length) fs.appendFileSync(stateFile(root, 'authorship.jsonl'), lines.join(''));
}

// Gate runs (`fk baseline check`, `fk task check`): {ts, ok, gates, paths} in <kit state dir>/gates.jsonl; paths = files
// changed at the time, so `fk metrics` can tie a later failure to a closed task.
export function logGateRun(root, entry) {
  const r = spawnSync('git', ['status', '--porcelain', '-z', '--untracked-files=all', '--no-renames'], { cwd: root, encoding: 'utf8' });
  const paths = r.status === 0 ? r.stdout.split('\0').filter(Boolean).map((l) => l.slice(3)) : [];
  fs.mkdirSync(path.dirname(stateFile(root, 'gates.jsonl')), { recursive: true });
  fs.appendFileSync(stateFile(root, 'gates.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...entry, paths: entry.paths || paths }) + '\n');
}
export const readGateRuns = (root) => readLines(stateFile(root, 'gates.jsonl'));
