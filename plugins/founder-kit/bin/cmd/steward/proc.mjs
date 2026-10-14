// Process helpers, cross-platform: name of a running PID (null when gone) and a stop that waits briefly.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const sys32 = (exe) => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', exe);

// A zombie (exited, not yet reaped by its parent) counts as gone: signal 0 still succeeds on it on POSIX.
export function zombie(pid) {
  if (process.platform === 'win32') return false;
  try {
    if (process.platform === 'linux') return / Z /.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^\d+ \(.*\) /, ' ').slice(0, 3));
    return /^Z/.test(spawnSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8', timeout: 5000 }).stdout.trim());
  } catch { return false; }
}

export function alive(pid) {
  try { process.kill(pid, 0); } catch (e) { return e.code === 'EPERM'; }
  return !zombie(pid);
}

// Executable base name, lower case, no .exe. null when the process is not running.
export function procName(pid) {
  if (!alive(pid)) return null;
  if (process.platform === 'win32') {
    const r = spawnSync(sys32('tasklist.exe'), ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    const m = /^"([^"]+)","(\d+)"/m.exec(r.stdout || '');
    return m && Number(m[2]) === pid ? m[1].toLowerCase().replace(/\.exe$/, '') : null;
  }
  const r = spawnSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8', timeout: 5000 });
  const name = (r.stdout || '').trim();
  return name ? path.basename(name).toLowerCase() : null;
}

// ---- identity: start time (epoch ms) and full command line, so a reused process number is never mistaken for ours ----
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const cmdHash = (cmdline) => (cmdline ? sha(cmdline.replace(/\s+/g, ' ').trim()) : null);

// /proc/<pid>/stat field 22 (starttime, clock ticks since boot) + /proc/stat btime (boot, epoch s).
export function parseLinuxStart(stat, procStat, ticks = 100) {
  const rest = String(stat).slice(String(stat).lastIndexOf(')') + 2).split(' '); // rest[0] is field 3
  const start = Number(rest[19]);
  const btime = Number(/^btime\s+(\d+)/m.exec(String(procStat))?.[1]);
  return Number.isFinite(start) && btime ? Math.round((btime + start / ticks) * 1000) : null;
}
// `ps -o lstart=` (macOS, BSD): "Tue Oct 14 09:30:01 2026", local time.
export function parsePsStart(text) {
  const t = Date.parse(String(text).trim().replace(/\s+/g, ' '));
  return Number.isFinite(t) ? t : null;
}
// The PowerShell query below prints the UTC creation time (ISO) on line 1 and the command line on line 2.
export function parseWinProcess(text) {
  const [time = '', ...cmd] = String(text).replace(/\r/g, '').split('\n');
  const start = Date.parse(time.trim());
  const cmdline = cmd.join('\n').trim();
  return { start: Number.isFinite(start) ? start : null, cmdline: cmdline || null };
}

let clkTck;
const ticks = () => (clkTck ??= Number(spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8', timeout: 5000 }).stdout) || 100);
const POWERSHELL = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

// { start: epoch ms | null, cmdline: string | null } of a running process; nulls when it cannot be read.
export function procIdentity(pid) {
  pid = Number(pid);
  if (!Number.isInteger(pid) || pid <= 0) return { start: null, cmdline: null };
  if (process.platform === 'win32') {
    const q = `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { $p.CreationDate.ToUniversalTime().ToString('o'); $p.CommandLine }`;
    const r = spawnSync(POWERSHELL(), ['-NoProfile', '-NonInteractive', '-Command', q], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    return r.status === 0 ? parseWinProcess(r.stdout || '') : { start: null, cmdline: null };
  }
  if (process.platform === 'linux') {
    try {
      const start = parseLinuxStart(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'), fs.readFileSync('/proc/stat', 'utf8'), ticks());
      let cmdline = null;
      try { cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ') || null; } catch { /* unreadable */ }
      return { start, cmdline };
    } catch { /* no /proc: ps below */ }
  }
  const ps = (field) => spawnSync('ps', ['-o', `${field}=`, '-p', String(pid)], { encoding: 'utf8', timeout: 5000, env: { ...process.env, LC_ALL: 'C' } }).stdout?.trim() || '';
  return { start: parsePsStart(ps('lstart')), cmdline: ps('command') || null };
}

// ---- the process table: Map pid -> { ppid, name, cmdline }; empty when it cannot be read ----
export function parsePsTable(text) {
  const t = new Map();
  for (const l of String(text).split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l);
    if (m) t.set(Number(m[1]), { ppid: Number(m[2]), cmdline: m[3].trim(), name: path.basename(m[3].trim().split(/\s+/)[0] || '').toLowerCase().replace(/\.exe$/, '') });
  }
  return t;
}
export function procTable() {
  if (process.platform === 'win32') {
    const q = "Get-CimInstance Win32_Process | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, $(if ($_.CommandLine) { $_.CommandLine } else { $_.Name }) }";
    const r = spawnSync(POWERSHELL(), ['-NoProfile', '-NonInteractive', '-Command', q], { encoding: 'utf8', timeout: 30000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    return r.status === 0 ? parsePsTable(r.stdout) : new Map();
  }
  const r = spawnSync('ps', ['-A', '-o', 'pid=', '-o', 'ppid=', '-o', 'args='], { encoding: 'utf8', timeout: 10000, maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? parsePsTable(r.stdout) : new Map();
}
// The current process and every parent up the chain (the agent's shell, Claude Code, the terminal, ...).
export function ancestors(table, pid = process.pid) {
  const out = new Set();
  for (let p = pid; p > 0 && !out.has(p); p = table.get(p)?.ppid ?? 0) out.add(p);
  return out;
}
// Claude Code itself (CLAUDE_PID, or a process whose command line is Claude Code) and the processes it started directly
// (its tool shells, MCP servers, hooks).
const CLAUDE = /(?:^|[\\/\s"])claude(?:\.exe)?(?:["\s]|$)|@anthropic-ai[\\/]claude-code/i;
export function claudeTree(table, env = process.env) {
  const roots = new Set([...table].filter(([, p]) => CLAUDE.test(p.cmdline)).map(([pid]) => pid));
  if (Number(env.CLAUDE_PID) > 0) roots.add(Number(env.CLAUDE_PID));
  const out = new Set(roots);
  for (const [pid, p] of table) if (roots.has(p.ppid)) out.add(pid);
  return out;
}

// Claude Code (or a process it started) is among this process's parents: an agent's tool shell started us, whatever
// its environment says. False when the process table cannot be read.
export function claudeAncestor(table = procTable(), pid = process.pid, env = process.env) {
  if (!table.size) return false;
  const tree = claudeTree(table, env);
  return [...ancestors(table, pid)].some((p) => p !== pid && tree.has(p));
}

export function stop(pid) {
  if (process.platform === 'win32') {
    const r = spawnSync(sys32('taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    return r.status === 0 || !alive(pid);
  }
  try { process.kill(pid, 'SIGTERM'); } catch { return !alive(pid); }
  const until = Date.now() + 3000;
  while (alive(pid) && Date.now() < until) spawnSync('sleep', ['0.1']);
  if (alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  return !alive(pid);
}
