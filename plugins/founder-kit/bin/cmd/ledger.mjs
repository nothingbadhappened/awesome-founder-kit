// fk ledger: record what an agent starts, so `fk sweep` can clean up exactly that and nothing else.
//   fk ledger add <kind> <id> [--pid N] [--port N] [--cmd name] [--label k=v]... [--ttl 2h] [--data] [--pre-existing]
//   fk ledger mktemp (a temp folder the sweep may remove) | fk ledger list | fk ledger fp
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { needFkRoot, fingerprint, readLedger, appendLedger, parseTtl, expired, say } from './steward/lib.mjs';
import { procName, procIdentity, cmdHash, procTable, ancestors, claudeTree } from './steward/proc.mjs';

const PATH_KINDS = new Set(['worktree', 'tmpdir', 'temp']);
const USAGE = 'usage: fk ledger add <kind> <id> [--pid N] [--port N] [--cmd name] [--label k=v] [--ttl 2h] [--data] [--pre-existing] | fk ledger mktemp [--ttl 2h] | fk ledger list | fk ledger fp';

export function parseFlags(args) {
  const pos = [], flags = { label: {} };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const [k, inline] = a.slice(2).split(/=(.*)/s);
    if (['data', 'pre-existing', 'dry-run', 'include-data', 'all', 'json'].includes(k)) { flags[k] = true; continue; }
    const v = inline ?? args[++i];
    if (k === 'label') { const [lk, lv] = String(v).split(/=(.*)/s); if (lk) flags.label[lk] = lv ?? ''; }
    else flags[k] = v;
  }
  return { pos, flags };
}

// Why `fk ledger add --pid` will not record a process for the sweep to stop, or null. The sweep stops what the ledger
// names, so the ledger never names the agent's own shell chain, Claude Code or what it started directly, nor a process
// that was already running well before it was recorded (start more than 10 minutes before `fk ledger add`): those are
// recorded only with --pre-existing, which the sweep never touches.
export const LATE_MS = 10 * 60 * 1000;
export function pidRefusal({ pid, start, now = Date.now(), chain = new Set(), claude = new Set(), preExisting = false }) {
  if (chain.has(pid)) return `process ${pid} is this command's own parent chain (the shell, Claude Code or the terminal)`;
  if (claude.has(pid)) return `process ${pid} is Claude Code or a process it started directly (a tool shell, an MCP server)`;
  if (!preExisting && start && start < now - LATE_MS) return `process ${pid} started ${new Date(start).toISOString().slice(0, 16).replace('T', ' ')} UTC, more than 10 minutes ago, so it is not something just started; record it right after starting it, or with --pre-existing (never swept)`;
  return null;
}
// tmpdir entries: only folders `fk ledger mktemp` made (system temp folder, named fk-<fingerprint>-...).
export const tmpPrefix = (root) => `fk-${fingerprint(root)}-`;
const realTmp = () => { try { return fs.realpathSync(os.tmpdir()); } catch { return os.tmpdir(); } };
export function kitTmp(root, dir) {
  const abs = path.resolve(dir);
  const parent = (() => { try { return fs.realpathSync(path.dirname(abs)); } catch { return path.dirname(abs); } })();
  const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  return path.basename(abs).startsWith(tmpPrefix(root)) && (same(parent, realTmp()) || same(path.dirname(abs), os.tmpdir()));
}

function mktemp(root, flags) {
  const ms = flags.ttl != null ? parseTtl(flags.ttl) : null;
  if (flags.ttl != null && !ms) { say('fk ledger: --ttl looks like 30m, 2h or 1d.'); process.exitCode = 1; return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), tmpPrefix(root)));
  appendLedger(root, { ts: new Date().toISOString(), fp: fingerprint(root), kind: 'tmpdir', id: dir, ...(ms ? { ttl_until: new Date(Date.now() + ms).toISOString() } : {}) });
  say(dir);
}

