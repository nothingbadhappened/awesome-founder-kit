// Shared helpers for the founder-kit hooks and the fk CLI. Pure Node, no deps.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const GUARDS = ['secret-guard', 'gate-guard', 'install-guard', 'cloud-guard', 'git-guard', 'iteration-guard'];
// Names a founder may override with `fk-override <name> <reason>`: the guards, task-check (read by `fk task done`)
// and kickoff (`fk kickoff release` before docs/00-constraints.md is committed).
export const OVERRIDABLE = [...GUARDS, 'task-check', 'kickoff'];
export const FAIL_CLOSED = new Set(['secret-guard', 'gate-guard', 'install-guard']);
// .fk/.gitignore: kit-written files that never belong in a commit (hook state lives outside the repo, see stateDir).
export const RUNTIME = ['ledger.jsonl', 'steward.json', 'adopt/', 'quarantine/'];
// Files in .fk/ the kit itself writes; never hashed, never writable by tools.
export const HOOK_OWNED = new Set(['.fk/ledger.jsonl']);
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
  // .claude/agents/**: a project agent could carry a reviewer's name (fk task counts reviews by agent name).
  strict: ['.fk/**', '.mcp.json', '.claude/settings*.json', '.claude/omc.jsonc', '.claude/agents/**'],
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

// ---- hook-owned state (snapshots, overrides, compliance log) lives outside the repo, in <home>/.fk/state/<root hash>/,
// so a git checkout, a branch switch or an edit inside the project does not reset it. It is NOT tamper-proof: agents
// run as the same OS user and can reach <home>/.fk. The guards stop drifting agents (gate.mjs hard-stops shell and
// file-tool writes there); a determined one is stopped only by Claude Code's sandbox plus the deny rules fk init
// writes (fk doctor: "guard strength"). FK_HOME moves <home>/.fk (tests).
export const fkHome = () => process.env.FK_HOME || path.join(os.homedir(), '.fk');
// Machine-wide kit caches (base tools, OMC latest, note throttles) also live under <home>/.fk/state.
export const homeCache = (name) => path.join(fkHome(), 'state', name);
const STATE_FILES = ['snapshots.json', 'compliance.jsonl'];
const stateDirs = new Map();
// One identity per project folder: real path (Windows 8.3 short names expanded), case-folded on Windows.
export function rootKey(root) {
  let real = path.resolve(root);
  try { real = fs.realpathSync.native(real); } catch { /* not there */ }
  return hash(process.platform === 'win32' ? real.toLowerCase() : real);
}
export function stateDir(root) {
  const key = `${fkHome()}|${root}`;
  if (stateDirs.has(key)) return stateDirs.get(key);
  const dir = path.join(fkHome(), 'state', rootKey(root));
  // First run after the move out of the repo: carry the old snapshot and log over. An in-repo override is dropped, never carried.
  const old = path.join(root, '.fk');
  if (!fs.existsSync(dir) && [...STATE_FILES, 'overrides.json'].some((f) => fs.existsSync(path.join(old, f)))) {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of STATE_FILES) { try { fs.copyFileSync(path.join(old, f), path.join(dir, f)); } catch { /* absent */ } }
    for (const f of [...STATE_FILES, 'overrides.json']) fs.rmSync(path.join(old, f), { force: true });
    // Old hashes kept line endings; a file that still matches its old hash gets the new (line-ending-blind) hash.
    const snap = readJson(path.join(dir, 'snapshots.json'), null);
    if (snap?.files) {
      for (const [rel, h] of Object.entries(snap.files)) {
        try { if (hash(gateText(rel, fs.readFileSync(path.join(root, rel), 'utf8'))) === h) snap.files[rel] = hashFile(root, rel); } catch { /* gone */ }
      }
      writeJson(path.join(dir, 'snapshots.json'), snap);
    }
  }
  stateDirs.set(key, dir);
  return dir;
}
export const stateFile = (root, name) => path.join(stateDir(root), name);

