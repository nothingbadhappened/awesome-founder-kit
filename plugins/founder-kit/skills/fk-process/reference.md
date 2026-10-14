# fk-process reference

## Facts
Slug; languages/frameworks; modules; the single command runner (`just`/`make`/npm scripts); data classes (public/personal/sensitive); external ports (AI, payments, storage, email, stores…); environments/hosting; platforms (web/iOS/Android); regulated areas (health, finance, kids, biometrics…); other agent tools used on the repo (Codex, Cursor…).

## Scaling
| Shape | Do |
|---|---|
| (a) no software | No dev skill or standards; use `fk-journal`, ADRs and task specs only |
| (b) static site | Drop migrations, flags, data inventory, outbox, ZAP, pentest; keep secrets, headers, dependency audit, a11y |
| (c)+ | Full templates |
| (d) | Add mobile: MASVS, `e2e-mobile`, store labels |
| (e) | Add ML: `eval`, baselines, spend caps |

## Placeholders
- Flags: `ui` (has UI), `mobile` (native iOS/Android), `ml` (AI/ML output quality matters). `{{#if X}}…{{/if}}`: X true → keep inner text, delete markers; false → delete whole block.
- Replace: `project`, `Project`, `runner`, `runner_file`, `modules`, `boundary_tool`, `external_ports`, `sensitive_classes`, `r3_areas`, `cost_threshold`, `hosting`, `default_region`, `jurisdictions`, `date`, all `*_glob`, and `<runner>`.
- Glob folder doesn't exist yet: use the architecture's planned path + `# planned, verify in bootstrap`.
- Delete impact-map rules for absent areas (e.g. `money` without payments); log each deletion in the changelog.

## Templates
Standards go into drydock's slots; the skill only points at them.

| Template | Becomes |
|---|---|
| `SKILL.template.md` | `.claude/skills/<project>-dev/SKILL.md` |
| `engineering-standards.template.md` | split by its `→` markers into `docs/standards/architecture.md`, `data.md`, `process.md` (merged under drydock's headings) |
| `definition-of-done.md` | section "Definition of done" in `docs/standards/process.md` |
| `security.template.md` | `docs/standards/security.md` |
| `portability.template.md` | `docs/standards/portability.md` |
| `impact-map.template.yaml` | `docs/standards/impact-map.yaml` |
| `lessons.md` | `docs/process/lessons.md` |
| `task-spec.md`, `adr.md` | `.claude/skills/<project>-dev/templates/` as is (`fk task new` fills the `{{…}}` of task-spec.md; skip it in the placeholder search) |

## Why (for reviewers)
- Thin skill: OMC already plans, executes, verifies and reviews; a second procedure competes with it and gets ignored. The skill holds only facts, risk mapping and gate rules.
- Bootstrap mode: on an empty repo gates can't run; without it agents fake evidence or write "N/A". R0 lane: heavy process for typo fixes invites skipping.
- Planted violations run non-interactively because some tools behave differently with a TTY; a gate proven only in a terminal can be green-by-skip in CI.
- Rule edits are separate reviewed tasks; relaxing needs the founder: otherwise self-improvement quietly weakens gates. N-1 migrations: rollback = redeploy previous version.
- Flags off in prod by default: new behaviour can be switched off without a deploy. Fakes for every external port: offline, deterministic, free tests.
- Commit per green slice: a usage-limit cut-off then costs at most one slice.
