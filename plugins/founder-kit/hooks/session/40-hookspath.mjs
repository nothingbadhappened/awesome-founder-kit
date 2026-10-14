// SessionStart note: the committed pre-commit checks (.githooks/pre-commit) are not wired up in this clone.
// One git process; startup/clear only.
import { hooksPathStatus } from '../lib.mjs';

export default function hooksPathNote({ root }) {
  const s = hooksPathStatus(root);
  if (!s || s.on) return undefined;
  if (!s.hp) return 'fk: pre-commit checks are off in this clone (git core.hooksPath is not .githooks); run fk init to restore.';
  return `fk: pre-commit checks are off in this clone: git runs hooks from ${s.hp}, not .githooks. Ask the founder (AskUserQuestion) whether to run \`fk init --chain\`, which adds the kit's pre-commit call to ${s.hp}/pre-commit.`;
}
