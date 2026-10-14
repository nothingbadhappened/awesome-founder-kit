// Founder directive: fk-approve gates <check|fast_gates|runner> "<new command>" <reason>
// Honoured only when dispatch.mjs saw it as the whole message. Records a one-time approval (with the session it was typed
// in, valid 30 minutes) that lets `fk config set <key>` replace the gate command with exactly that command; the CLI also
// requires the matching typed line in the kit log. Without it, `fk config set` only lets a
// set gate command grow: the old command stays intact as a whole `&&` step and nothing can make a failing step pass.
import { log, readJson, writeJson, stateFile } from '../lib.mjs';

export const GATE_KEYS = ['check', 'fast_gates', 'runner'];
const APPROVAL_MS = 30 * 60 * 1000;
const LINE = /^fk-approve[ \t]+gates[ \t]+(\S+)[ \t]+["“](.+)["”][ \t]+([^"“”]*\S)[ \t]*$/i;
const FORMAT = 'Format: fk-approve gates <check|fast_gates|runner> "<new command>" <reason>. Nothing approved.';

export const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const steps = (s) => norm(s).split('&&').map(norm);
// Things that let a failing gate exit 0 or skip its tests. `||`, `;`, a lone `&` or a new line in an added step
// would also swallow the old command's failure (`npm test && x || true`, `npm test && x; true`).
const SOFTENERS = [
  [/\|\|/, '`||` (runs something else when a step fails)'],
  [/(?:^|[;&|(]\s*|\s)exit\s+0\b/i, '`exit 0`'],
  [/(?:^|\s)--passWithNoTests\b/i, '--passWithNoTests'],
  [/(?:^|\s)--no-verify\b/i, '--no-verify'],
  [/(?:^|\s)--exit-zero\b/i, '--exit-zero'],
  [/(?:^|\s)-Dmaven\.test\.skip\b|(?:^|\s)-DskipTests\b|(?:^|\s)--skip-tests?\b/i, 'a skip-tests flag'],
];
const CONTROL = /;|(?<![&|])&(?!&)|(?<!\|)\|(?!\|)|\n/;

// null when `next` may replace `prev` without the founder; else a plain reason.
// A first set (no old command) is always allowed.
export function softening(prev, next) {
  if (!norm(prev) || norm(prev) === norm(next)) return null;
  for (const [re, what] of SOFTENERS) if (re.test(next)) return `it contains ${what}, which can make a failing gate look green`;
  const old = steps(prev), now = steps(next);
  const at = now.findIndex((_, i) => old.every((s, j) => now[i + j] === s));
  if (at < 0) return `it does not keep "${norm(prev)}" unchanged as a whole step (it may only grow: ${norm(prev)} && <more>)`;
  const added = [...now.slice(0, at), ...now.slice(at + old.length)];
  if (added.some((s) => !s)) return 'it has an empty step';
  const bad = added.find((s) => CONTROL.test(s) && !old.includes(s));
  if (bad) return `the added step "${bad}" uses ; | or & , which can hide the old command's result`;
  return null;
}

const file = (root) => stateFile(root, 'gate-approvals.json');
export const readApprovals = (root) => readJson(file(root), { approvals: [] }).approvals || [];
const writeApprovals = (root, list) => writeJson(file(root), { approvals: list });

// The unexpired, unused approval for exactly this key and command; removed when taken (one use).
export function takeApproval(root, key, command, ok = () => true, now = Date.now()) {
  const list = readApprovals(root).filter((a) => Date.parse(a.expires) > now);
  const i = list.findIndex((a) => a.key === key && norm(a.command) === norm(command) && Date.parse(a.expires) - Date.parse(a.ts) <= APPROVAL_MS && ok(a));
  if (i < 0) { writeApprovals(root, list); return null; }
  const [a] = list.splice(i, 1);
  writeApprovals(root, list);
  return a;
}

export default {
  match: (line) => /^fk-approve[ \t]+gates?\b/i.test(line),
  apply(root, line, notes, session) {
    const m = LINE.exec(line);
    if (!m) return notes.push(`fk: gate approval not understood. ${FORMAT}`);
    const key = m[1].toLowerCase();
    if (!GATE_KEYS.includes(key)) return notes.push(`fk: "${m[1]}" is not a gate command (${GATE_KEYS.join(', ')}). Nothing approved.`);
    const command = norm(m[2]);
    const now = Date.now();
    const a = { key, command, reason: m[3].trim(), session, date: new Date(now).toISOString().slice(0, 10), ts: new Date(now).toISOString(), expires: new Date(now + APPROVAL_MS).toISOString() };
    writeApprovals(root, [...readApprovals(root).filter((x) => Date.parse(x.expires) > now && !(x.key === key && norm(x.command) === command)), a]);
    log(root, { event: 'UserPromptSubmit', guard: 'gate-guard', decision: 'approve-gates', reason: `${key}: ${command} (${a.reason})`, expires: a.expires, session });
    return notes.push(`fk: founder approved changing the ${key} gate to "${command}" (once, within 30 minutes). The agent can now run: fk config set ${key} "${command}". It is in the kit log (fk audit).`);
  },
};
