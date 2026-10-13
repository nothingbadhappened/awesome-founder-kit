// C2: agreed gates cannot be quietly weakened. PreToolUse checks file edits; tamper() checks shell/MCP writes after the fact.
import fs from 'node:fs';
import path from 'node:path';
import { HOOK_OWNED, relPath, protectedClass, gateText, diffSnapshot, writeJson, shellTool, segments } from '../lib.mjs';

export const name = 'gate-guard';

const APPROVAL = 'loosening an agreed gate needs founder approval (the founder types: fk-override gate-guard <reason>)';
const LOOSEN = /\b(?:off|warn|ignored?|ignores|exclude[sd]?|disabled?|skip|allow(?:ed)?|nocheck|noqa|continue-on-error|false)\b|:\s*["']?0["']?\s*,?\s*$|exit\s+0|\|\|\s*true/i;
const STRICTNESS = /strict|noImplicit|lint|\btest|\bcheck\b|audit|scan|fail|coverage|typecheck/i; // \bcheck\b: not "checkout"
// Soft files (tsconfig, CI): inheriting another config or changing when CI runs can drop checks without removing a line.
const SOFT_LOOSEN = /\bextends\b|^on:|workflow_dispatch|branches-ignore|paths-ignore/i;
const HOOK_STATE = /\.fk[\\/](?:overrides|snapshots)\.json|\.fk[\\/]compliance\.jsonl/i;
const FK_JSON = /\.fk[\\/][\w.-]+\.jsonc?\b/i;
// Shell may read .fk JSON (cat/type/Get-Content without a redirect), use git, or go through the fk CLI; nothing else writes it.
const FK_JSON_OK = (seg) => /^(?:cat|type|get-content|gc|git|fk|fk\.cmd)\s|^node\s+\S*fk\.mjs\s/i.test(seg)
  && !/>|\b(?:tee|set-content|out-file|add-content)\b/i.test(seg);

const lines = (t) => String(t || '').split(/\r?\n/).map((l) => l.trim().replace(/,$/, '')).filter(Boolean);

// Lines of `a` that are not in `b` (multiset difference).
function missing(a, b) {
  const pool = new Map();
  for (const l of b) pool.set(l, (pool.get(l) || 0) + 1);
  return a.filter((l) => { const n = pool.get(l) || 0; if (n) pool.set(l, n - 1); return !n; });
}

function applyEdit(old, ti) {
  if (!ti.old_string || !old.includes(ti.old_string)) return null;
  if (ti.replace_all) return old.split(ti.old_string).join(ti.new_string ?? '');
  const i = old.indexOf(ti.old_string);
  return old.slice(0, i) + (ti.new_string ?? '') + old.slice(i + ti.old_string.length);
}

export function judge(cls, rel, oldText, newText) {
  const a = lines(gateText(rel, oldText)), b = lines(gateText(rel, newText));
  if (cls === 'strict') return a.join('\n') === b.join('\n') ? null : 'this file is part of the agreed harness';
  if (cls === 'exceptions') return missing(b, a).length ? 'adding gate exceptions weakens a gate' : null;
  if (cls === 'soft') {
    if (missing(a, b).some((l) => STRICTNESS.test(l))) return 'the change removes a strictness, test or check line';
    return missing(b, a).some((l) => LOOSEN.test(l) || SOFT_LOOSEN.test(l)) ? 'an added line turns a rule off or widens an exception' : null;
  }
  if (missing(a, b).length) return 'the change removes or rewrites existing gate lines';
  if (missing(b, a).some((l) => LOOSEN.test(l))) return 'an added line turns a rule off or widens an exception';
  return null;
}

export function check({ root, tool, ti }) {
  if (shellTool(tool)) {
    const cmd = String(ti.command || '');
    if (HOOK_STATE.test(cmd) && !/^\s*(cat|type|get-content|gc)\b/i.test(cmd)) {
      return { decision: 'deny', reason: 'fk gate-guard: .fk overrides, snapshots and the compliance log are written only by the kit hooks.', noOverride: true };
    }
    if (segments(cmd).some((seg) => FK_JSON.test(seg) && !FK_JSON_OK(seg))) {
      return { decision: 'deny', reason: 'fk gate-guard: .fk/*.json changes only through the founder\'s fk-approve lines or the fk CLI (fk config set). Reading it with cat is fine.' };
    }
    return null;
  }
  if (!['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) return null;
  const rel = relPath(root, ti.file_path || ti.notebook_path || '');
  if (rel && (HOOK_OWNED.has(rel) || rel === '.fk/overrides.json')) {
    return { decision: 'deny', reason: `fk gate-guard: ${rel} is written only by the kit hooks.`, noOverride: true };
  }
  const cls = protectedClass(root, rel);
  if (!cls) return null;
  let old = '';
  try { old = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { /* new file */ }
  let next;
  if (tool === 'Write') next = ti.content;
  else if (tool === 'Edit') next = applyEdit(old, ti);
  else if (tool === 'MultiEdit') next = (ti.edits || []).reduce((t, e) => (t == null ? null : applyEdit(t, e)), old);
  if (next == null && tool !== 'NotebookEdit') return null; // the edit cannot apply; the tool will fail on its own
  const why = tool === 'NotebookEdit' ? 'notebook edits to gate files are not checked' : judge(cls, rel, old, next);
  return why ? { decision: 'deny', reason: `fk gate-guard: ${rel}: ${why}. ${APPROVAL}.` }
    : { decision: 'allow', reason: `${rel}: no gate loosened` };
}

// PostToolUse on Bash/PowerShell/MCP: compare protected files with the snapshot.
export function tamper(root, overridden) {
  const { snap, now, changed } = diffSnapshot(root);
  if (!changed.length) return null;
  if (changed.includes('.fk/overrides.json')) overridden = false; // a forged override is not an override
  const key = changed.map((r) => `${r}:${now[r] ?? '-'}`).join('|');
  if (overridden || snap.reported === key) {
    writeJson(path.join(root, '.fk', 'snapshots.json'), overridden ? { files: now, reported: null } : snap);
    return { decision: overridden ? 'allow-override' : 'tamper-repeat', changed };
  }
  writeJson(path.join(root, '.fk', 'snapshots.json'), { ...snap, reported: key });
  if (changed.includes('.fk/overrides.json')) { try { fs.rmSync(path.join(root, '.fk', 'overrides.json')); } catch { /* gone */ } }
  return {
    decision: 'block', changed,
    reason: `fk gate-guard: that command changed agreed gate files without founder approval: ${changed.join(', ')}. ` +
      `Revert them (for example git checkout -- <file>), or ${APPROVAL}.`,
  };
}
