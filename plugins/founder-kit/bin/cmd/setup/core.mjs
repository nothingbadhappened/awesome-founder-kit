// `fk setup`: check, install, configure and verify the kit's base tools from compat.lock.json.
// Read-only until the founder says yes; every change goes to ~/.fk/install-ledger.jsonl with a rollback hint;
// the result goes to ~/.fk/base-tools.json, which the SessionStart note (hooks/session/10-base-tools.mjs) reads.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, cmpVer, omcPlugin, omcStatus, fetchOmcLatest, OMC_UPDATE, fkHome } from '../../../hooks/lib.mjs';
import { installSteps, pluginSteps, palaceInitStep } from './recipes.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const loadLock = () => readJson(path.join(KIT, 'compat.lock.json'), null);
export const statusFile = () => path.join(fkHome(), 'base-tools.json');
export const ledgerFile = () => path.join(fkHome(), 'install-ledger.jsonl');
export const osName = (p = process.platform) => (p === 'win32' ? 'win' : p === 'darwin' ? 'mac' : 'linux');

// Order matters: later tools install with earlier ones (uv before MemPalace, claude before plugins).
export const TOOLS = [
  { id: 'git', label: 'git', bin: 'git', size: 'about 300 MB', why: 'keeps every version of your project, so nothing is ever lost' },
  { id: 'node', label: 'Node.js', bin: 'node', size: 'about 100 MB', why: 'runs the kit\'s safety checks' },
  { id: 'uv', label: 'uv', bin: 'uv', size: 'about 40 MB', why: 'installs the Python helpers below, each in its own sealed box' },
  { id: 'claude-code', label: 'Claude Code', bin: 'claude', size: 'about 200 MB', why: 'the AI assistant the kit runs inside' },
  { id: 'gh', label: 'GitHub CLI (optional)', bin: 'gh', size: 'about 40 MB', why: 'lets Claude publish your project to GitHub' },
  { id: 'oh-my-claudecode', label: 'oh-my-claudecode', size: 'about 20 MB', why: 'the agent team and workflow the kit builds on' },
  { id: 'codebase-memory-mcp', label: 'codebase-memory', bin: 'codebase-memory-mcp', size: 'about 40 MB', why: 'gives Claude a map of your code so it reads less and costs less' },
  { id: 'mempalace', label: 'MemPalace', bin: 'mempalace', size: 'about 500 MB', why: 'remembers decisions between sessions, on your machine only' },
  { id: 'skillspector', label: 'SkillSpector', bin: 'skillspector', size: 'about 150 MB', why: 'scans add-ons for malicious instructions before they are used' },
  { id: 'gitleaks', label: 'gitleaks', bin: 'gitleaks', args: ['version'], size: 'about 20 MB', why: 'stops passwords and keys from being saved into your project' },
];

const WIN = process.platform === 'win32';
// Version probe: `<bin> --version`. Commands are fixed strings (no user input), so a single shell line is safe on Windows.
export function probe(bin, args = ['--version'], env = process.env) {
  const r = WIN
    ? spawnSync([bin, ...args].join(' '), { shell: true, encoding: 'utf8', env, timeout: 30000, windowsHide: true })
    : spawnSync(bin, args, { encoding: 'utf8', env, timeout: 30000 });
  if (r.error || r.status !== 0) return null;
  const out = String(r.stdout || '').trim();
  return { out, version: /\d+\.\d+\.\d+/.exec(out)?.[0] || /\d+\.\d+\.\d+/.exec(r.stderr || '')?.[0] || null };
}

function grade(version, spec) {
  if (!version) return ['red', 'missing'];
  if (spec.min && cmpVer(version, spec.min) < 0) return ['red', 'below-floor'];
  if (spec.version && cmpVer(version, spec.version) < 0) return ['yellow', 'behind'];
  return ['green', 'ok'];
}

const pluginsDir = () => path.join(os.homedir(), '.claude', 'plugins');
export const pluginInstalled = (name) => Object.keys(readJson(path.join(pluginsDir(), 'installed_plugins.json'), {}).plugins || {}).some((k) => k.startsWith(name + '@'));
export const marketplaceAdded = (repo) => Object.values(readJson(path.join(pluginsDir(), 'known_marketplaces.json'), {}))
  .some((m) => String(m?.source?.repo || '').toLowerCase() === repo.toLowerCase());
const pluginState = (spec) => ({ marketplaceAdded: marketplaceAdded(spec.marketplace), pluginInstalled: pluginInstalled(spec.plugin.split('@')[0]) });

