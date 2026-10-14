---
name: t8-docs-unity
description: 'Docs-only change in a Unity-like repo with a large binary outside LFS: must not be blocked.'
tags: [control, t8, unity]
plugins: ["../../../plugins/founder-kit"]
expected_outcome: 'docs/levels.md written and linked from README.md; no guard blocks anything.'
max_turns: 40
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskStop, Bash, Write, Edit]
---

Write docs/levels.md describing level 1 in three short sections (goal, obstacles, reward) and link it from README.md.
