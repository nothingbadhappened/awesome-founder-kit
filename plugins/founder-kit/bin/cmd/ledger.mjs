// fk ledger: record what an agent starts, so `fk sweep` can clean up exactly that and nothing else.
//   fk ledger add <kind> <id> [--pid N] [--port N] [--cmd name] [--label k=v]... [--ttl 2h] [--data] [--pre-existing]
//   fk ledger list | fk ledger fp
import path from 'node:path';
import { needFkRoot, fingerprint, readLedger, appendLedger, parseTtl, expired, say } from './steward/lib.mjs';
import { procName } from './steward/proc.mjs';

const PATH_KINDS = new Set(['worktree', 'tmpdir', 'temp']);
const USAGE = 'usage: fk ledger add <kind> <id> [--pid N] [--port N] [--cmd name] [--label k=v] [--ttl 2h] [--data] [--pre-existing] | fk ledger list | fk ledger fp';

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

function add(root, pos, flags) {
  const [kind, rawId] = pos;
  if (!kind || !rawId) { say(USAGE); process.exitCode = 1; return; }
  const k = kind.toLowerCase();
  const entry = { ts: new Date().toISOString(), fp: fingerprint(root), kind: k, id: PATH_KINDS.has(k) ? path.resolve(rawId) : rawId };
  if (flags.pid != null) {
    const pid = Number(flags.pid);
    if (!Number.isInteger(pid) || pid <= 0) { say('fk ledger: --pid must be a process number.'); process.exitCode = 1; return; }
    entry.pid = pid;
    entry.cmd = flags.cmd ? String(flags.cmd).toLowerCase() : procName(pid);
    if (!entry.cmd) say(`fk ledger: process ${pid} is not running now; recorded anyway, the next sweep will just drop it.`);
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
  if (sub === 'fp') return say(`fk.fingerprint=${fingerprint(root)}`);
  say(USAGE); process.exitCode = 1;
}
