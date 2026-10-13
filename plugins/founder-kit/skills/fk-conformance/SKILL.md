---
name: fk-conformance
description: Use when OMC code-reviewer or architect reviews a change or plan, to check it against the project's accepted ADRs and docs/standards and propose missing fitness gates.
---

# Conformance lens

A lens on OMC's review, not an extra review round. Report findings inside the normal review output, each with file:line, the ADR or standard it cites, severity, and a paste-ready fix.

## Read
- `docs/adr/*.md` with status accepted, accepted (founder) or auto-decided (latest wins; skip superseded).
- `docs/standards/*` (architecture, data, process, security, portability, impact-map).
- `docs/00-constraints.md` for red lines.
- The `check` command in the project runner, to see which gates exist.

## Checklist
1. **Contradicts an accepted ADR?** The change does what an ADR rejected, or undoes what it decided. Severity high. Fix: change the code, or write a superseding ADR (founder approval if the original was a founder decision).
2. **Breaks `docs/standards`?** A rule is violated that no gate caught. Severity per the rule's area (security, data, money = high). Fix: comply, and treat the missed catch as a gate candidate (item 4).
3. **New decision without an ADR?** A new dependency, vendor, data store, boundary, protocol, or a reversal of a pattern, with no ADR. Severity medium (high if R3). Fix: name the ADR to write (title, decision, alternatives).
4. **Boundary rule not yet a gate?** An ADR or standard states a boundary, layering, banned dependency or data rule that `<runner> check` does not enforce. Fix: propose the gate (tool, rule, the planted violation that must turn it red) as a separate reviewed task; never weaken an existing gate.
5. **Red line crossed?** Anything against `00-constraints.md`. Severity critical; stop and ask the founder.

## Don't
- Re-review style, tests or correctness; OMC's reviewer already does that.
- Author architecture; propose ADRs, never decide them.
- Mark a finding resolved by editing the ADR or standard in the same change.
