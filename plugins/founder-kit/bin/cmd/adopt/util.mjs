// Shared helpers for fk adopt / baseline / memory / lessons. Pure Node, no deps.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeJson, refreshSnapshot, takeSnapshot, log, RUNTIME } from '../../../hooks/lib.mjs';

export const say = (s = '') => process.stdout.write(s + '\n');
export const today = (flags = {}) => flags.today || process.env.FK_TODAY || new Date().toLocaleDateString('sv');

export const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
// A tool on PATH? npm shims (.cmd) need a shell on Windows; real binaries do not.
export function tool(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 256 * 1024 * 1024, shell: process.platform === 'win32' && !!opts.shim, ...opts });
}

export function repoRoot(cwd = process.cwd()) {
  const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8' });
  if (r.status !== 0) return null;
  return path.dirname(path.resolve(r.stdout.trim()));
}
export function needRoot() {
  const root = repoRoot();
  if (!root) { say('fk: this folder is not inside a git repository.'); process.exit(1); }
  return root;
}

export const slug = (root) => path.basename(root).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';

// --flag value | --flag=value; BOOL flags take no value; repeatable flags collect into arrays.
const BOOL = new Set(['yes', 'purge', 'json', 'new', 'strict', 'no-gitleaks', 'force', 'no-tighten']);
export function parseArgs(args) {
  const pos = [], flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const [k, inline] = a.slice(2).split(/=(.*)/s);
    const v = BOOL.has(k) ? true : inline ?? args[++i];
    if (v === undefined) continue;
    flags[k] = flags[k] === undefined ? v : [].concat(flags[k], v);
  }
  return { pos, flags };
}
export const many = (v) => (v === undefined ? [] : [].concat(v));
// "name=cmd" pairs -> [[name, cmd]]
export const pairs = (v) => many(v).map((s) => String(s).split(/=(.*)/s)).filter(([n, c]) => n && c);

// Writes under .fk/ go through here: a .fk/ that did not exist gets a full snapshot (so the hooks start
// consistent); otherwise only the written files are refreshed, so gate-guard sees no tamper.
export function fkWrite(root, rel, value) {
  const fresh = !fs.existsSync(path.join(root, '.fk'));
  const abs = path.join(root, rel);
  if (typeof value === 'string') { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, value); }
  else writeJson(abs, value);
  if (fresh) {
    // same runtime list `fk init` writes, so hook state is never committed before init runs
    fs.writeFileSync(path.join(root, '.fk', '.gitignore'), RUNTIME.join('\n') + '\n');
    takeSnapshot(root);
  } else refreshSnapshot(root, [rel]);
  return fresh;
}
// Protected files outside .fk/ (e.g. .claude/settings.json): refresh only when the kit is active.
export function sanctioned(root, rels, entry) {
  if (!fs.existsSync(path.join(root, '.fk'))) return;
  refreshSnapshot(root, rels);
  log(root, { event: 'cli', guard: 'fk', ...entry });
}

// ---- gate measurement: one number per gate (violations, or coverage %) ----
const COUNT = [
  /^[#ℹ\s]*fail\s+(\d+)\s*$/im, // node:test, TAP
  /\b(\d+)\s+(?:tests?\s+)?(?:failed|failing)\b/i, // jest, vitest, mocha, pytest
  /✖\s+(\d+)\s+problems?/, // eslint
  /\bFound\s+(\d+)\s+errors?/i, // ruff, tsc
  /\b(\d+)\s+(?:errors?|problems?|violations?|issues?)\b/i,
];
const COVERAGE = [/all files\s*\|\s*([\d.]+)/i, /^TOTAL\s.*?(\d+(?:\.\d+)?)%\s*$/m, /Statements\s*:\s*([\d.]+)%/i, /Lines\s*:\s*([\d.]+)%/i];

export const isCoverage = (name) => /cov/i.test(name);
export function parseCount(out, status) {
  for (const re of COUNT) { const m = re.exec(out); if (m) { const n = Number(m[1]); return status !== 0 && n === 0 ? 1 : n; } }
  return status === 0 ? 0 : 1;
}
export function parseCoverage(out) {
  for (const re of COVERAGE) { const m = re.exec(out); if (m) return Number(m[1]); }
  return null;
}
// Runs only the command it is given (the agent or .fk/config.json names it); never guesses one.
export function measure(root, name, cmd) {
  const t0 = Date.now();
  const r = spawnSync(cmd, { cwd: root, shell: true, encoding: 'utf8', timeout: 15 * 60 * 1000, maxBuffer: 256 * 1024 * 1024 });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const kind = isCoverage(name) ? 'coverage' : 'count';
  return { cmd, kind, value: kind === 'coverage' ? parseCoverage(out) : parseCount(out, r.status), exit: r.status, ms: Date.now() - t0 };
}

// gitleaks full-history scan: counts per rule only, never values. null when gitleaks is absent.
export function gitleaks(root) {
  if (tool('gitleaks', ['version']).status !== 0) return null;
  const report = path.join(os.tmpdir(), `fk-gitleaks-${process.pid}-${Date.now()}.json`);
  try {
    const r = tool('gitleaks', ['git', '--redact', '--no-banner', '--exit-code', '0', '-f', 'json', '-r', report, root], { timeout: 10 * 60 * 1000 });
    let rows = [];
    try { rows = JSON.parse(fs.readFileSync(report, 'utf8')); } catch { if (r.status !== 0) return { error: 'gitleaks failed', count: null, rules: {} }; }
    const rules = {};
    for (const f of rows) rules[f.RuleID || 'unknown'] = (rules[f.RuleID || 'unknown'] || 0) + 1;
    return { count: rows.length, rules };
  } finally { fs.rmSync(report, { force: true }); }
}
