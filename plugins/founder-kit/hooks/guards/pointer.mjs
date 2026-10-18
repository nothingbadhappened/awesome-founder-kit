// A1/A2: a short, role-aware pointer to the project's agreements (at most ~100 tokens).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills');
const PLANNERS = /planner|architect|analyst/i;
const BUILDERS = /executor|debugger|test-engineer/i;
const REVIEWERS = /code-reviewer|security-reviewer|critic|verifier/i;

export function pointer(config, agentType = '') {
  const { adr, constraints, standards } = config.paths;
  const check = config.check; // the gate fk task check runs; a runner alone is not one (baseline.mjs configuredGates)
  const gates = check ?`Gates: \`${check}\` must be green.` : 'No check command agreed yet: find the one the project uses, or ask the founder; never assume one.';
  const practice = config.stack && fs.existsSync(path.join(SKILLS, `fk-practice-${config.stack}`)) ?`; stack rules in fk-practice-${config.stack}` : '';
  const role = String(agentType).split(':').pop();
  if (PLANNERS.test(role)) {
    return `fk: Agreed decisions are ADRs in ${adr} (latest wins); business rules (BR-n) in ${constraints}. A new decision needs a new ADR; contradicting an accepted one needs a superseding ADR.`;
  }
  if (REVIEWERS.test(role)) {
    return `fk: Answer every business rule (BR-n) in ${constraints}; check conformance with ${adr} and ${standards} (load fk-conformance). ${gates}`;
  }
  if (BUILDERS.test(role)) {
    return `fk: Keep every business rule (BR-n) in ${constraints}; follow ${standards}/*${practice}. ${gates} Do not weaken gate configs (guarded).`;
  }
  return `fk: Agreements: business rules (BR-n) in ${constraints}, ADRs in ${adr}, standards in ${standards}/*${practice}. ${gates} Reviewers load fk-conformance.`;
}
