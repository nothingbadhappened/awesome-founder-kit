// Founder directive: fk-approve rounds <n|off>
// Honoured only when dispatch.mjs saw it as the whole message. Sets how many generate/render calls the iteration-guard
// allows between founder check-ins (.fk/iteration.json; default 3). `off` turns the guard off for this project.
import path from 'node:path';
import { log, refreshSnapshot, sanctionedJson, writeJson } from '../lib.mjs';

const LINE = /^fk-approve[ \t]+rounds[ \t]+(\d{1,3}|off)[ \t]*$/i;

export default {
  match: (line) => /^fk-approve[ \t]+rounds\b/i.test(line),
  apply(root, line, notes, session) {
    const m = LINE.exec(line);
    const off = m?.[1].toLowerCase() === 'off';
    const n = off ? 0 : Number(m?.[1]);
    if (!m || (!off && n < 1)) return notes.push('fk: rounds line not understood. Format: fk-approve rounds <1-999|off>. Nothing recorded.');
    const cfg = sanctionedJson(root, '.fk/iteration.json', {});
    writeJson(path.join(root, '.fk', 'iteration.json'), { ...cfg, limit: n, approved: new Date().toISOString().slice(0, 10), by: 'founder-prompt', session });
    refreshSnapshot(root, ['.fk/iteration.json']);
    log(root, { event: 'UserPromptSubmit', guard: 'iteration-guard', decision: 'approve-rounds', reason: n ? `${n} producing calls per check-in` : 'off', session });
    return notes.push(n ? `fk: founder set the limit to ${n} generate/render calls between check-ins (.fk/iteration.json).`
      : 'fk: founder turned the iteration-guard off for this project (.fk/iteration.json).');
  },
};