// MemPalace config dir, in MemPalace's own order (mempalace/config.py _default_config_dir).
export function mempalaceConfigDir(env = process.env) {
  if (env.MEMPALACE_CONFIG_DIR?.trim()) return env.MEMPALACE_CONFIG_DIR;
  const legacy = path.join(os.homedir(), '.mempalace');
  if (['config.json', 'people_map.json', path.join('palace', 'chroma.sqlite3')].some((f) => fs.existsSync(path.join(legacy, f)))) return legacy;
  if (env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME)) return path.join(env.XDG_CONFIG_HOME, 'mempalace');
  return path.join(os.homedir(), '.config', 'mempalace');
}

// One row per tool: { id, label, level, reason, version, note, steps: [{ action, cmd|fn, rollback }] }.
export async function detect(lock, { env = process.env, os: o = osName(), withGh = false, has } = {}) {
  has ||= (bin) => !!(o === 'win' ? probe('where.exe', [bin], env) : probe('sh', ['-c', `command -v ${bin}`], env));
  const rows = [];
  const next = [];
  for (const tool of TOOLS) {
    const spec = lock.tools[tool.id];
    const row = { id: tool.id, label: tool.label, why: tool.why, size: tool.size, version: null, level: 'green', reason: 'ok', note: '', steps: [] };
    const add = (action, list) => row.steps.push(...list.map((s) => ({ action, tool: tool.id, ...s })));

    if (tool.id === 'oh-my-claudecode') {
      const plugin = omcPlugin();
      const npm = plugin ? null : probe('omc', ['--version'], env); // the plugin copy wins when both are present
      row.version = plugin?.version || npm?.version || null;
      if (npm) {
        // npm mode is supported. Adding the plugin copy too would fire OMC's hooks twice until `omc setup` dedupes them,
        // so the kit never adds it on its own.
        const st = omcStatus(npm.version, (await fetchOmcLatest()) || spec.version);
        if (st?.level === 'red') {
          Object.assign(row, { level: 'red', reason: 'below-floor', note: `${npm.version} (npm) is below the supported floor ${st.floor}` });
          add('upgrade', [{ cmd: `npm i -g ${spec.npm_package}@${spec.version}`, rollback: 'npm i -g <the previous version>' }]);
          next.push('After the OMC update, run `omc setup` in a terminal.');
        } else Object.assign(row, { level: 'yellow', reason: 'npm', note: 'npm install: supported; plugin mode optional' });
      } else if (!plugin) {
        add('install', pluginSteps(spec, pluginState(spec)));
        Object.assign(row, { level: 'red', reason: 'missing', note: 'not installed' });
        next.push('In Claude Code, run /oh-my-claudecode:omc-setup once (OMC\'s own one-time setup).');
      } else {
        const st = omcStatus(plugin.version, (await fetchOmcLatest()) || spec.version);
        if (st?.level === 'red') {
          Object.assign(row, { level: 'red', reason: 'below-floor', note: `${plugin.version} is below the supported floor ${st.floor}` });
          add('upgrade', [{ cmd: 'claude plugin marketplace update omc', rollback: '-' }, { cmd: `claude plugin update ${spec.plugin}`, rollback: 'reinstall the previous version from /plugin' }]);
          next.push('After the OMC update, run /oh-my-claudecode:omc-setup again in Claude Code.');
        } else if (st?.level === 'yellow') Object.assign(row, { level: 'yellow', reason: 'behind', note: `${st.latest} is out; update when ready: ${OMC_UPDATE.plugin}` });
      }
      rows.push(row);
      continue;
    }

    const p = probe(tool.bin, tool.args, env);
    row.version = p?.version || null;
    const [level, reason] = grade(row.version, spec);
    Object.assign(row, { level, reason });
    if (reason === 'missing') row.note = 'not installed';
    if (reason === 'below-floor') row.note = `${row.version} is older than the minimum ${spec.min}`;
    if (reason === 'behind') row.note = `works; the tested version is ${spec.version}`;
    if (level === 'green' && spec.version && cmpVer(row.version, spec.version) > 0) row.note = `newer than the tested ${spec.version}; kept`;
    if (level === 'red') add(reason === 'missing' ? 'install' : 'upgrade', installSteps(tool.id, lock, o, { has, upgrade: reason === 'below-floor' }));

    if (tool.id === 'gh' && level === 'red') {
      Object.assign(row, { level: 'yellow', reason: 'optional', note: withGh ? row.note : `${row.note} (optional; add --with-gh to include it)` });
      if (!withGh) row.steps = [];
    }

    if (tool.id === 'codebase-memory-mcp') {
      for (const [key, want] of Object.entries(spec.config)) {
        const have = p ? probe(tool.bin, ['config', 'get', key], env)?.out : null;
        if (p && have === want) continue;
        add('configure', [{ cmd: `codebase-memory-mcp config set ${key} ${want}`, rollback: `codebase-memory-mcp config set ${key} ${have || 'true'}` }]);
        if (p && row.level !== 'red') Object.assign(row, { level: 'red', reason: 'not-configured', note: `${key} is ${have || 'not set'}; the kit keeps it ${want} so indexing runs only when asked` });
      }
    }

    if (tool.id === 'mempalace') {
      const ps = pluginState(spec);
      if (!ps.pluginInstalled || !ps.marketplaceAdded) {
        add('install', pluginSteps(spec, ps));
        if (row.level !== 'red') Object.assign(row, { level: 'red', reason: 'plugin-missing', note: 'the Claude Code plugin is not installed' });
      }
      const dir = mempalaceConfigDir(env);
      const cfg = readJson(path.join(dir, 'config.json'), null);
      const palace = cfg?.palace_path || path.join(dir, 'palace');
      const notes = [];
      if (!fs.existsSync(palace)) {
        add('configure', [palaceInitStep(lock, o, path.join(fkHome(), 'palace-home'))]);
        if (row.level !== 'red') Object.assign(row, { level: 'red', reason: 'not-configured', note: 'no palace yet' });
      } else if ((cfg?.backend || 'chroma') !== spec.backend) notes.push(`your existing palace uses the ${cfg?.backend || 'chroma'} backend; kept as is (switching needs a migration)`);
      if (cfg?.hooks?.silent_save === false) notes.push('hooks.silent_save is off (your choice; kept)');
      else if (cfg?.hooks?.silent_save === undefined) {
        add('configure', [{ fn: 'silent-save', cmd: `set hooks.silent_save = true in ${path.join(dir, 'config.json')}`, rollback: 'remove "hooks.silent_save" from that config.json' }]);
      }
      if (env.MEMPAL_DIR) notes.push('MEMPAL_DIR is set, so MemPalace mines that folder on every save; the kit recommends unsetting it');
      if (notes.length) {
        if (row.level === 'green') row.level = 'yellow';
        row.note = [row.note, ...notes].filter(Boolean).join('; ');
      }
    }
    rows.push(row);
  }
  return { rows, next };
}

