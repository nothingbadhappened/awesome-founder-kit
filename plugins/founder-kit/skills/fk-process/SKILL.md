---
name: fk-process
description: "Use after fk-kickoff or to retrofit a repo: write docs/standards/ and generate a thin <project>-dev skill over OMC's workflow."
---

# Project Dev Process (generator)

OMC owns the workflow (plan, execute, verify, review). This generator writes only what OMC lacks: agreed standards, risk classes, gate rules and autonomy limits. Templates: `templates/` next to this file (the plugin may be in a cache).

Read first: `docs/00-constraints.md`, `docs/02-architecture.md`, `docs/adr/*`, `docs/01-business-review.md`, existing `docs/standards/*`.

1. **Slots:** drydock's `docs/standards/` and `docs/adr/` must exist; missing → run `oh-my-claudecode:drydock` first. Merge into its seeded files; never a second layout.
2. **Facts:** extract the project facts (reference.md §Facts). Ask the founder (AskUserQuestion) only where the docs are silent and the answer changes the process.
3. **Scale to project shape** (`00-constraints.md`): reference.md §Scaling. Log each dropped safety rule, with its reason, in the skill's changelog.
4. **Instantiate templates:** map in reference.md §Templates. Delete non-applicable sections, but never a safety section without a changelog reason.
5. **Fill placeholders** in every written file: reference.md §Placeholders. Finish by searching `{{`, `{{/if` and `<runner>`: zero hits, or generation is not done.
6. **Risk classes:** map R3 to the project's real dangers (personal data, money, kids, medical claims, irreversible actions…). Unsure → round up. Keep the review-agent column. Add each R3 path: `fk config set risk_r3 "<glob>"`.
7. **Fitness gates:** fill each accepted ADR's `applies_to:`, `bible:` and `fit:` (template `adr.md`, reference.md §ADRs). Project-wide decisions leave applies_to empty (the pointer already covers them); list only the folders this decision governs. Run `fk gates build`; add `node scripts/fk-boundaries.mjs` to the check command. Every other boundary, layering, banned-dependency and data rule becomes a check in `<runner> check`. No gate yet → `GATE-MISSING: <rule>` in the bootstrap task.
8. **Impact map:** add a rule for each coupling code analysis can't see (legal texts, store listings, pricing pages, design tokens, ML baselines, API clients of shipped apps).
9. **Wire in:** append to `CLAUDE.md` (never remove content; stay within 40 lines): "Any change follows `<project>-dev`; agreements live in `docs/adr/` and `docs/standards/`; reviewers load `fk-conformance`; lessons in `docs/process/lessons.md`." Add "Project bible: docs/PROJECT.md — read it first" if it is missing.
   Then record the real commands for the kit hooks: `fk config set runner "<runner>"`, `fk config set check "<full check command>"`, `fk config set fast_gates "<fast pre-commit gates>"` (and `stack`). Once set, a gate command may only grow (`<old> && <new check>`); any other change needs the founder's typed `fk-approve gates <key> "<command>" <reason>`.
10. **Validate:** frontmatter has `name` and `description` (≤ 200 chars); `SKILL.md` ≤ 350 words; the skill appears in the skills list after reload.
11. **Independent review:** `oh-my-claudecode:critic` reviews the skill and standards against the architecture (critical/major/minor, paste-ready fixes); apply them. Then `oh-my-claudecode:verifier` checks cross-references. Journal both (`fk-journal`).
12. **First task:** the bootstrap task: repo skeleton + the gates themselves, each proven red once on a planted violation. It starts with `fk portability init` (the kit's `justfile` and `.github/workflows/fresh-clone.yml`; existing files are never overwritten), pins the runtimes with `mise use <tool>@<exact version>` and puts services in `compose.yaml`.
