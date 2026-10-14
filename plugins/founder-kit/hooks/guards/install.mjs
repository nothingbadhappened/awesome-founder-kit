// C3: tool installs only from the approved toolchain, at exact pinned versions.
import fs from 'node:fs';
import path from 'node:path';
import { sanctionedJson, segments, tokens, shellTool } from '../lib.mjs';

export const name = 'install-guard';

const EXACT = /@v?\d+(?:\.\d+)*(?:[-+][\w.]+)?$/;
const PIP_GLOBAL = new Set(['--user', '--break-system-packages', '--system']);
const VALUE_FLAGS = new Set(['--registry', '--index-url', '-i', '--python', '--source', '-s', '--scope', '--transport', '-t', '-e', '--env', '--header', '-H']);

// Returns { kind, specs } for an install segment, or null.
export function parse(tok) {
  const t = tok.map((x) => x.toLowerCase());
  const after = (n) => tok.slice(n);
  const [a, b, c] = t;
  if (['npm', 'pnpm'].includes(a) && ['i', 'install', 'add'].includes(b) && (t.includes('-g') || t.includes('--global'))) return { kind: 'pkg', args: after(2) };
  if (a === 'yarn' && b === 'global' && c === 'add') return { kind: 'pkg', args: after(3) };
  // pip/uv pip install into the project's environment is a library install, not a tool: only --user/system installs count.
  const sys = t.some((x) => PIP_GLOBAL.has(x));
  if (['pip', 'pip3'].includes(a) && b === 'install') return sys ? { kind: 'pkg', args: after(2) } : null;
  if ((a === 'python' || a === 'python3' || a === 'py') && b === '-m' && c === 'pip' && t[3] === 'install') return sys ? { kind: 'pkg', args: after(4) } : null;
  if (a === 'uv' && b === 'pip' && c === 'install') return sys ? { kind: 'pkg', args: after(3) } : null;
  if (a === 'uv' && b === 'tool' && c === 'install') return { kind: 'pkg', args: after(3) };
  if (a === 'pipx' && b === 'install') return { kind: 'pkg', args: after(2).slice(0, 1) };
  if (['cargo', 'go'].includes(a) && b === 'install') return { kind: 'pkg', args: after(2) };
  // mise: a project pin (`mise use node@22`, `mise install`) is project config; only the user-wide -g/--global is a tool install.
  if (a === 'mise' && b === 'use' && (t.includes('-g') || t.includes('--global'))) return { kind: 'pkg', args: after(2) };
  if (['winget', 'brew', 'choco', 'scoop'].includes(a) && ['install', 'add'].includes(b)) return { kind: 'pkg', args: after(2), mgr: a };
  if (a === 'claude' && b === 'mcp' && c === 'add') return { kind: 'mcp', args: after(3) };
  if (a === 'claude' && b === 'plugin' && (c === 'install' || c === 'i')) return { kind: 'plugin', args: after(3) };
  return null;
}

export function specs({ kind, args }) {
  const out = [];
  let version = null;
  for (let i = 0; i < args.length; i++) {
    const x = args[i];
    if (x === '--') break;
    if (x.startsWith('-')) {
      if (x === '-r' || x === '--requirement') return []; // project requirements file, not a tool
      if (x === '--id') out.push(args[++i]);
      else if (x === '--version') version = args[++i];
      else if (VALUE_FLAGS.has(x)) i++;
      continue;
    }
    if (x === '.' || x.startsWith('./') || x.startsWith('../')) continue;
    out.push(x);
    if (kind === 'mcp') break; // the server name; the rest is its command line
  }
  return out.map((s) => {
    let spec = s.replace(/==/, '@');
    if (version && !EXACT.test(spec)) spec += '@' + version;
    return kind === 'pkg' ? spec : `${kind}:${spec}`;
  });
}

// What the founder types to approve a tool; the agent asks first (AskUserQuestion, plain words).
const ASK = (spec) => `Ask the founder in plain words (AskUserQuestion) whether to approve it. If yes, the founder types: fk-approve tool ${spec} <reason>`;

// M1: piped installers and ephemeral runners (npx, uvx, docker run, ...) fetch and run code without an install step.
const PIPED = /\b(curl|wget|irm|iwr|Invoke-(RestMethod|WebRequest))\b[^|]*\|\s*(sh|bash|zsh|iex|pwsh|powershell)\b/i;
const RUN_VALUE = new Set(['-p', '--package', '--from', '--spec', '--with', '--python', '-e', '--env', '-v', '--volume', '-w', '--workdir',
  '-u', '--user', '--name', '--network', '--entrypoint', '--mount', '-l', '--label', '--env-file', '--platform', '-h', '--hostname',
  '-m', '--memory', '--cpus', '--device', '--add-host', '--restart', '--pull', '--gpus', '--cap-add', '--cap-drop', '--security-opt', '--publish']);
