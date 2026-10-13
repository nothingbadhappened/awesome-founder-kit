// Shared helpers for the founder-kit hooks and the fk CLI. Pure Node, no deps.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

export const GUARDS = ['secret-guard', 'gate-guard', 'install-guard', 'cloud-guard', 'git-guard'];
export const FAIL_CLOSED = new Set(['secret-guard', 'gate-guard', 'install-guard']);
// Files the hooks themselves write; never hashed, never writable by tools.
export const HOOK_OWNED = new Set(['.fk/compliance.jsonl', '.fk/snapshots.json', '.fk/ledger.jsonl']);
const OVERRIDE_MS = 30 * 60 * 1000;

export const DEFAULT_CONFIG = {
  runner: 'npm run',
  check: null, // full command; defaults to `<runner> check`
  stack: null,
  fast_gates: null,
  paths: { adr: 'docs/adr', constraints: 'docs/00-constraints.md', standards: 'docs/standards' },
  protected_extra: [],
};

// Path classes for C2. strict: any change needs approval. exceptions: only removals allowed.
// config: additions allowed unless an added line reads as loosening.
// soft: edits allowed unless they add a loosening line or drop a strictness/test/check line.
export const PROTECTED = {
  strict: ['.fk/**', '.mcp.json', '.claude/settings*.json', '.claude/omc.jsonc'],
  exceptions: ['**/.eslintignore', '**/.prettierignore', '**/.gitleaksignore', '**/.semgrepignore', '**/.stylelintignore'],
  config: [
    '.githooks/**', '.husky/**',
    '**/.eslintrc', '**/.eslintrc.*', '**/eslint.config.*', '**/.prettierrc', '**/.prettierrc.*', '**/prettier.config.*',
    '**/ruff.toml', '**/.ruff.toml', '**/mypy.ini', '**/.mypy.ini', '**/biome.json', '**/biome.jsonc',
    '**/.golangci.*', '**/pyproject.toml', '**/dependency-cruiser.*', '**/.dependency-cruiser.*', '**/.importlinter',
  ],
  soft: ['**/tsconfig*.json', '.github/workflows/**', '.gitlab-ci.yml', '.circleci/**', 'azure-pipelines.yml', 'bitbucket-pipelines.yml'],
};
const SKIP_DIRS = new Set(['node_modules', '.git', '.omc', 'dist', 'build', 'out', 'coverage', 'target', 'vendor',
  '.venv', 'venv', '__pycache__', '.next', '.turbo', '.cache']);

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// Resolves the project root the way `git rev-parse --git-common-dir`/.. would, without spawning git
// (keeps the inert path under 5 ms). Returns null when there is no .fk/ for this checkout.
export function findRoot(start) {
  let dir = path.resolve(start || process.cwd());
  for (;;) {
    if (isDir(path.join(dir, '.fk'))) return { root: dir, gitDir: gitDirOf(dir) };
    const dotgit = path.join(dir, '.git');
    if (fs.existsSync(dotgit)) {
      const gitDir = gitDirOf(dir);
      const common = commonDirOf(gitDir);
      const root = common ? path.dirname(common) : dir;
      return isDir(path.join(root, '.fk')) ? { root, gitDir } : null;
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function gitDirOf(dir) {
  const dotgit = path.join(dir, '.git');
  try {
    if (fs.statSync(dotgit).isDirectory()) return dotgit;
    const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotgit, 'utf8'));
    return m ? path.resolve(dir, m[1].trim()) : null;
  } catch { return null; }
}

function commonDirOf(gitDir) {
  if (!gitDir) return null;
  try { return path.resolve(gitDir, fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim()); }
  catch { return gitDir; }
}

export function currentBranch(gitDir) {
  try { return /ref:\s*refs\/heads\/(.+)/.exec(fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8'))?.[1].trim() ?? null; }
  catch { return null; }
}

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

export function loadConfig(root) {
  const c = readJson(path.join(root, '.fk', 'config.json'), {});
  return { ...DEFAULT_CONFIG, ...c, paths: { ...DEFAULT_CONFIG.paths, ...(c.paths || {}) } };
}

export function log(root, entry) {
  try {
    fs.appendFileSync(path.join(root, '.fk', 'compliance.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch { /* logging must never break a hook */ }
}

// ---- overrides (written only by UserPromptSubmit, i.e. typed by the human) ----
const overridesFile = (root) => path.join(root, '.fk', 'overrides.json');

export function activeOverride(root, guard, now = Date.now()) {
  const list = readJson(overridesFile(root), { overrides: [] }).overrides || [];
  return list.find((o) => o.guard === guard && Date.parse(o.expires) > now
    && Date.parse(o.expires) - Date.parse(o.ts) <= OVERRIDE_MS) || null;
}

export function addOverride(root, guard, reason, now = Date.now()) {
  const list = (readJson(overridesFile(root), { overrides: [] }).overrides || []).filter((o) => Date.parse(o.expires) > now);
  const o = { guard, reason, ts: new Date(now).toISOString(), expires: new Date(now + OVERRIDE_MS).toISOString() };
  list.push(o);
  writeJson(overridesFile(root), { overrides: list });
  refreshSnapshot(root, ['.fk/overrides.json']);
  return o;
}

// ---- protected-path matching and snapshots (C2) ----
export function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { i++; if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', 'i');
}

const matcherCache = new Map();
function matchers(root) {
  if (matcherCache.has(root)) return matcherCache.get(root);
  const extra = loadConfig(root).protected_extra || [];
  const m = Object.entries({ ...PROTECTED, config: [...PROTECTED.config, ...extra] })
    .flatMap(([cls, globs]) => globs.map((g) => [cls, globToRegex(g)]));
  matcherCache.set(root, m);
  return m;
}

export function relPath(root, file) {
  const rel = path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
  return rel.startsWith('..') || path.isAbsolute(rel) ? null : rel;
}

export function protectedClass(root, rel) {
  if (!rel) return null;
  for (const [cls, re] of matchers(root)) if (re.test(rel)) return cls;
  return null;
}

// pyproject.toml is only a gate file for its [tool.*] sections.
export function gateText(rel, text) {
  if (!/(^|\/)pyproject\.toml$/i.test(rel)) return text;
  let keep = false;
  return text.split(/\r?\n/).filter((l) => {
    const h = /^\s*\[\[?([^\]]+)\]/.exec(l);
    if (h) keep = /^tool\./.test(h[1].trim());
    return keep;
  }).join('\n');
}

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

export function hashFile(root, rel) {
  try { return hash(gateText(rel, fs.readFileSync(path.join(root, rel), 'utf8'))); } catch { return null; }
}

export function listProtected(root) {
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && depth < 6) walk(abs, depth + 1); }
      else if (!HOOK_OWNED.has(rel) && protectedClass(root, rel)) out.push(rel);
    }
  };
  walk(root, 0);
  return out;
}

const snapFile = (root) => path.join(root, '.fk', 'snapshots.json');
export const readSnapshot = (root) => readJson(snapFile(root), { files: {}, reported: null });

export function takeSnapshot(root) {
  const files = {};
  for (const rel of listProtected(root)) files[rel] = hashFile(root, rel);
  writeJson(snapFile(root), { files, reported: null });
  return files;
}

export function refreshSnapshot(root, rels) {
  const snap = readSnapshot(root);
  for (const rel of rels) {
    const h = hashFile(root, rel);
    if (h) snap.files[rel] = h; else delete snap.files[rel];
  }
  writeJson(snapFile(root), snap);
}

// A .fk JSON file the guards trust: only when it matches the snapshot (written by fk-approve lines or the fk CLI).
// Changed behind the kit's back -> the fallback (strict) and a 'tamper-config' log line.
export function sanctionedJson(root, rel, fallback) {
  const h = hashFile(root, rel);
  if (!h) return fallback;
  if (h === readSnapshot(root).files[rel]) return readJson(path.join(root, rel), fallback);
  log(root, { event: 'PreToolUse', guard: 'gate-guard', decision: 'tamper-config', changed: [rel] });
  return fallback;
}

export function diffSnapshot(root) {
  const snap = readSnapshot(root);
  const now = {};
  for (const rel of listProtected(root)) now[rel] = hashFile(root, rel);
  const changed = [...new Set([...Object.keys(snap.files), ...Object.keys(now)])]
    .filter((rel) => snap.files[rel] !== now[rel]).sort();
  return { snap, now, changed };
}

// ---- small shell helpers for Bash/PowerShell guards ----
export function segments(cmd) {
  return String(cmd).split(/&&|\|\||[;|\n]/).map((s) => s.trim()).filter(Boolean);
}
export function tokens(seg) {
  const out = [];
  const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(seg))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}
export const shellTool = (t) => t === 'Bash' || t === 'PowerShell';

// ---- OMC version policy: supported floor = (latest major - 1).0.0; latest cached 24 h in ~/.fk/omc-latest.json ----
const DAY = 24 * 60 * 60 * 1000;
const omcCacheFile = () => path.join(os.homedir(), '.fk', 'omc-latest.json');
export const readOmcCache = () => readJson(omcCacheFile(), {});
export const writeOmcCache = (patch) => writeJson(omcCacheFile(), { ...readOmcCache(), ...patch });
export const OMC_UPDATE = {
  plugin: '/plugin marketplace update omc, then /plugin update oh-my-claudecode@omc',
  npm: 'npm i -g oh-my-claude-sisyphus@latest, then omc setup',
};

export function cmpVer(a, b) {
  const p = (v) => String(v).replace(/^v/, '').split(/[.+-]/).slice(0, 3).map((n) => Number(n) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

// FK_OMC_LATEST (tests): a version is used as-is; "offline" behaves as a failed fetch; anything else means unknown.
const envLatest = () => {
  const e = process.env.FK_OMC_LATEST;
  if (e === undefined || e === 'offline') return undefined;
  return /^v?\d+\.\d+/.test(e) ? e.replace(/^v/, '') : null;
};

// Cache only, never the network (hot path). { latest, stale }.
export function omcLatestCached(now = Date.now()) {
  const e = envLatest();
  if (e !== undefined) return { latest: e, stale: false };
  const c = readOmcCache();
  return { latest: c.latest || null, stale: !c.ts || now - c.ts > DAY };
}

// Network with a 2 s budget; npm registry first, GitHub releases second; falls back to the cache.
export async function fetchOmcLatest() {
  const e = envLatest();
  if (e !== undefined) return e;
  if (process.env.FK_OMC_LATEST !== 'offline') {
    for (const [url, pick] of [['https://registry.npmjs.org/oh-my-claude-sisyphus', (j) => j['dist-tags']?.latest],
      ['https://api.github.com/repos/Yeachan-Heo/oh-my-claudecode/releases/latest', (j) => j.tag_name]]) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
        const v = r.ok && String(pick(await r.json()) || '').replace(/^v/, '');
        if (v) { writeOmcCache({ latest: v, ts: Date.now() }); return v; }
      } catch { /* offline or slow: skip silently */ }
    }
  }
  return readOmcCache().latest || null;
}

// Installed OMC from the plugin registry (no process spawn): { mode: 'plugin', version } or null.
export function omcPlugin() {
  const reg = readJson(path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json'), {});
  const key = Object.keys(reg.plugins || {}).find((k) => k.startsWith('oh-my-claudecode@'));
  if (!key) return null;
  const e = [].concat(reg.plugins[key])[0] || {};
  return { mode: 'plugin', version: readJson(path.join(e.installPath || '', '.claude-plugin', 'plugin.json'), {}).version || e.version || null };
}

// green: current; yellow: behind latest; red: below the supported floor. null when either version is unknown.
export function omcStatus(installed, latest) {
  if (!installed || !latest) return null;
  const floor = `${Math.max(0, Number(String(latest).split('.')[0]) - 1)}.0.0`;
  const level = cmpVer(installed, floor) < 0 ? 'red' : cmpVer(installed, latest) < 0 ? 'yellow' : 'green';
  return { level, installed, latest, floor };
}
