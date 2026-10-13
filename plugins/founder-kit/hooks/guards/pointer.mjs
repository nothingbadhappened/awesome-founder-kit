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
  const check = config.check || `${config.runner} check`;
  const practice = config.stack && fs.existsSync(path.join(SKILLS, `fk-practice-${config.stack}`)) ?`; stack rules in fk-practice-${config.stack}` : '';
  const role = String(agentType).split(':').pop();
  if (PLANNERS.test(role)) {
    return `fk: Agreed decisions are ADRs in ${adr} (latest wins); constraints in ${constraints}. A new decision needs a new ADR; contradicting an accepted one needs a superseding ADR.`;
  }
  if (REVIEWERS.test(role)) {
    return `fk: Also check conformance with ${adr} and ${standards} (load fk-conformance). Gates: \`${check}\` must be green.`;
  }
  if (BUILDERS.test(role)) {
    return `fk: Follow ${standards}/*${practice}. Gates: \`${check}\` must be green. Do not weaken gate configs (guarded).`;
  }
  return `fk: Agreements: ADRs in ${adr}, constraints in ${constraints}, standards in ${standards}/*${practice}. Gates: \`${check}\`. Reviewers load fk-conformance.`;
}