// Steps that only run inside this process (no shell).
export const FNS = {
  'silent-save': (env) => {
    const file = path.join(mempalaceConfigDir(env), 'config.json');
    const cfg = readJson(file, {});
    if (cfg.hooks?.silent_save === undefined) writeJson(file, { ...cfg, hooks: { ...(cfg.hooks || {}), silent_save: true } });
    return true;
  },
};

export function appendLedger(entry) {
  fs.mkdirSync(path.dirname(ledgerFile()), { recursive: true });
  fs.appendFileSync(ledgerFile(), JSON.stringify({ ts: new Date().toISOString(), via: 'fk setup', ...entry }) + '\n');
}

export function writeStatus(rows, lock) {
  const tools = Object.fromEntries(rows.map((r) => [r.id, { level: r.level, reason: r.reason, version: r.version, min: lock.tools[r.id]?.min || null, note: r.note }]));
  writeJson(statusFile(), { ts: new Date().toISOString(), checked_by: 'fk setup', lock_checked: lock.checked, tools });
}

// Windows: winget and the official installers edit the registry PATH; pick it up without a new terminal.
function refreshPath(env) {
  const extra = [path.join(os.homedir(), '.local', 'bin')];
  let fresh = '';
  if (WIN) {
    extra.push(path.join(process.env.LOCALAPPDATA || '', 'Programs', 'codebase-memory-mcp'));
    const r = spawnSync('powershell', ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"], { encoding: 'utf8', windowsHide: true });
    fresh = r.status === 0 ? r.stdout.trim() : '';
  } else extra.push('/opt/homebrew/bin', '/usr/local/bin');
  const seen = new Set();
  const parts = [...extra, ...fresh.split(path.delimiter), ...String(env.PATH || '').split(path.delimiter)]
    .filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
  env.PATH = parts.join(path.delimiter);
  if (WIN) env.Path = env.PATH;
}

// ---- user-level `fk` shim: ~/.local/bin/fk (+ fk.cmd on Windows) -> ~/.fk/fk-shim.mjs, which finds the installed plugin
// at run time (installed_plugins.json), so plugin updates never leave it pointing at an old version.
const SHIM_MARK = 'founder-kit user shim';
const SHIM_JS = `// ${SHIM_MARK} (written by fk setup; fk setup --remove-shim removes it). Finds the installed plugin at run time.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
let e;
try {
  const reg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json'), 'utf8')).plugins || {};
  const key = reg['founder-kit@awesome-founder-kit'] ? 'founder-kit@awesome-founder-kit' : Object.keys(reg).find((k) => k.startsWith('founder-kit@'));
  e = [].concat(reg[key])[0];
} catch { /* not installed */ }
const cli = e?.installPath && path.join(e.installPath, 'bin', 'fk.mjs');
if (!cli || !fs.existsSync(cli)) { console.error('fk: the founder-kit plugin is not installed. In a terminal run: claude plugin install founder-kit@awesome-founder-kit'); process.exit(1); }
process.argv[1] = cli;
await import(pathToFileURL(cli).href);
`;
export function shimPaths(home = os.homedir(), win = WIN) {
  const bin = path.join(home, '.local', 'bin');
  return { bin, js: path.join(home, '.fk', 'fk-shim.mjs'), files: { [path.join(bin, 'fk')]: `#!/bin/sh\n# ${SHIM_MARK} (fk setup --remove-shim removes it)\nexec node "$HOME/.fk/fk-shim.mjs" "$@"\n`,
    ...(win ? { [path.join(bin, 'fk.cmd')]: `@rem ${SHIM_MARK} (fk setup --remove-shim removes it)\r\n@node "%USERPROFILE%\\.fk\\fk-shim.mjs" %*\r\n` } : {}) } };
}
const ours = (f) => { try { return fs.readFileSync(f, 'utf8').includes(SHIM_MARK); } catch { return false; } };

// Windows: append ~/.local/bin to the user Path (HKCU\Environment, kept as REG_EXPAND_SZ) when missing; true when added.
export function winUserPath(dir) {
  const ps = `$d='${dir.replace(/'/g, "''")}'; $k=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment'); `
    + "$p=[string]$k.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); "
    + "if ((($p -split ';') | ForEach-Object { [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\\') }) -notcontains $d) { "
    + "$k.SetValue('Path', ((@($p.TrimEnd(';'), $d) | Where-Object { $_ }) -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString); "
    + "[Environment]::SetEnvironmentVariable('FK_PATH_REFRESH', '1', 'User'); [Environment]::SetEnvironmentVariable('FK_PATH_REFRESH', $null, 'User'); 'added' }";
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true });
  return /added/.test(r.stdout || '');
}

