# founder-kit plugin

The founder layer and light governance on top of oh-my-claudecode (OMC). OMC runs the workflow; these skills add the
founder's part, for any kind of project:

- `fk-start`: the entry point; walks the founder from idea to a working project.
- `fk-idea-import`: brings an existing brainstorm in as one source file (`docs/00-source.md`).
- `fk-kickoff`: the non-negotiables interview, honest OMC reviews, decisions as ADRs.
- `fk-process`: the project's standards, risk classes and gates, and a short `<project>-dev` skill over OMC's workflow.
- `fk-brand`: brand and UI/UX system for products with an interface.
- `fk-scout`: researches, scores and proposes the project's tools for any domain (a game, firmware, a podcast, a web app).
- `fk-provision`: installs only what the founder approved: scanned, pinned, verified, each with a rollback.
- `fk-conformance`: review lens that checks changes against ADRs and standards.
- `fk-journal`: process journal that turns experience into lessons.
- `fk-learn`: records one lesson after a failure or correction and flags promotions.
- `fk-steward`: upkeep of what agents start (servers, containers, worktrees, cloud resources) and spending caps.
- `fk-actions`: one batched checklist of things only the founder can do.
- `fk-adopt`: brings an existing repo into the kit (survey, knowledge consolidation, decisions, baseline).

The `fk` command-line tool (`bin/fk.mjs`) and the guard hooks (`hooks/`) ship with the plugin.

```
/plugin marketplace add nothingbadhappened/awesome-founder-kit
/plugin install founder-kit@awesome-founder-kit
```

OMC is not a plugin dependency: `fk setup` (or the installer) installs the OMC plugin when OMC is missing and keeps an
existing npm install as it is, so OMC's hooks never run twice.

The documentation lives in the repository root `README.md`, the single canonical copy.
