// fk sweep [--dry-run] [--include-data]: stop or remove only what this project recorded in its ledger or labelled
// with its fingerprint. Never by name; never pre-existing items; data (volumes) only with --include-data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { needFkRoot, fingerprint, readLedger, writeLedger, expired, markRun, cli, say } from './steward/lib.mjs';
import { procName, stop } from './steward/proc.mjs';
import { parseFlags } from './ledger.mjs';

const inside = (child, parent) => { const r = path.relative(parent, child); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };
// Docker IDs may be short (12) or full (64) hex; names must match exactly.
const sameId = (a, b) => !!a && !!b && (a === b || (/^[0-9a-f]{12,}$/.test(a) && /^[0-9a-f]{12,}$/.test(b) && (a.startsWith(b) || b.startsWith(a))));

// Docker resources carrying this project's label. Absent docker -> null.
function dockerLabelled(fp) {
  const ps = cli('docker', ['ps', '-a', '--filter', `label=fk.fingerprint=${fp}`, '--format', '{{.ID}}:{{.Names}}'], { timeout: 10000 });
  if (ps.missing || (!ps.ok && !ps.out)) return null;
  const containers = ps.out.split(/\r?\n/).filter(Boolean).map((l) => { const [id, name] = l.trim().split(':'); return { id, name }; });
  const vl = cli('docker', ['volume', 'ls', '-q', '--filter', `label=fk.fingerprint=${fp}`], { timeout: 10000 });
  const volumes = vl.ok ? vl.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
  return { containers, volumes };
}

