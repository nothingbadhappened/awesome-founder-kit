// Shared steward helpers: fingerprint, ledger, steward state, provider catalog, CLI runner. Pure Node, no deps.
// The SessionStart hook imports this file too, so top-level code must stay cheap (no spawn, no network).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findRoot, readJson, writeJson, refreshSnapshot } from '../../../hooks/lib.mjs';

export const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const CATALOG = path.join(KIT, 'catalog', 'providers');
export const DAY = 24 * 60 * 60 * 1000;
export const say = (s = '') => process.stdout.write(s + '\n');

// Project root (main checkout, also from a linked worktree) or exit with a plain note.
export function needFkRoot() {
  const found = findRoot(process.cwd());
  if (!found) { say('fk: no .fk/ folder for this project. Run `fk init` first.'); process.exit(1); }
  return found.root;
}

// Hash of the main checkout path: identifies this project's resources without storing the path itself.
export function fingerprint(root) {
  let p = path.resolve(root).split(path.sep).join('/');
  if (process.platform === 'win32') p = p.toLowerCase();
  return crypto.createHash('sha256').update('fk:' + p).digest('hex').slice(0, 12);
}

// ---- ledger (.fk/ledger.jsonl, hook-owned runtime file) ----
const ledgerFile = (root) => path.join(root, '.fk', 'ledger.jsonl');
export function readLedger(root) {
  let text = '';
  try { text = fs.readFileSync(ledgerFile(root), 'utf8'); } catch { return []; }
  return text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
export function writeLedger(root, entries) {
  fs.mkdirSync(path.join(root, '.fk'), { recursive: true });
  fs.writeFileSync(ledgerFile(root), entries.map((e) => JSON.stringify(e) + '\n').join(''));
}
export function appendLedger(root, entry) {
  fs.mkdirSync(path.join(root, '.fk'), { recursive: true });
  fs.appendFileSync(ledgerFile(root), JSON.stringify(entry) + '\n');
}

// "90m", "2h", "3d" -> ms; null when unreadable.
export function parseTtl(s) {
  const m = /^(\d+(?:\.\d+)?)\s*(m|h|d)$/i.exec(String(s || '').trim());
  return m ? Number(m[1]) * { m: 60e3, h: 3600e3, d: DAY }[m[2].toLowerCase()] : null;
}
export const expired = (e, now = Date.now()) => !!e.ttl_until && Date.parse(e.ttl_until) <= now;

// ---- steward state (.fk/steward.json): last runs and last notes; snapshot refreshed so gate-guard sees a sanctioned write ----
const STATE = '.fk/steward.json';
export const readState = (root) => readJson(path.join(root, STATE), {});
export function writeState(root, patch) {
  const s = readState(root);
  const next = { ...s, ...patch, last_run: { ...(s.last_run || {}), ...(patch.last_run || {}) }, last_note: { ...(s.last_note || {}), ...(patch.last_note || {}) } };
  writeJson(path.join(root, STATE), next);
  refreshSnapshot(root, [STATE]);
  return next;
}
export const markRun = (root, key) => writeState(root, { last_run: { [key]: new Date().toISOString() } });

// ---- provider catalog ----
export function catalog() {
  const out = {};
  for (const f of fs.readdirSync(CATALOG).filter((n) => n.endsWith('.json')).sort()) {
    const j = readJson(path.join(CATALOG, f), null);
    if (j) out[j.provider] = j;
  }
  return out;
}
const ALIASES = { gcloud: 'gcp', google: 'gcp', az: 'azure', flyio: 'fly', 'fly.io': 'fly', wrangler: 'cloudflare' };
export const canonical = (p) => ALIASES[String(p).toLowerCase()] || String(p).toLowerCase();

// ---- running provider CLIs: never a shell string from user input; Windows needs a shell for .cmd shims ----
const quote = (a) => (/^[\w@%+=:,./{}-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '\\"')}"`);
export function cli(cmd, args, { timeout = 15000, cwd } = {}) {
  const win = process.platform === 'win32';
  const r = win
    ? spawnSync([cmd, ...args].map(quote).join(' '), { shell: true, encoding: 'utf8', timeout, cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    : spawnSync(cmd, args, { encoding: 'utf8', timeout, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  const missing = r.error?.code === 'ENOENT' || r.status === 127 || r.status === 9009 || /is not recognized as an internal or external command/i.test(r.stderr || '')
    // Localised Windows prints "not recognized" in its own language: ask where.exe instead of reading the message.
    || (win && r.status !== 0 && spawnSync('where.exe', [cmd], { stdio: 'ignore', windowsHide: true }).status !== 0);
  return { ok: r.status === 0, missing, timedOut: r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM', out: r.stdout || '', err: r.stderr || '' };
}

// Plain project name for templates: folder name only, safe characters.
export const projectName = (root) => path.basename(root).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
