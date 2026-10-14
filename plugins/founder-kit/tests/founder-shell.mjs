// Runs a command the way the founder's own terminal would: not below the Claude Code process that may be running this
// suite. fk refuses to take the kit out when Claude Code is one of its ancestor processes, so the tests that play the
// founder start the command from a process whose parent has already exited (the chain up to Claude Code is broken).
// Not a test file: imported by tests. founderRun(cmd, args, { cwd, env }) -> { status, stdout, stderr }, like spawnSync.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

export function founderRun(cmd, args = [], { cwd = process.cwd(), env = process.env, timeout = 120000 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-founder-'));
  const job = path.join(dir, 'job.json'), done = path.join(dir, 'done.json');
  fs.writeFileSync(job, JSON.stringify({ cmd, args, cwd, env }));
  try {
    spawnSync(process.execPath, [SELF, 'middle', job, done], { stdio: 'ignore', windowsHide: true });
    for (const until = Date.now() + timeout; !fs.existsSync(done) && Date.now() < until;) pause(25);
    pause(25); // the runner writes done.json once, atomically by rename
    if (!fs.existsSync(done)) return { status: null, stdout: '', stderr: 'founderRun: timed out' };
    return JSON.parse(fs.readFileSync(done, 'utf8'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const [mode, job, done, parent] = process.argv.slice(2);
if (mode === 'middle') {
  spawn(process.execPath, [SELF, 'runner', job, done, String(process.pid)], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  process.exit(0);
}
if (mode === 'runner') {
  for (const until = Date.now() + 10000; alive(Number(parent)) && Date.now() < until;) pause(10);
  const { cmd, args, cwd, env } = JSON.parse(fs.readFileSync(job, 'utf8'));
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', windowsHide: true });
  fs.writeFileSync(done + '.tmp', JSON.stringify({ status: r.status, stdout: r.stdout || '', stderr: r.stderr || (r.error ? String(r.error) : '') }));
  fs.renameSync(done + '.tmp', done);
}
