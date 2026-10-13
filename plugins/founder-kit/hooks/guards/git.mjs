// C5: protect the committed git hooks (B3) and main: no --no-verify, no hooksPath override, no force-push to main.
import { segments, tokens, currentBranch, shellTool } from '../lib.mjs';

export const name = 'git-guard';

const MAIN = /^(?:main|master)$/i;
const ARG_FLAGS = 'mFCctS'; // commit short flags that take a value; the rest of the cluster is that value

function commitNoVerify(args) {
  for (const a of args) {
    if (a === '--no-verify') return true;
    if (/^-[A-Za-z]+$/.test(a)) {
      for (const ch of a.slice(1)) { if (ch === 'n') return true; if (ARG_FLAGS.includes(ch)) break; }
    }
  }
  return false;
}

function forcePushToMain(args, gitDir) {
  const force = args.some((a) => a === '-f' || a.startsWith('--force') || /^-[A-Za-z]*f[A-Za-z]*$/.test(a));
  const refs = args.filter((a) => !a.startsWith('-'));
  if (refs.some((r) => r.startsWith('+') && MAIN.test(r.slice(1).split(':').pop().replace(/^refs\/heads\//, '')))) return true;
  if (!force) return false;
  const targets = refs.slice(1).map((r) => r.replace(/^\+/, '').split(':').pop().replace(/^refs\/heads\//, ''));
  if (!targets.length) targets.push(currentBranch(gitDir) || '');
  return targets.some((t) => MAIN.test(t) || (t === 'HEAD' && MAIN.test(currentBranch(gitDir) || '')));
}

export function check({ tool, ti, gitDir }) {
  if (!shellTool(tool)) return null;
  const deny = (r) => ({ decision: 'deny', reason: `fk git-guard: ${r}` });
  const cmd = String(ti.command || '');
  if (/\$env:GIT_CONFIG_PARAMETERS\s*=/i.test(cmd) || (/GIT_CONFIG_PARAMETERS\s*=/i.test(cmd) && /core\.hookspath/i.test(cmd))) {
    return deny('setting GIT_CONFIG_PARAMETERS can override core.hooksPath and skip the project\'s committed gates. Run git normally.');
  }
  // A nested session (claude -p "fk-approve ...", echo ... | claude, claude <<EOF) would type the founder's lines for them.
  if (/fk-(?:approve|override)/i.test(cmd) && segments(cmd).some((s) => /^(?:\w+=\S*\s+)*(?:npx\s+)?(?:\S*[\\/])?claude(?:\.exe|\.cmd)?(?:\s|$)/i.test(s))) {
    return { ...deny('approvals must be typed by the founder; a nested claude session cannot carry fk-approve/fk-override lines.'), noOverride: true };
  }
  for (const seg of segments(ti.command)) {
    const tok = tokens(seg);
    const g = tok.findIndex((t) => /^git(\.exe)?$/i.test(t));
    if (g < 0) continue;
    let i = g + 1;
    const pre = [];
    while (i < tok.length && tok[i].startsWith('-')) { pre.push(tok[i]); if (tok[i] === '-c' || tok[i] === '-C') pre.push(tok[++i]); i++; }
    if (pre.some((t) => /core\.hookspath/i.test(t))) return deny('overriding core.hooksPath skips the project\'s committed gates. Run git normally.');
    const sub = (tok[i] || '').toLowerCase();
    const args = tok.slice(i + 1);
    if (sub === 'config' && args.some((a) => /core\.hookspath/i.test(a)) && !args.some((a) => a === '--get' || a === '--list' || a === '-l')) {
      return deny('changing core.hooksPath turns off the project\'s committed gates. Only `fk init` / `fk uninstall` set it.');
    }
    if (args.includes('--no-verify') || (sub === 'commit' && commitNoVerify(args))) {
      return deny('skipping verification (--no-verify / -n) bypasses the pre-commit gates. Fix what the gates report, then commit normally.');
    }
    if (sub === 'push' && forcePushToMain(args, gitDir)) {
      return deny('force-pushing to main/master can destroy shared history. Push to a branch and merge instead.');
    }
  }
  return null;
}
