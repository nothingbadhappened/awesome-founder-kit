// Founder directive: fk-approve baseline <reason>
// Honoured only when dispatch.mjs saw it as the whole message. Lets `fk baseline record` replace an existing baseline
// once, within 30 minutes (the CLI also requires the matching typed line in the kit log). Without it, a recorded
// baseline only moves toward better (`fk baseline check` tightens it); re-recording could accept new problems as old.
import { log, readJson, writeJson, stateFile, readLog, fromKit } from '../lib.mjs';

const APPROVAL_MS = 30 * 60 * 1000;
const LINE = /^fk-approve[ \t]+baseline[ \t]+(\S.*)$/i;
const file = (root) => stateFile(root, 'baseline-approvals.json');
const read = (root) => readJson(file(root), { approvals: [] }).approvals || [];

// The unexpired, unused, founder-typed approval; removed when taken (one use).
export function takeBaselineApproval(root, now = Date.now()) {
  const typed = readLog(root).filter((r) => r.event === 'UserPromptSubmit' && r.decision === 'approve-baseline' && fromKit(r));
  const list = read(root).filter((a) => Date.parse(a.expires) > now);
  const i = list.findIndex((a) => Date.parse(a.expires) - Date.parse(a.ts) <= APPROVAL_MS && typed.some((r) => r.expires === a.expires && r.session === a.session));
  const [a] = i < 0 ? [null] : list.splice(i, 1);
  writeJson(file(root), { approvals: list });
  return a;
}

export default {
  match: (line) => /^fk-approve[ \t]+baseline\b/i.test(line),
  apply(root, line, notes, session) {
    const m = LINE.exec(line);
    if (!m) return notes.push('fk: baseline approval not understood. Format: fk-approve baseline <reason>. Nothing approved.');
    const now = Date.now();
    const a = { reason: m[1].trim(), session, ts: new Date(now).toISOString(), expires: new Date(now + APPROVAL_MS).toISOString() };
    writeJson(file(root), { approvals: [...read(root).filter((x) => Date.parse(x.expires) > now), a] });
    log(root, { event: 'UserPromptSubmit', guard: 'gate-guard', decision: 'approve-baseline', reason: a.reason, expires: a.expires, session });
    return notes.push('fk: founder approved recording the baseline again (once, within 30 minutes). The agent can now run: fk baseline record. It is in the kit log (fk audit).');
  },
};
