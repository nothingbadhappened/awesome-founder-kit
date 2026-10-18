## Definition of done

OMC's verifier checks these with evidence (output, link, path) in the task file. R0: fast lane only.

- [ ] No `GATE-MISSING` for code that gate covers.
- [ ] Each acceptance criterion has a passing test.
- [ ] The check command (`{{check}}`) green (paste summary).
- [ ] The end-to-end tests green if APIs/flows/UI touched; a new user flow has one end-to-end run of the whole flow.
- [ ] The AI eval shows no regression if AI pipeline touched (or `GATE-BLOCKED: eval` handed to founder).
- [ ] UI: design-skill audit passed.
- [ ] Impact-map rules and callers/callees (code-graph or Grep) acknowledged; the impact check green once it exists.
- [ ] Every new or changed gate proven red non-interactively, with the exact failure message quoted.
- [ ] No gate relaxed without a `founder YYYY-MM-DD` approval line and expiry.
- [ ] Blast-radius table complete, breaking rows have migration path, rollback filled.
- [ ] User-linked store/event/adapter added or changed (any risk class): inventory updated, erasure and export tests green.
- [ ] New behavior behind a flag (off in prod), both states tested.
- [ ] New job/route/adapter: metrics, alert, runbook line.
- [ ] No TODO/FIXME/.skip/.only/stubs/commented-out code; leftovers listed as blockers.
- [ ] Threat model (R2/R3 or entry points) with a passing negative test per threat.
- [ ] Reviews for the risk class done; critical/high/medium resolved; `Review status: reviewed`.
- [ ] The setup command (`{{setup}}`), then starting the local stack, works from a clean clone.
- [ ] `fk portability check`: no new warning (runtimes pinned, services reachable from a fresh clone, no machine paths).
- [ ] `fk sweep` list empty; nothing left running.
- [ ] Docs, ADRs, module READMEs updated.
- [ ] `fk task done <id>` passed (or the founder typed an override).
- [ ] Slice committed; journal entry appended; lessons appended or `seen:` incremented.