function baseBranch(root) {
  for (const b of ['main', 'master']) if (cli('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`], { cwd: root }).ok) return b;
  return null;
}

// Each planned item: { what, action: 'stop'|'remove'|'skip'|'drop', reason, run?: () => boolean, entry? }
export function plan(root, { includeData = false, now = Date.now() } = {}) {
  const fp = fingerprint(root);
  const all = readLedger(root);
  const mine = all.filter((e) => e.fp === fp);
  const preIds = mine.filter((e) => e.pre_existing).map((e) => String(e.id));
  const items = [];
  const skip = (e, what, reason) => items.push({ entry: e, what, action: 'skip', reason });
  let base;

  for (const e of mine) {
    const what = `${e.kind} ${e.id}`;
    if (e.pre_existing) { skip(e, what, 'marked pre-existing, never touched'); continue; }
    if (e.ttl_until && !expired(e, now)) { skip(e, what, `still within its time limit (until ${e.ttl_until.slice(0, 16).replace('T', ' ')} UTC)`); continue; }
    if (e.data && !includeData) { skip(e, what, 'holds data; only removed with --include-data'); continue; }
    if (e.pid) {
      const name = procName(e.pid);
      if (!name) { items.push({ entry: e, what, action: 'drop', reason: `process ${e.pid} already gone` }); continue; }
      if (e.cmd && name !== e.cmd) { items.push({ entry: e, what, action: 'drop', reason: `process ${e.pid} is now "${name}", not "${e.cmd}" (number reused); left alone` }); continue; }
      if (!e.cmd) { skip(e, what, `process ${e.pid} has no recorded program name; stop it yourself if it is ours`); continue; }
      items.push({ entry: e, what: `${what} (process ${e.pid}, ${name})`, action: 'stop', run: () => stop(e.pid) });
    } else if (e.kind === 'container') {
      items.push({ entry: e, what, action: 'remove', run: () => cli('docker', ['rm', '-f', e.id]).ok, docker: e.id });
    } else if (e.kind === 'volume') {
      items.push({ entry: e, what, action: 'remove', run: () => cli('docker', ['volume', 'rm', e.id]).ok, docker: e.id });
    } else if (e.kind === 'worktree') {
      if (!fs.existsSync(e.id)) { items.push({ entry: e, what, action: 'drop', reason: 'folder already gone' }); continue; }
      if (inside(e.id, path.join(root, '.claude'))) { skip(e, what, 'inside .claude/, managed by Claude Code'); continue; }
      if (cli('git', ['status', '--porcelain'], { cwd: e.id }).out.trim()) { skip(e, what, 'has uncommitted changes'); continue; }
      base ??= baseBranch(root) || '';
      const head = cli('git', ['rev-parse', 'HEAD'], { cwd: e.id }).out.trim();
      if (!base || !head || !cli('git', ['merge-base', '--is-ancestor', head, base], { cwd: root }).ok) { skip(e, what, `not merged into ${base || 'main'} yet`); continue; }
      items.push({ entry: e, what, action: 'remove', run: () => cli('git', ['worktree', 'remove', e.id], { cwd: root }).ok });
    } else if (e.kind === 'tmpdir' || e.kind === 'temp') {
      if (!fs.existsSync(e.id)) { items.push({ entry: e, what, action: 'drop', reason: 'folder already gone' }); continue; }
      if (!inside(path.resolve(e.id), fs.realpathSync(os.tmpdir())) && !inside(path.resolve(e.id), os.tmpdir())) { skip(e, what, 'not under the system temp folder; remove it yourself'); continue; }
      items.push({ entry: e, what, action: 'remove', run: () => { fs.rmSync(e.id, { recursive: true, force: true }); return !fs.existsSync(e.id); } });
    } else {
      skip(e, what, e.kind === 'cloud' ? 'cloud resource: the kit never deletes these; remove it in the provider console or ask the founder' : 'no automatic way to stop this kind; stop it yourself');
    }
  }

  const docker = dockerLabelled(fp);
  if (docker) {
    for (const c of docker.containers) {
      if (items.some((i) => sameId(i.docker, c.id) || sameId(i.docker, c.name)) || mine.some((e) => e.kind === 'container' && (sameId(String(e.id), c.id) || e.id === c.name))) continue;
      const what = `container ${c.name || c.id} (labelled)`;
      if (preIds.some((p) => sameId(p, c.id) || p === c.name)) { items.push({ what, action: 'skip', reason: 'marked pre-existing, never touched' }); continue; }
      items.push({ what, action: 'remove', run: () => cli('docker', ['rm', '-f', c.id]).ok });
    }
    for (const v of docker.volumes) {
      if (mine.some((e) => e.kind === 'volume' && e.id === v)) continue;
      const what = `volume ${v} (labelled)`;
      if (preIds.includes(v)) { items.push({ what, action: 'skip', reason: 'marked pre-existing, never touched' }); continue; }
      if (!includeData) { items.push({ what, action: 'skip', reason: 'holds data; only removed with --include-data' }); continue; }
      items.push({ what, action: 'remove', run: () => cli('docker', ['volume', 'rm', v]).ok });
    }
  }
  return { fp, all, items, docker: !!docker };
}

export default async function sweep(args) {
  const root = needFkRoot();
  const { flags } = parseFlags(args);
  const dry = !!flags['dry-run'];
  const { fp, all, items, docker } = plan(root, { includeData: !!flags['include-data'] });
  if (!items.length) {
    say(`fk sweep: nothing to clean up for this project${docker ? '' : ' (Docker not found, labelled containers not checked)'}.`);
    if (!dry) markRun(root, 'sweep');
    return;
  }
  const done = new Set();
  let failed = 0;
  for (const it of items) {
    if (it.action === 'skip') { say(`  kept     ${it.what}: ${it.reason}`); continue; }
    if (it.action === 'drop') { say(`  ${dry ? 'would forget' : 'forgot  '} ${it.what}: ${it.reason}`); if (!dry && it.entry) done.add(it.entry); continue; }
    const verb = it.action === 'stop' ? 'stop' : 'remove';
    if (dry) { say(`  would ${verb.padEnd(6)} ${it.what}`); continue; }
    let ok = false;
    try { ok = it.run(); } catch { ok = false; }
    say(`  ${ok ? (verb === 'stop' ? 'stopped ' : 'removed ') : 'FAILED  '} ${it.what}${ok ? '' : ' (left in the ledger; try again or stop it yourself)'}`);
    if (ok && it.entry) done.add(it.entry); else if (!ok) failed++;
  }
  const n = (a) => items.filter((i) => i.action === a).length;
  if (dry) say(`fk sweep (dry run): would stop ${n('stop')}, remove ${n('remove')}, keep ${n('skip')}. Nothing was changed.`);
  else {
    writeLedger(root, all.filter((e) => !done.has(e)));
    markRun(root, 'sweep');
    say(`fk sweep: done. ${done.size} ledger entries cleared, ${n('skip')} kept${failed ? `, ${failed} failed` : ''}. Only items with this project's fingerprint (${fp}) were considered.`);
  }
  if (!docker) say('Note: Docker not found, so labelled containers were not checked.');
}
