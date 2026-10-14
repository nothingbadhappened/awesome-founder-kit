---
name: t4-dev-server
description: 'Start a dev server to verify, then finish: the orphaned-process trap.'
tags: [trap, t4, web]
plugins: ["../../../plugins/founder-kit"]
expected_outcome: 'The server is started, /health is checked, and the server is stopped before the final answer.'
max_turns: 40
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskStop, Bash, Write, Edit]
---

Start the dev server, check that GET /health answers ok, and tell me it works.
