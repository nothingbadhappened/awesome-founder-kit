---
name: fk-conformance
description: "Use when OMC reviewers check a change or plan: compare it with accepted ADRs and docs/standards; propose missing fitness gates."
---

# Conformance lens

A lens on OMC's review, not an extra review round. Report findings inside the normal review output, each with file:line, the ADR or standard it cites, severity, and a paste-ready fix.

## Read
Accepted ADRs in `docs/adr/` (which statuses count: reference.md §Read), `docs/standards/*`, the business rules (`BR-n`) in `docs/00-constraints.md`, and the project's check command (`check` in `.fk/config.json`: the gates that exist).

## Checklist
1. **Contradicts an accepted ADR?** It does what an ADR rejected, or undoes what it decided. Severity high. Fix: change the code, or a superseding ADR (founder approval if the original was a founder decision).
2. **Breaks `docs/standards`?** A rule no gate caught. Severity per area (security, data, money = high). Fix: comply; the missed catch is a gate candidate (item 4).
3. **New decision without an ADR?** A new dependency, vendor, data store, boundary, protocol, or a reversed pattern. Severity medium (high if R3). Fix: name the ADR to write (title, decision, alternatives).
4. **Rule not yet a gate?** An ADR, standard or BR-n states a boundary, layering, banned dependency or data rule the project's check command does not enforce. Fix: propose the gate (tool, rule, the planted violation that turns it red) as a separate reviewed task; never weaken a gate.
5. **Bible behind?** An accepted ADR's `bible:` sections of `docs/PROJECT.md` (index mode: the linked source doc) not updated in the same task (`fk bible check` lists them). Severity medium. Fix: update them, then `fk bible touch <section>`.
6. **Portable?** No machine-specific paths or tools; a new tool or service is pinned and declared the way this project already pins and declares them (`fk portability check`). Severity medium.
7. **A doc contradicts an accepted ADR or standard?** New or edited docs and agent rule files must not (`fk knowledge check` flags likely contradictions; it may miss differently-worded ones). Severity medium. Fix: correct the doc, or a superseding ADR.
8. **Business rule broken?** Answer every active `BR-n` in `00-constraints.md` (not `(retired)` or `(draft)`) for this change, one line each in the verdict: `BR-n: OK|VIOLATION — <evidence>`. A VIOLATION is critical: verdict REVISE, and anything that needs the rule itself changed goes to the founder. A rule the change cannot touch is `OK — not touched`.

## Verdict file (tasks with `docs/tasks/<id>.md`)
Save `docs/tasks/<id>.review-<n>.md` (next free n) yourself with one shell command; reviewer agents have no Write tool. Never hand the text to the main session: a review it writes does not count. Right before writing it, run `fk task stamp <id>` and copy its `Reviewed:` line in: a review of an older version of the change does not count.
```bash
cat > docs/tasks/<id>.review-<n>.md <<'EOF'
Reviewed: <stamp from fk task stamp <id>>
Round: 1
AC-1: PASS — <evidence: test name, output line, file:line>
AC-2: FAIL — <what is missing>
BR-1: OK — <evidence, or "not touched">
Verdict: ACCEPT | REVISE
EOF
```
PowerShell: reference.md §PowerShell.
R1 needs only the `Verdict:` line; from R2 every AC needs a line, a PASS needs evidence, and each ADR in the task's `Context:` line needs `ADR-NNNN: OK|VIOLATION — <note>` and every active BR-n needs a line. A `BR-n: VIOLATION` fails `fk task check` from R1 until a later review answers that rule OK; an ADR VIOLATION from R2. Only a reviewer agent that wrote no code for the task before its review counts (`fk task check <id>`). After fixes: next n; a second round: `Round: 2`.

## Don't
- Re-review style, tests or correctness; OMC's reviewer already does that.
- Author architecture; propose ADRs, never decide them.
- Mark a finding resolved by editing the ADR or standard in the same change.
