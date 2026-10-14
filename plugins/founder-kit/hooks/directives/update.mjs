// Founder directive: fk-approve update <version> <reason>
// Honoured only when dispatch.mjs saw it as the whole message. Lets `fk update --yes` from an agent shell update the
// installed kit to exactly that version, once, within 30 minutes (the CLI also requires the matching typed line in the
// kit log). Without it, an agent shell only gets the plan and the line for the founder to type.
import { log, readJson, writeJson, stateFile, readLog, fromKit } from '../lib.mjs';

const APPROVAL_MS = 30 * 60 * 1000;
const LINE = /^fk-approve[ \t]+update[ \t]+v?(\d+\.\d+\.\d+)[ \t]+(\S.*)$/i;
const file = (root) => stateFile(root, 'update-approvals.json');
const read = (root) => readJson(file(root), { approvals: [] }).approvals || [];

// The unexpired, unused, founder-typed approval for exactly this version; removed when taken (one use).
export function takeUpdateApproval(root, version, now = Date.now()) {
  const typed = readLog(root).filter((r) => r.event === 'UserPromptSubmit' && r.decision === 'approve-update' && fromKit(r));
  const list = read(root).filter((a) => Date.parse(a.expires) > now);
  const i = list.findIndex((a) => a.version === version && Date.parse(a.expires) - Date.parse(a.ts) <= APPROVAL_MS
    && typed.some((r) => r.expires === a.expires && r.session === a.session && r.version === a.version));
  const [a] = i < 0 ? [null] : list.splice(i, 1);
  writeJson(file(root), { approvals: list });
  return a;
}

export default {
  match: (line) => /^fk-approve[ \t]+update\b/i.test(line),
  apply(root, line, notes, session) {
    const m = LINE.exec(line);
    if (!m) return notes.push('fk: update approval not understood. Format: fk-approve update <version> <reason>. Nothing approved.');
    const now = Date.now();
    const a = { version: m[1], reason: m[2].trim(), session, ts: new Date(now).toISOString(), expires: new Date(now + APPROVAL_MS).toISOString() };
    writeJson(file(root), { approvals: [...read(root).filter((x) => Date.parse(x.expires) > now && x.version !== a.version), a] });
    log(root, { event: 'UserPromptSubmit', guard: 'fk', decision: 'approve-update', version: a.version, reason: a.reason, expires: a.expires, session });
    return notes.push(`fk: founder approved updating the kit to ${a.version} (once, within 30 minutes). The agent can now run: fk update --yes. It is in the kit log (fk audit).`);
  },
};