// Fields every log line of this process carries (dispatch.mjs sets runtime: 'plugin' when it runs as the installed plugin).
export const logContext = {};
export function log(root, entry) {
  try {
    fs.mkdirSync(stateDir(root), { recursive: true });
    fs.appendFileSync(stateFile(root, 'compliance.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...entry, ...logContext }) + '\n');
  } catch { /* logging must never break a hook */ }
}
export const readLog = (root) => {
  try { return fs.readFileSync(stateFile(root, 'compliance.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
};

// ---- overrides (written only by UserPromptSubmit, i.e. typed by the human; valid only in the session it was typed in) ----
export const readOverrides = (root) => readJson(stateFile(root, 'overrides.json'), { overrides: [] }).overrides || [];

export function activeOverride(root, guard, session, now = Date.now()) {
  return readOverrides(root).find((o) => o.guard === guard && !!o.session && o.session === session && Date.parse(o.expires) > now
    && Date.parse(o.expires) - Date.parse(o.ts) <= OVERRIDE_MS) || null;
}

export function addOverride(root, guard, reason, session, now = Date.now()) {
  const list = readOverrides(root).filter((o) => Date.parse(o.expires) > now);
  const o = { guard, reason, session, ts: new Date(now).toISOString(), expires: new Date(now + OVERRIDE_MS).toISOString() };
  list.push(o);
  writeJson(stateFile(root, 'overrides.json'), { overrides: list });
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

// Path classes shared by fk risk and the knowledge notes: docs and tests change no behaviour.
const DOC = /(?:^|\/)docs?\/|\.(?:md|mdx|markdown|txt|rst|adoc)$|(?:^|\/)(?:LICENSE|CHANGELOG|AUTHORS)[^/]*$/i;
const TEST = /(?:^|\/)(?:tests?|__tests__|spec|specs|fixtures|e2e)\/|[._-](?:test|spec)\.[\w]+$|\.spec\.|_test\.go$|(?:^|\/)(?:test_[^/]+|tests?|conftest)\.py$/i;
const JAVA_TEST = /[a-z0-9]Tests?\.(?:java|kt)$/; // FooTest.java (case matters: not latest.java)
export const MANIFEST = /(?:^|\/)(?:package\.json|Packages\/manifest\.json|requirements[\w.-]*\.txt|pyproject\.toml|Pipfile|Cargo\.toml|go\.mod|Gemfile|composer\.json|build\.gradle(?:\.kts)?|pom\.xml)$/;
const CMAKE = /(?:^|\/)CMakeLists\.txt$/i;
// Docs and tests change no behaviour; a manifest that ends in .txt (requirements.txt, CMakeLists.txt) does.
export const quietPath = (p) => (DOC.test(p) && !MANIFEST.test(p) && !CMAKE.test(p)) || TEST.test(p) || JAVA_TEST.test(p);

// pyproject.toml is only a gate file for its [tool.*] sections, minus the packaging tools (dependencies and build
// settings are not gates).
const PY_PACKAGING = /^tool\.(?:poetry|uv|pdm|hatch|setuptools|setuptools_scm|maturin|scikit-build|flit)(?:\.|$)/i;
export function gateText(rel, text) {
  if (!/(^|\/)pyproject\.toml$/i.test(rel)) return text;
  let keep = false;
  return text.split(/\r?\n/).filter((l) => {
    const h = /^\s*\[\[?([^\]]+)\]/.exec(l);
    if (h) { const name = h[1].trim().replace(/["']/g, ''); keep = /^tool\./.test(name) && !PY_PACKAGING.test(name); }
    return keep;
  }).join('\n');
}

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

// Line-ending blind, so a git checkout with autocrlf restores trust.
export function hashFile(root, rel) {
  try { return hash(gateText(rel, fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n'))); } catch { return null; }
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

const snapFile = (root) => stateFile(root, 'snapshots.json');
export const readSnapshot = (root) => readJson(snapFile(root), { files: {}, reported: null });

export function takeSnapshot(root) {
  const files = {};
  for (const rel of listProtected(root)) files[rel] = hashFile(root, rel);
  writeJson(snapFile(root), { files, reported: null });
  return files;
}

// The committed version's hash; '-' when it is not committed (kit runtime files, never committed, are not judged: null).
function headHash(root, rel) {
  const r = spawnSync('git', ['show', `HEAD:${rel}`], { cwd: root, encoding: 'utf8' });
  if (r.status === 0) return hash(gateText(rel, r.stdout.replace(/\r\n/g, '\n')));
  return RUNTIME.some((f) => rel === `.fk/${f}` || (f.endsWith('/') && rel.startsWith(`.fk/${f}`))) ? null : '-';
}

// SessionStart: a new baseline, except that a .fk JSON file changed behind the kit since the last snapshot keeps its old
// hash (sanctionedJson keeps distrusting it; already reported, so PostToolUse stays quiet). No snapshot for this checkout
// (a fresh clone, or the state dir was removed): only the last commit vouches. Each .fk JSON (and any the snapshot does
// not know) is compared with `git show HEAD:<file>`; committed-and-identical is trusted, untracked or different stays
// distrusted. Returns the files still distrusted.
export function sessionSnapshot(root) {
  const lost = !fs.existsSync(snapFile(root));
  const prev = lost ? {} : readSnapshot(root).files || {};
  const files = {};
  const kept = [];
  for (const rel of listProtected(root)) {
    files[rel] = hashFile(root, rel);
    if (!/^\.fk\/.+\.jsonc?$/i.test(rel)) continue;
    const was = lost || !(rel in prev) ? headHash(root, rel) : prev[rel]; // not in the snapshot: only the commit vouches for it
    if (was && was !== files[rel]) { kept.push(rel); files[rel] = was; }
  }
  const reported = kept.length ? kept.sort().map((r) => `${r}:${hashFile(root, r)}`).join('|') : null;
  writeJson(snapFile(root), { files, reported });
  return kept;
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

// PostToolUse: only files whose mtime/size moved are re-hashed (memo: path -> [mtimeMs, size, hash], in the state dir).
// Finding new protected files: a small tree is walked (cheaper than starting git); once a walk takes longer than
// WALK_MS, git status lists the changed and untracked files instead (gitignored files are then not seen).
const memoFile = (root) => stateFile(root, 'hashmemo.json');
const WALK_MS = 25;
export function quickDiff(root) {
  const snap = readSnapshot(root);
  const saved = readJson(memoFile(root), {});
  const memo = saved.files || {};
  let walkMs = saved.walkMs ?? 0;
  let listed;
  if (walkMs < WALK_MS) {
    const t0 = Date.now();
    listed = listProtected(root);
    walkMs = Date.now() - t0;
  } else {
    const r = spawnSync('git', ['status', '--porcelain', '-z', '--untracked-files=all', '--no-renames'], { cwd: root, encoding: 'utf8' });
    listed = r.status === 0 ? r.stdout.split('\0').filter(Boolean).map((l) => l.slice(3)).filter((rel) => !HOOK_OWNED.has(rel) && protectedClass(root, rel))
      : listProtected(root);
  }
  const next = {};
  const hashOf = (rel) => {
    let st;
    try { st = fs.statSync(path.join(root, rel)); } catch { return null; }
    const m = memo[rel];
    const h = m && m[0] === st.mtimeMs && m[1] === st.size ? m[2] : hashFile(root, rel);
    next[rel] = [st.mtimeMs, st.size, h];
    return h;
  };
  const now = {};
  for (const rel of new Set([...Object.keys(snap.files), ...listed])) { const h = hashOf(rel); if (h) now[rel] = h; }
  try { writeJson(memoFile(root), { walkMs, files: next }); } catch { /* the memo is only a speed-up */ }
  const changed = [...new Set([...Object.keys(snap.files), ...Object.keys(now)])].filter((rel) => snap.files[rel] !== now[rel]).sort();
  return { snap, now, changed };
}

export function diffSnapshot(root) {
  const snap = readSnapshot(root);
  const now = {};
  for (const rel of listProtected(root)) now[rel] = hashFile(root, rel);
  const changed = [...new Set([...Object.keys(snap.files), ...Object.keys(now)])]
    .filter((rel) => snap.files[rel] !== now[rel]).sort();
  return { snap, now, changed };
}

// ---- git hooks: .githooks/pre-commit runs only when core.hooksPath is .githooks, or when a foreign hooks dir
// (husky, ...) chains it (fk init --chain). { hp, on } or null when the project has no .githooks/pre-commit.
export const CHAIN_MARK = 'founder-kit pre-commit (fk init --chain)';
export function hooksPathStatus(root) {
  if (!fs.existsSync(path.join(root, '.githooks', 'pre-commit'))) return null;
  const r = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8' });
  const hp = r.status === 0 ? r.stdout.trim() : '';
  if (hp && path.resolve(root, hp) === path.resolve(root, '.githooks')) return { hp, on: true };
  let chained = false;
  if (hp) { try { chained = fs.readFileSync(path.join(path.resolve(root, hp), 'pre-commit'), 'utf8').includes(CHAIN_MARK); } catch { /* none */ } }
  return { hp, on: chained };
}

// ---- small shell helpers for Bash/PowerShell guards ----
// The literal body of a quoted heredoc (cat > notes.md <<'EOF') or single-quoted here-string (Set-Content x.md -Value @'...'@)
// written to a doc file is text, not commands: a review that cites ".fk/config.json" or "git commit --no-verify" is not run.
// Unquoted forms expand $(...) and stay in.
// Only the plain one-command shape: cat > <doc> <<'EOF' (or cat <<'EOF' > <doc>); Set-Content|Add-Content ... <doc> ... -Value @'.
const TO_DOC = /^\s*>>?\s*["']?[^\s"'<>|;&]+\.(?:md|mdx|markdown|txt)["']?\s*$/i;
export function docBodies(cmd) {
  return String(cmd)
    .replace(/^([ \t]*cat[ \t]*)([^\n<]*)<<-?[ \t]*(['"])(\w+)\3([^\n]*)\n[\s\S]*?\n[ \t]*\4[ \t]*(?=\n|$)/g, // no m flag: only a heredoc that opens the whole command (a fake opener inside a string must not hide later lines)
      (m, cat, before, q, tag, after) => (TO_DOC.test(before.trim() ? before : after) && !(before.trim() && after.trim()) ? `${cat}${before}${after}` : m))
    .replace(/^([ \t]*(?:Set-Content|Add-Content)\b[^\n;|&]*?\.(?:md|mdx|markdown|txt)\b[^\n;|&]*?)@'\r?\n[\s\S]*?\r?\n'@([ \t]*)$/gi,
      (m, head, tail) => `${head}''${tail}`);
}
export function segments(cmd) {
  return docBodies(cmd).split(/&&|\|\||[;|\n]/).map((s) => s.trim()).filter(Boolean);
}
export function tokens(seg) {
  const out = [];
  // A quoted part stays glued to the text around it: "$PWD":/app is one word, as the shell sees it.
  const re = /(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s"'])+/g;
  let m;
  while ((m = re.exec(seg))) out.push(m[0].replace(/"((?:\\.|[^"\\])*)"|'([^']*)'/g, (_, a, b) => a ?? b));
  return out;
}
export const shellTool = (t) => t === 'Bash' || t === 'PowerShell';

// ---- OMC version policy: supported floor = (latest major - 1).0.0; latest cached 24 h in ~/.fk/state/omc-latest.json ----
const DAY = 24 * 60 * 60 * 1000;
const omcCacheFile = () => homeCache('omc-latest.json');
export const readOmcCache = () => readJson(omcCacheFile(), {});
export const writeOmcCache = (patch) => writeJson(omcCacheFile(), { ...readOmcCache(), ...patch });
export const OMC_UPDATE = {
  plugin: '/plugin marketplace update omc, then /plugin update oh-my-claudecode@omc',
  // The install guard stops an agent's global install in a .fk project, so the founder runs it from the prompt.
  npm: 'type `! npm i -g oh-my-claude-sisyphus@latest` in the Claude Code prompt yourself (the install guard stops an agent\'s global install), then `omc setup`',
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

// Log lines a founder typed: written by the installed founder-kit plugin's dispatcher (runtime: plugin) from this kit's
// folder, an installed founder-kit version (installed_plugins.json) or a sibling version folder. A line without
// plugin_root does not count. There is no HMAC: its key would sit in <home>/.fk next to the log, readable by the same
// agents it should keep out, so it would add nothing without the sandbox and nothing needed with it.
const KIT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const folded = (p) => { let r = path.resolve(p); try { r = fs.realpathSync.native(r); } catch { /* keep */ } return process.platform === 'win32' ? r.toLowerCase() : r; };
let kitRoots;
export const installedKitRoots = () => kitRoots ??= [KIT_DIR, ...Object.entries(readJson(path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'plugins', 'installed_plugins.json'), {}).plugins || {})
  .filter(([k]) => k.startsWith('founder-kit@')).flatMap(([, v]) => [].concat(v)).map((e) => e?.installPath).filter(Boolean)].map(folded);
export function fromKit(r) {
  if (r?.runtime !== 'plugin' || !r.plugin_root) return false;
  const p = folded(r.plugin_root);
  return installedKitRoots().some((k) => p === k || path.dirname(p) === path.dirname(k));
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
