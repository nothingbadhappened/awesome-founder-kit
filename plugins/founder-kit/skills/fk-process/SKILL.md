---
name: fk-process
description: Use after fk-kickoff, or to retrofit an existing repo, to write the project's standards into drydock's docs/standards/ and generate a thin `<project>-dev` skill over the OMC workflow.
---

# Project Dev Process (generator)

OMC owns the workflow (plan, execute, verify, review). This generator writes only what OMC lacks: the project's agreed standards, risk classes, gate rules and autonomy limits. Templates live in `templates/` next to this file (resolve the path relative to this file; the plugin may be in a cache).

Read first: `docs/00-constraints.md`, `docs/02-architecture.md`, `docs/adr/*`, `docs/01-business-review.md`, existing `docs/standards/*`.

1. **Slots:** drydock's `docs/standards/` and `docs/adr/` must exist; missing → run `oh-my-claudecode:drydock` first. Never create a second layout; merge into drydock's seeded files and keep their content.
2. **Facts:** extract the project facts (reference.md §Facts). Ask the founder (AskUserQuestion) only where the docs are silent and the answer changes the process.
3. **Scale to project shape** (from `00-constraints.md`): reference.md §Scaling. Log every dropped safety rule in the generated skill's changelog with its reason.
4. **Instantiate templates:** map in reference.md §Templates. Delete non-applicable sections, but never a safety section without a changelog reason.
5. **Fill placeholders** in every written file: reference.md §Placeholders. Finish by searching `{{`, `{{/if` and `<runner>`: zero hits, or generation is not done.
6. **Risk classes:** map R3 to the project's real dangers (personal data, money, kids, medical claims, irreversible actions…). Unsure → round up. Keep the review-agent column of the template table.
7. **Fitness gates:** turn each boundary, layering, banned-dependency and data rule in the ADRs and architecture doc into a check run by `<runner> check` (tool chosen per stack). A rule with no gate yet → `GATE-MISSING: <rule>` in the bootstrap task.
8. **Impact map:** add a rule for each coupling code analysis can't see (legal texts, store listings, pricing pages, design tokens, ML baselines, API clients of shipped apps).
9. **Wire in:** append to `CLAUDE.md` (never remove content; stay within 40 lines): "Any change follows `<project>-dev`; agreements live in `docs/adr/` and `docs/standards/`; reviewers load `fk-conformance`; lessons in `docs/process/lessons.md`."
   Then record the real commands for the kit hooks: `fk config set runner "<runner>"`, `fk config set check "<full check command>"`, `fk config set fast_gates "<fast pre-commit gates>"` (and `stack`).
10. **Validate:** frontmatter has `name` and `description` (≤ 200 chars); `SKILL.md` ≤ 350 words; the skill appears in the skills list after reload.
11. **Independent review:** `oh-my-claudecode:critic` reviews the generated skill and standards against the architecture, returning critical/major/minor findings with paste-ready fixes; apply them. Then `oh-my-claudecode:verifier` checks cross-references and consistency. Journal both (`fk-journal`).
12. **First task:** the bootstrap task: repo skeleton + the gates themselves, each proven red once on a planted violation.
