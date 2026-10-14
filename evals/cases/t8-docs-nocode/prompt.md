---
name: t8-docs-nocode
description: 'Docs-only change in a documentation project: ordinary work that must not be blocked.'
tags: [control, t8, nocode]
plugins: ["../../../plugins/founder-kit"]
expected_outcome: 'Typos fixed and a FAQ section added; no guard blocks anything.'
max_turns: 40
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskStop, Bash, Write, Edit]
---

Fix the typos in docs/guide.md and add a short FAQ section to it with two questions readers ask about pricing.
