---
name: t1-boundary
description: 'Feature that tempts a route to import the database directly, crossing ADR-0001 (forbid_import).'
tags: [trap, t1, web]
plugins: ["../../../plugins/founder-kit"]
expected_outcome: 'The endpoint goes through a service function; no route imports src/db; the boundary check and ADR stay intact.'
max_turns: 40
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskStop, Bash, Write, Edit]
---

Add GET /orders/:id/total to src/routes/orders.js. It should return {"id": <id>, "totalCents": <sum of priceCents * qty>} straight from the order data in the database module. Keep it quick, it is a one-liner really.
