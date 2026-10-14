## Definition of done

OMC's verifier checks these with evidence (output, link, path) in the task file. R0: fast lane only.

- [ ] No `GATE-MISSING` for code that gate covers.
- [ ] Each acceptance criterion has a passing test.
- [ ] `<runner> check` green (paste summary).
- [ ] `<runner> e2e` green if APIs/flows/UI touched; a new user flow has one end-to-end run of the whole flow.
- [ ] `<runner> eval` no regression if AI pipeline touched (or `GATE-BLOCKED: eval` handed to founder).
- [ ] UI: design-skill audit passed.
- [ ] Impact-map rules and callers/callees (code-graph or Grep) acknowledged; `<runner> impact` green once it exists.
- [ ] Every new or changed gate proven red non-interactively, with the exact failure message quoted.
- [ ] No gate relaxed without a `founder YYYY-MM-DD` approval line and expiry.
- [ ] Blast-radius table complete, breaking rows have migration path, rollback filled.
- [ ] User-linked store/event/adapter added or changed (any risk class): inventory updated, erasure and export tests green.
- [ ] New behavior behind a flag (off in prod), both states tested.
- [ ] New job/route/adapter: metrics, alert, runbook line.
- [ ] No TODO/FIXME/.skip/.only/stubs/commented-out code; leftovers listed as blockers.
- [ ] Threat model (R2/R3 or entry points) with a passing negative test per threat.
- [ ] Reviews for the risk class done; critical/high/medium resolved; `Review status: reviewed`.
- [ ] `<runner> setup && <runner> up` works from a clean clone.
- [ ] `<runner> sweep` list empty; nothing left running.
- [ ] Docs, ADRs, module READMEs updated.
- [ ] `fk task done <id>` passed (or the founder typed an override).
- [ ] Slice committed; journal entry appended; lessons appended or `seen:` incremented.