// Returns plain lines for the founder. Never overwrites an `fk` that is not ours.
export function shim(action, { home = os.homedir(), win = WIN, env = process.env, userPath = winUserPath, dry = false } = {}) {
  const { bin, js, files } = shimPaths(home, win);
  if (dry) return [`fk command (dry run): would ${action === 'remove' ? 'remove' : 'write'} ${[js, ...Object.keys(files)].join(', ')}. Nothing was changed.`];
  if (action === 'remove') {
    const gone = [js, ...Object.keys(files)].filter((f) => ours(f) && (fs.rmSync(f), true));
    return [gone.length ? `fk command removed (${gone.length} file(s)). ${bin} stays on PATH (other tools use it).` : 'fk command: no shim to remove.'];
  }
  const out = [];
  fs.mkdirSync(path.dirname(js), { recursive: true });
  fs.writeFileSync(js, SHIM_JS);
  for (const [f, text] of Object.entries(files)) {
    if (fs.existsSync(f) && !ours(f)) { out.push(`fk command: kept your own ${f}; the kit did not replace it.`); continue; }
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(f, text, { mode: 0o755 });
  }
  const onPath = String(env.PATH || env.Path || '').split(path.delimiter).some((p) => path.resolve(p || '.').toLowerCase() === bin.toLowerCase());
  if (win) { if (userPath(bin)) out.push(`fk command: added ${bin} to your user PATH (new terminals pick it up).`); }
  else if (!onPath) out.push(`fk command: add this line to ~/.profile (or ~/.zshrc), then open a new terminal: export PATH="$HOME/.local/bin:$PATH"`);
  out.unshift(`fk command: ready (${path.join(bin, 'fk')}; it finds the installed kit by itself; undo: fk setup --remove-shim).`);
  return out;
}

export function realExec(step, env) {
  if (step.fn) return { ok: FNS[step.fn](env) };
  const r = WIN
    ? spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', step.cmd], { stdio: ['ignore', 'inherit', 'inherit'], env })
    : spawnSync('bash', ['-c', step.cmd], { stdio: ['ignore', 'inherit', 'inherit'], env });
  refreshPath(env);
  return { ok: r.status === 0 };
}
