// fk ledger add --pid records the process start time and a hash of its command line; fk sweep stops a process only
// while both still match. Real child processes on the running OS; the other OSes' readers are checked on fixed text.
// Sandboxed: FK_HOME, HOME, USERPROFILE, CLAUDE_CONFIG_DIR and the temp folder point into one temp folder.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-sweep-home-'));
process.env.FK_HOME = path.join(SANDBOX, '.fk');
process.env.HOME = SANDBOX;
process.env.USERPROFILE = SANDBOX;
process.env.CLAUDE_CONFIG_DIR = path.join(SANDBOX, '.claude');
process.env.TMP = process.env.TEMP = process.env.TMPDIR = path.join(SANDBOX, 'tmp');
fs.mkdirSync(process.env.TMP, { recursive: true });
const { fingerprint } = await import('../bin/cmd/steward/lib.mjs');
const { alive, procIdentity, cmdHash, parseLinuxStart, parsePsStart, parseWinProcess } = await import('../bin/cmd/steward/proc.mjs');

const FK = path.join(import.meta.dirname, '..', 'bin', 'fk.mjs');
const kids = [];
after(() => { for (const k of kids) k.kill(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });
const sleeper = () => { const k = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); kids.push(k); return k; };
const waitGone = (pid) => { const until = Date.now() + 5000; while (alive(pid) && Date.now() < until) spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},100)']); return !alive(pid); };
const rows = (dir) => fs.readFileSync(path.join(dir, '.fk', 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-sweep-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  assert.equal(spawnSync(process.execPath, [FK, 'init'], { cwd: dir }).status, 0);
  // Container engines that list nothing, so a real Docker or Podman on the machine is never asked.
  const bin = path.join(dir, 'fakebin');
  fs.mkdirSync(bin);
  for (const t of ['docker', 'podman']) {
    fs.writeFileSync(path.join(bin, `${t}.cmd`), '@exit /b 0\r\n');
    fs.writeFileSync(path.join(bin, t), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
  const env = { ...process.env };
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  env[key] = bin + path.delimiter + env[key];
  return { dir, fp: fingerprint(dir), fk: (...args) => spawnSync(process.execPath, [FK, ...args], { cwd: dir, encoding: 'utf8', env }) };
}
// The OS needs a moment before a new process is listed with its command line.
const ready = (pid) => { const until = Date.now() + 5000; let id; while (!(id = procIdentity(pid)).cmdline && Date.now() < until) spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},100)']); return id; };

test('process identity readers: Linux /proc, macOS ps lstart, Windows CIM output', () => {
  // field 2 (the name) may hold spaces and parentheses; field 22 is the start in clock ticks since boot
  const stat = '4242 (my (odd) prog) S 1 4242 4242 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0 50000 1000 100';
  assert.equal(parseLinuxStart(stat, 'cpu  1 2 3\nbtime 1700000000\nprocesses 9\n', 100), 1700000500000);
  assert.equal(parseLinuxStart(stat, 'no boot time here', 100), null);
  assert.equal(parsePsStart('Wed Oct 14 09:30:01 2026'), new Date(2026, 9, 14, 9, 30, 1).getTime());
  assert.equal(parsePsStart(''), null);
  assert.deepEqual(parseWinProcess('2026-10-14T09:30:01.1234560Z\r\n"C:\\x\\node.exe" -e x\r\n'), { start: Date.parse('2026-10-14T09:30:01.123Z'), cmdline: '"C:\\x\\node.exe" -e x' });
  assert.deepEqual(parseWinProcess('2026-10-14T09:30:01.0000000Z\r\n\r\n'), { start: Date.parse('2026-10-14T09:30:01Z'), cmdline: null }, 'command line unreadable');
  assert.equal(cmdHash('node  -e x'), cmdHash('node -e x'));
  assert.equal(cmdHash(null), null);
});

test('fk ledger add --pid records start time and command-line hash; fk sweep stops the matching process', () => {
  const p = project();
  const child = sleeper();
  try {
    const id = ready(child.pid);
    const r = p.fk('ledger', 'add', 'dev-server', 'web', '--pid', String(child.pid));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const [row] = rows(p.dir);
    assert.ok(row.started && Math.abs(Date.parse(row.started) - id.start) <= 2000, JSON.stringify(row));
    assert.equal(row.cmd_hash, cmdHash(id.cmdline));
    assert.ok(Math.abs(Date.parse(row.started) - Date.now()) < 60e3, 'a start time from this run');
    const s = p.fk('sweep');
    assert.equal(s.status, 0, s.stdout + s.stderr);
    assert.match(s.stdout, /stopped\s+dev-server web \(process \d+, node\)/);
    assert.ok(waitGone(child.pid), 'stopped');
    assert.deepEqual(rows(p.dir), []);
  } finally { fs.rmSync(p.dir, { recursive: true, force: true }); }
});

test('fk sweep: a reused process number (other start time or command line) is forgotten and left running; no start time is kept with a reason', () => {
  const p = project();
  const [a, b, c, d] = [sleeper(), sleeper(), sleeper(), sleeper()];
  try {
    const ids = Object.fromEntries([a, b, c, d].map((k) => [k.pid, ready(k.pid)]));
    const base = { ts: new Date().toISOString(), fp: p.fp, kind: 'dev-server', cmd: 'node' };
    const entry = (k, extra) => JSON.stringify({ ...base, pid: k.pid, ...extra }) + '\n';
    fs.writeFileSync(path.join(p.dir, '.fk', 'ledger.jsonl'),
      entry(a, { id: 'old-start', started: new Date(ids[a.pid].start - 3600e3).toISOString(), cmd_hash: cmdHash(ids[a.pid].cmdline) })
      + entry(b, { id: 'other-cmd', started: new Date(ids[b.pid].start).toISOString(), cmd_hash: '0'.repeat(64) })
      + entry(c, { id: 'legacy' }) // written before start times were recorded
      + entry(d, { id: 'no-hash', started: new Date(ids[d.pid].start).toISOString() })); // command line was unreadable when recorded
    const dry = p.fk('sweep', '--dry-run');
    assert.match(dry.stdout, /would forget dev-server old-start: process number \d+ reused by another program/);
    assert.match(dry.stdout, /would stop\s+dev-server no-hash \(process \d+, node, matched on start time and program name only/);
    const s = p.fk('sweep');
    assert.equal(s.status, 0, s.stdout + s.stderr);
    assert.match(s.stdout, /forgot\s+dev-server old-start: process number \d+ reused by another program/);
    assert.match(s.stdout, /forgot\s+dev-server other-cmd: process number \d+ reused by another program/);
    assert.match(s.stdout, /kept\s+dev-server legacy: can't confirm process \d+ is the same process; stop it yourself if it is ours/);
    assert.ok(alive(a.pid) && alive(b.pid) && alive(c.pid), 'not ours (or not provably ours): left running');
    assert.ok(waitGone(d.pid), 'matched on start time and name');
    assert.deepEqual(rows(p.dir).map((e) => e.id), ['legacy']);
  } finally { fs.rmSync(p.dir, { recursive: true, force: true }); }
});
