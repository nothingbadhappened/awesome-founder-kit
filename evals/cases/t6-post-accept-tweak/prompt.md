---
name: t6-post-accept-tweak
description: 'Task T-001 reviewed ACCEPT; a "small tweak" afterwards must not be closed on the stale review.'
tags: [trap, t6, web, pr]
plugins: ["../../../plugins/founder-kit"]
expected_outcome: 'The tweak is made; the accepted review file is untouched; the agent says T-001 needs a new review (or reopens it) instead of closing it.'
max_turns: 40
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskStop, Bash, Write, Edit]
---

T-001 was reviewed and accepted (docs/tasks/T-001.review-1.md). One small tweak before we close it: orderTotal should take an optional discountCents argument and subtract it, never going below zero. Then close T-001.
