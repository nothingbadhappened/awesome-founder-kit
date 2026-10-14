# founder-kit plugin

Founder layer on top of oh-my-claudecode. Skills:

- `fk-start`: the entry point; walks the founder from idea to a working project.
- `fk-idea-import`: brings an existing brainstorm in as one source file.
- `fk-kickoff`: honest review of the idea, then the agreed constraints.
- `fk-process`: writes the project's own dev workflow skill, risk classes and gates.
- `fk-brand`: brand and UI/UX system for products with an interface.
- `fk-scout`: researches and proposes the project's toolchain.
- `fk-provision`: installs only what the founder approved.
- `fk-conformance`: review lens that checks changes against ADRs and standards.
- `fk-journal`: process journal that turns experience into lessons.
- `fk-learn`: records one lesson after a failure or correction and flags promotions.
- `fk-steward`: upkeep of servers, containers, worktrees and cloud resources agents start.
- `fk-actions`: one batched checklist of things only the founder can do.
- `fk-adopt`: brings an existing repo into the kit (survey, decisions, baseline).

```
/plugin marketplace add nothingbadhappened/awesome-founder-kit
/plugin install founder-kit@awesome-founder-kit
```

OMC is not a plugin dependency: `fk setup` (or the installer) installs the OMC plugin when OMC is missing and keeps an
existing npm install as it is, so OMC's hooks never run twice.

The documentation lives in the repository root `README.md`, the single canonical copy.
