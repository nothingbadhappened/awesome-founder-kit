// The install ledger, ~/.fk/install-ledger.jsonl: one line per thing the kit found, installed, configured or created.
// Written by install/install.ps1, install/install.sh and `fk setup`; read by `fk uninstall --system`.
// Each line: { ts, via, tool, item, kind, action, version, how, scope, command, undo, paths?, ok }.
//   kind: pre-existing (found and kept; never removable) | installed | configured | data | upgraded (an update of a tool
//         that was already there; keeps its earlier kind) | runtime (machine start: nothing to undo) | removed.
//   paths: home-relative (~/...) files a script put down; uninstall removes exactly these, nothing else.
// The installers carry the same classification (Get-LedgerMeta in install.ps1, ledger_meta in install.sh); a test keeps
// all three in step.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fkHome } from '../../../hooks/lib.mjs';

export const ledgerFile = () => path.join(fkHome(), 'install-ledger.jsonl');

// winget packages that install per user (portable); the rest install for the whole machine.
const WINGET_USER = new Set(['jdx.mise', 'Casey.Just', 'Gitleaks.Gitleaks', 'Docker.DockerCompose']);
const BIN = '~/.local/bin/';

// A path as ~/... when it is under the home folder (the ledger names no user folders), else as it is.
export function tilde(p, home = os.homedir()) {
  const rel = path.relative(home, path.resolve(p));
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? `~/${rel.split(path.sep).join('/')}` : path.resolve(p);
}
export const untilde = (p, home = os.homedir()) => (/^~[\\/]/.test(p) ? path.join(home, p.slice(2)) : p);

// What one install step is, for the ledger and for undoing it. o: 'win' | 'mac' | 'linux'.
export function describe({ tool, action = 'install', cmd = '', rollback = '', fn }, o = 'linux') {
  const exe = (n) => BIN + (o === 'win' ? `${n}.exe` : n);
  const up = action === 'upgrade';
  const tool1 = (how, scope, undo, extra = {}) => ({ item: tool, kind: up ? 'upgraded' : 'installed', how, scope, undo: up ? null : undo, ...extra });
  const script = (paths) => tool1('script', 'user', `remove ${paths.join(' ')}`, { paths });
  let m;
  if (fn === 'silent-save') return { item: 'mempalace:silent-save', kind: 'configured', how: 'mempalace config', scope: 'user', undo: 'remove "hooks.silent_save" from the MemPalace config.json', fn: 'silent-save' };
  if ((m = /^claude plugin marketplace add (\S+)/.exec(cmd))) return { item: `${tool}:marketplace`, kind: 'installed', how: 'claude plugin', scope: 'user', undo: /^claude plugin marketplace remove \S+$/.test(rollback) ? rollback : null };
  if ((m = /^claude plugin install (\S+)/.exec(cmd))) return { item: `${tool}:plugin`, kind: 'installed', how: 'claude plugin', scope: 'user', undo: `claude plugin uninstall ${m[1]}` };
  if (/^claude plugin (?:marketplace )?update\b/.test(cmd)) return { item: `${tool}:plugin`, kind: 'upgraded', how: 'claude plugin', scope: 'user', undo: null };
  if (/^npm i(?:nstall)? -g /.test(cmd)) return { item: tool, kind: 'upgraded', how: 'npm', scope: 'user', undo: null };
  if ((m = /^winget install --id (\S+)/.exec(cmd))) return tool1('winget', WINGET_USER.has(m[1]) ? 'user' : 'machine', `winget uninstall --id ${m[1]} -e`);
  if ((m = /^brew install (\S+)/.exec(cmd))) return tool1('brew', 'machine', `brew uninstall ${m[1]}`);
  if ((m = /\bapt-get install -y (\S+)/.exec(cmd))) return tool1('apt', 'machine', `sudo apt-get remove -y ${m[1]}`);
  if ((m = /\bdnf install -y (\S+)/.exec(cmd))) return tool1('dnf', 'machine', `sudo dnf remove -y ${m[1]}`);
  if ((m = /\bpacman -S --noconfirm (\S+)/.exec(cmd))) return tool1('pacman', 'machine', `sudo pacman -R --noconfirm ${m[1]}`);
  if ((m = /^mise use -g ([\w-]+)@/.exec(cmd))) return tool1('mise', 'user', `mise unuse -g ${m[1]}`);
  if ((m = /^uv tool install\b/.exec(cmd))) return tool1('uv', 'user', /^uv tool uninstall [\w-]+$/.test(rollback) ? rollback : `uv tool uninstall ${tool}`);
  if (/^xcode-select --install/.test(cmd)) return tool1('xcode-select', 'machine', null); // Apple's developer tools: left in place
  if (/^git lfs install\b/.test(cmd)) return { item: 'git-lfs:config', kind: 'configured', how: 'git config', scope: 'user', undo: 'git lfs uninstall' };
  if ((m = /^codebase-memory-mcp config set (\w+) (\S+)/.exec(cmd))) return { item: `codebase-memory-mcp:${m[1]}`, kind: 'configured', how: 'codebase-memory-mcp config', scope: 'user', undo: rollback, value: m[2] };
  if (/^podman machine init\b/.test(cmd)) return { item: 'podman:machine', kind: 'configured', how: 'podman machine', scope: 'user', undo: 'podman machine rm -f podman-machine-default', name: 'podman-machine-default' };
  if (/^podman machine start\b/.test(cmd)) return { item: 'podman:machine-start', kind: 'runtime', how: 'podman machine', scope: 'user', undo: null };
  // The installers' MemPalace silent_save step (install.ps1 names the file; install.sh runs node -e on it).
  if ((m = /^set hooks\.silent_save = true in (.+)$/.exec(cmd)) || (m = /^node -e '.*silent_save.*' '([^']+)'$/.exec(cmd))) return { ...describe({ tool, fn: 'silent-save' }, o), file: tilde(m[1]) };
  if ((m = /mempalace init\b.*'([^']+)'/.exec(cmd))) { const p = tilde(m[1]); return { item: 'mempalace:palace', kind: 'data', how: 'mempalace init', scope: 'user', undo: `delete the folder ${p}`, paths: [p] }; }
  if (/astral\.sh\/uv\//.test(cmd)) return script([exe('uv'), exe('uvx')]);
  if (/claude\.ai\/install\./.test(cmd)) return script([exe('claude')]);
  if (/mise\.run/.test(cmd)) return script([exe('mise')]);
  if ((m = /nodejs\.org\/dist/.exec(cmd))) { const v = /V=([\d.]+)/.exec(cmd)?.[1]; return script([`~/.local/share/fk/node-v${v}`, `${BIN}node`, `${BIN}npm`, `${BIN}npx`]); }
  if (/gitleaks\/releases\/download/.test(cmd)) return script([exe('gitleaks')]);
  if (/codebase-memory-mcp\/v[\d.]+\/install\./.test(cmd)) return tool1('script', 'user', 'codebase-memory-mcp uninstall -y');
  if (/^echo /.test(cmd)) return { item: tool, kind: 'runtime', how: 'manual', scope: 'user', undo: null }; // printed a manual step; nothing ran
  return { item: tool, kind: action === 'configure' ? 'configured' : up ? 'upgraded' : 'installed', how: 'other', scope: 'user', undo: rollback && rollback !== '-' ? rollback : null };
}

export function readLedger(file = ledgerFile()) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  return text.split('\n').filter(Boolean).map((l) => { try { return normalize(JSON.parse(l)); } catch { return null; } }).filter(Boolean);
}