function add(root, pos, flags) {
  const [kind, rawId] = pos;
  if (!kind || !rawId) { say(USAGE); process.exitCode = 1; return; }
  const k = kind.toLowerCase();
  const entry = { ts: new Date().toISOString(), fp: fingerprint(root), kind: k, id: PATH_KINDS.has(k) ? path.resolve(rawId) : rawId };
  if ((k === 'tmpdir' || k === 'temp') && !flags['pre-existing'] && !kitTmp(root, rawId)) {
    say(`fk ledger: ${rawId} was not made by fk ledger mktemp, so fk sweep will not remove it. Make temp folders with: fk ledger mktemp`);
    process.exitCode = 1; return;
  }
  if (flags.pid != null) {
    const pid = Number(flags.pid);
    if (!Number.isInteger(pid) || pid <= 0) { say('fk ledger: --pid must be a process number.'); process.exitCode = 1; return; }
    entry.pid = pid;
    entry.cmd = flags.cmd ? String(flags.cmd).toLowerCase() : procName(pid);
    if (!entry.cmd) say(`fk ledger: process ${pid} is not running now; recorded anyway, the next sweep will just drop it.`);
    else {
      // Start time and command line: the sweep stops this process only while both still match (process numbers get reused).
      const id = procIdentity(pid);
      const table = procTable();
      const no = pidRefusal({ pid, start: id.start, chain: ancestors(table), claude: claudeTree(table), preExisting: !!flags['pre-existing'] });
      if (no) { say(`fk ledger: not recorded: ${no}.`); process.exitCode = 1; return; }
      if (id.start) entry.started = new Date(id.start).toISOString();
      if (id.cmdline) entry.cmd_hash = cmdHash(id.cmdline);
      if (!id.start) say(`fk ledger: could not read when process ${pid} started, so fk sweep will not stop it; stop it yourself when done.`);
    }
  } else if (flags.cmd) entry.cmd = String(flags.cmd).toLowerCase();
  if (flags.port != null) entry.port = Number(flags.port);
  if (Object.keys(flags.label).length) entry.labels = flags.label;
  if (flags.ttl != null) {
    const ms = parseTtl(flags.ttl);
    if (!ms) { say('fk ledger: --ttl looks like 30m, 2h or 1d.'); process.exitCode = 1; return; }
    entry.ttl_until = new Date(Date.now() + ms).toISOString();
  }
  if (flags.data || k === 'volume') entry.data = true;
  if (flags['pre-existing']) entry.pre_existing = true;
  appendLedger(root, entry);
  say(`fk ledger: recorded ${k} ${rawId}${entry.pid ? ` (process ${entry.pid})` : ''}${entry.ttl_until ? `, keep until ${entry.ttl_until.slice(0, 16).replace('T', ' ')} UTC` : ''}${entry.pre_existing ? ', marked pre-existing (never swept)' : ''}.`);
  if (k === 'container' || k === 'volume') say(`Tip: start containers and volumes with --label fk.fingerprint=${entry.fp} so the sweep can find them by label.`);
}

function list(root) {
  const fp = fingerprint(root);
  const mine = readLedger(root).filter((e) => e.fp === fp);
  if (!mine.length) return say('fk ledger: nothing recorded for this project.');
  for (const e of mine) {
    const state = e.pre_existing ? 'pre-existing' : expired(e) ? 'expired' : e.ttl_until ? `until ${e.ttl_until.slice(0, 16).replace('T', ' ')}` : 'no ttl';
    say(`${e.kind.padEnd(10)} ${String(e.id).padEnd(30)} ${e.pid ? `pid ${e.pid} ` : ''}${e.port ? `port ${e.port} ` : ''}${state}${e.data ? ', data' : ''}`);
  }
}

export default async function ledger(args) {
  const root = needFkRoot();
  const { pos, flags } = parseFlags(args);
  const sub = pos.shift();
  if (sub === 'add') return add(root, pos, flags);
  if (sub === 'list') return list(root);
  if (sub === 'mktemp') return mktemp(root, flags);
  if (sub === 'fp') return say(`fk.fingerprint=${fingerprint(root)}`);
  say(USAGE); process.exitCode = 1;
}
