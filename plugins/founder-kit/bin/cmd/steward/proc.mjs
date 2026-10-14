// Process helpers, cross-platform: name of a running PID (null when gone) and a stop that waits briefly.
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const sys32 = (exe) => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', exe);

export function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
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