// Lines written before items and kinds existed: classified from their command.
export function normalize(r) {
  if (r.item && r.kind) return r;
  const o = r.via === 'install.ps1' || /\bwinget\b|Remove-Item|\.exe\b/.test(`${r.command} ${r.rollback}`) ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
  return { ...r, ...describe({ tool: r.tool, action: r.action, cmd: r.command || '', rollback: r.rollback || '' }, o) };
}

// The latest state of every item: pre-existing stays pre-existing through updates; an install after a removal is ours.
export function itemStates(rows = readLedger()) {
  const map = new Map();
  for (const r of rows) {
    if (r.ok === false || !r.item) continue;
    const prev = map.get(r.item);
    const live = prev && prev.state !== 'removed';
    if (r.kind === 'pre-existing') { if (!live || prev.state === 'pre-existing') map.set(r.item, { ...r, state: 'pre-existing' }); }
    else if (r.kind === 'upgraded') { if (!live) map.set(r.item, { ...r, state: 'pre-existing' }); else map.set(r.item, { ...prev, version: r.version || prev.version }); }
    else if (r.kind === 'removed') { if (prev) map.set(r.item, { ...prev, state: 'removed' }); }
    else if (['installed', 'configured', 'data'].includes(r.kind)) map.set(r.item, { ...r, state: r.kind });
  }
  return map;
}

export function appendLedger(entry, file = ledgerFile()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), via: 'fk setup', ...entry }) + '\n');
}

// Things found already in place (kept, never removable): one line each, only for items the ledger does not know yet.
export function notePreExisting(found, via = 'fk setup', file = ledgerFile()) {
  const known = new Set(readLedger(file).map((r) => r.item));
  for (const f of found) {
    if (known.has(f.item)) continue;
    known.add(f.item);
    appendLedger({ via, tool: f.tool || f.item.split(':')[0], item: f.item, kind: 'pre-existing', action: 'found', version: f.version ?? null, how: f.how || null, scope: f.scope || null, undo: null, ok: true }, file);
  }
}