function runner(tok) {
  const t = tok.map((x) => x.toLowerCase());
  const n = ['npx', 'bunx', 'uvx'].includes(t[0]) ? 1 : (t[0] === 'pipx' && t[1] === 'run') || (['docker', 'podman'].includes(t[0]) && t[1] === 'run') ? 2 : 0;
  if (!n) return null;
  if (t.includes('--no-install')) return { local: true };
  const image = n === 2 && t[0] !== 'pipx';
  let spec = null;
  for (let i = n; i < tok.length && !spec; i++) {
    if (!image && ['-p', '--package', '--from', '--spec'].includes(t[i])) spec = tok[++i];
    else if (RUN_VALUE.has(t[i]) || (image && t[i] === '-p')) i++;
    else if (!t[i].startsWith('-')) spec = tok[i];
  }
  if (!spec) return null;
  spec = spec.replace(/==/, '@');
  if (image) spec = spec.replace(/:([^/:@]+)$/, '@$1'); // node:22 -> node@22, the fk-approve tool format
  return { spec, name: spec.replace(/(.)@.*$/, '$1'), npx: ['npx', 'bunx'].includes(t[0]) };
}
const hasLocalBin = (dirs, name) => dirs.some((d) => d && ['', '.cmd'].some((x) => fs.existsSync(path.join(d, 'node_modules', '.bin', name + x))));

export function check({ root, tool, ti, input }) {
  if (!shellTool(tool)) return null;
  const tc = sanctionedJson(root, '.fk/toolchain.json', { approved: [], enforce: true });
  const approved = new Set((tc.approved || []).map((s) => String(s).toLowerCase().replace(/==/, '@')));
  const names = new Set([...approved].map((s) => s.replace(/(.)@.*$/, '$1')));
  // Log-only until the founder approves a first tool (or sets enforce): the pre-0.4 flow is not jammed.
  const on = approved.size || tc.enforce;
  const verdict = (reason) => ({ decision: on ? 'deny' : 'would-deny', reason });
  const ask = (reason) => ({ decision: on ? 'ask' : 'would-ask', reason });
  // An ask never hides a deny later in the same command.
  let asked = PIPED.test(String(ti.command || '')) ? 'fk install-guard: this downloads a script from the internet and runs it straight away, unchecked. Allow it only if you trust the source.' : null;
  let matched = null;
  for (const seg of segments(ti.command)) {
    const tok = tokens(seg);
    const r = runner(tok);
    if (r && !r.local) {
      const s = r.spec.toLowerCase();
      if (approved.has(s) || (s === r.name.toLowerCase() && names.has(s))) { matched = s; continue; }
      if (r.npx && s === r.name.toLowerCase() && hasLocalBin([root, input?.cwd], r.name)) continue; // the project's own dev tool
      asked ??= `fk install-guard: "${r.spec}" is downloaded and run on the spot; it is not on the approved toolchain. ${ASK(r.spec)}`;
      continue;
    }
    const p = parse(tok);
    if (!p) continue;
    for (const spec of specs(p)) {
      const s = spec.toLowerCase();
      matched = s;
      if (p.mgr) { // system package managers have no version pins: approved by name (brew:<name>, or the plain name)
        const n = s.replace(/(.)@.*$/, '$1');
        if (approved.has(s) || approved.has(`${p.mgr}:${n}`) || names.has(n)) continue;
        return verdict(`fk install-guard: "${spec}" (${p.mgr}) is not on the approved toolchain. ${ASK(`${p.mgr}:${n}`)}`);
      }
      const pinned = p.kind !== 'pkg' || (EXACT.test(s) && !/@latest$/.test(s));
      if (!pinned) return verdict(`fk install-guard: "${spec}" is not pinned to an exact version. Use name@1.2.3 (or name==1.2.3). ${ASK('name@1.2.3')}`);
      if (!approved.has(s)) return verdict(`fk install-guard: "${spec}" is not on the approved toolchain. ${ASK(spec)}`);
    }
  }
  if (asked) return ask(asked);
  return matched ? { decision: 'allow', reason: `approved: ${matched}` } : null;
}
