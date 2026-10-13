// C3: tool installs only from the approved toolchain, at exact pinned versions.
import { sanctionedJson, segments, tokens, shellTool } from '../lib.mjs';

export const name = 'install-guard';

const EXACT = /@v?\d+(?:\.\d+)*(?:[-+][\w.]+)?$/;
const VALUE_FLAGS = new Set(['--registry', '--index-url', '-i', '--python', '--source', '-s', '--scope', '--transport', '-t', '-e', '--env', '--header', '-H']);

// Returns { kind, specs } for an install segment, or null.
function parse(tok) {
  const t = tok.map((x) => x.toLowerCase());
  const after = (n) => tok.slice(n);
  const [a, b, c] = t;
  if (['npm', 'pnpm'].includes(a) && ['i', 'install', 'add'].includes(b) && (t.includes('-g') || t.includes('--global'))) return { kind: 'pkg', args: after(2) };
  if (a === 'yarn' && b === 'global' && c === 'add') return { kind: 'pkg', args: after(3) };
  if (['pip', 'pip3'].includes(a) && b === 'install') return { kind: 'pkg', args: after(2) };
  if ((a === 'python' || a === 'python3' || a === 'py') && b === '-m' && c === 'pip' && t[3] === 'install') return { kind: 'pkg', args: after(4) };
  if (a === 'uv' && ((b === 'tool' && c === 'install') || (b === 'pip' && c === 'install'))) return { kind: 'pkg', args: after(3) };
  if (a === 'pipx' && b === 'install') return { kind: 'pkg', args: after(2).slice(0, 1) };
  if (['cargo', 'go'].includes(a) && b === 'install') return { kind: 'pkg', args: after(2) };
  if (['winget', 'brew', 'choco', 'scoop'].includes(a) && ['install', 'add'].includes(b)) return { kind: 'pkg', args: after(2) };
  if (a === 'claude' && b === 'mcp' && c === 'add') return { kind: 'mcp', args: after(3) };
  if (a === 'claude' && b === 'plugin' && (c === 'install' || c === 'i')) return { kind: 'plugin', args: after(3) };
  return null;
}

function specs({ kind, args }) {
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

export function check({ root, tool, ti }) {
  if (!shellTool(tool)) return null;
  const tc = sanctionedJson(root, '.fk/toolchain.json', { approved: [], enforce: true });
  const approved = new Set((tc.approved || []).map((s) => String(s).toLowerCase().replace(/==/, '@')));
  // Log-only until the founder approves a first tool (or sets enforce): the pre-0.4 flow is not jammed.
  const verdict = (reason) => ({ decision: approved.size || tc.enforce ? 'deny' : 'would-deny', reason });
  let matched = null;
  for (const seg of segments(ti.command)) {
    const p = parse(tokens(seg));
    if (!p) continue;
    for (const spec of specs(p)) {
      const s = spec.toLowerCase();
      matched = s;
      const pinned = p.kind !== 'pkg' || (EXACT.test(s) && !/@latest$/.test(s));
      if (!pinned) return verdict(`fk install-guard: "${spec}" is not pinned to an exact version. Use name@1.2.3 (or name==1.2.3). ${ASK('name@1.2.3')}`);
      if (!approved.has(s)) return verdict(`fk install-guard: "${spec}" is not on the approved toolchain. ${ASK(spec)}`);
    }
  }
  return matched ? { decision: 'allow', reason: `approved: ${matched}` } : null;
}
