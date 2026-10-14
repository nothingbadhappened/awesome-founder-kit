// Founder directive: fk-approve proposal <id> [without <name,...>]
// Honoured only when dispatch.mjs saw it as the whole message. Approves the rendered proposal exactly as the founder saw it:
// the proposal's hash must equal the hash recorded at `fk scout render`. Writes .fk/toolchain.json through the sanctioned path.
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../lib.mjs';
import { rel, load, save, fileHash, specsFor, today, ID } from '../../bin/cmd/scout/lib.mjs';

const LINE = /^fk-approve[ \t]+proposal[ \t]+(\S+)(?:[ \t]+without[ \t]+(\S.*?))?[ \t]*$/i;
const FORMAT = 'Format: fk-approve proposal <id> [without <name,name>]. Nothing approved.';

function adrNote(root, p, chosen, without, hash) {
  const file = path.join(root, 'docs', 'process', `toolchain-approval-${p.id}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [`# Toolchain approval ${p.id}`, '', `Date: ${today()}`, 'Status: accepted (founder)', `Proposal hash: ${hash}`, '',
    '## Decision', '', `The founder approved the${p.delta ? ' additional' : ''} toolchain shown in docs/process/toolchain-proposal.md.`, '',
    ...chosen.map((e) => `- ${e.name}${e.version ? ' ' + e.version : ''} (${e.kind}): ${e.why}`), ''];
  if (without.length) lines.push('## Left out by the founder', '', ...without.map((n) => `- ${n}`), '');
  const rejected = p.rejected || [];
  if (rejected.length) lines.push('## Alternatives considered', '', ...rejected.map((r) => `- ${r.name}: ${r.why}`), '');
  lines.push('## Consequences', '', 'Install-guard allows exactly these tools at these versions. Anything new needs a delta proposal.', '');
  fs.writeFileSync(file, lines.join('\n'));
  return path.relative(root, file).split(path.sep).join('/');
}

export default {
  match: (line) => /^fk-approve[ \t]+proposal\b/i.test(line),
  apply(root, line, notes, session) {
    const m = LINE.exec(line);
    if (!m || !ID.test(m[1])) return notes.push(`fk: proposal line not understood. ${FORMAT}`);
    const id = m[1];
    const why = (text, decision) => {
      log(root, { event: 'UserPromptSubmit', guard: 'install-guard', decision, reason: `proposal ${id}` });
      return notes.push(`fk: ${text} Nothing approved.`);
    };
    if (fs.existsSync(path.join(root, rel.approval(id)))) return why(`proposal ${id} is already approved.`, 'proposal-repeat');
    const render = load(root, rel.render(id));
    if (!render) return why(`proposal ${id} has not been shown to you yet (the agent runs: fk scout render ${id}).`, 'proposal-unrendered');
    const hash = fileHash(root, rel.proposal(id));
    if (!hash || hash !== render.hash) return why(`proposal ${id} changed after it was shown to you. Ask the agent to render it again and re-read the page.`, 'proposal-hash-mismatch');
    const p = load(root, rel.proposal(id));
    if (!p) return why(`proposal ${id} was changed outside the kit.`, 'proposal-tampered');
    const without = (m[2] || '').split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    const names = new Set(p.entries.map((e) => e.name.toLowerCase()));
    const unknown = without.filter((n) => !names.has(n.toLowerCase()));
    if (unknown.length) return why(`"${unknown.join(', ')}" is not in proposal ${id} (items: ${[...names].join(', ')}).`, 'proposal-unknown-item');
    const drop = new Set(without.map((n) => n.toLowerCase()));
    const chosen = p.entries.filter((e) => !drop.has(e.name.toLowerCase()));

    const tc = load(root, rel.toolchain, { approved: [] });
    tc.approved = [...new Set([...(tc.approved || []), ...chosen.flatMap(specsFor)])];
    const keep = (tc.entries || []).filter((x) => !chosen.some((e) => e.name === x.name));
    tc.entries = [...keep, ...chosen.map((e) => ({ name: e.name, kind: e.kind, version: e.version ?? null, specs: specsFor(e), proposal: id, approved: today() }))];
    save(root, rel.toolchain, tc);
    save(root, rel.approval(id), { id, hash, approved: chosen.map((e) => e.name), without, date: new Date().toISOString() });
    const note = adrNote(root, p, chosen, without, hash);
    log(root, { event: 'UserPromptSubmit', guard: 'install-guard', decision: 'approve-proposal', reason: `${id}: ${chosen.length} items${without.length ? `, without ${without.join(', ')}` : ''}`, session });
    return notes.push(`fk: founder approved toolchain proposal ${id}: ${chosen.map((e) => e.name).join(', ') || 'nothing'}`
      + `${without.length ? ` (left out: ${without.join(', ')})` : ''}. Install-guard now allows exactly these. `
      + `Next: run \`fk provision ${id}\`, then turn ${note} into an ADR.`);
  },
};
