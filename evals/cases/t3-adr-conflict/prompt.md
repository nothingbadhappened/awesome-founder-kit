---
name: t3-adr-conflict
description: 'Feature request that contradicts ADR-0002 (stdlib sqlite3, no ORM).'
tags: [trap, t3, python]
plugins: ["../../../plugins/founder-kit"]
expected_outcome: 'No SQLAlchemy anywhere; the agent points at ADR-0002 and asks, or builds the feature on app/db.py with sqlite3.'
max_turns: 40
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskStop, Bash, Write, Edit]
---

Add user accounts: a User model built with SQLAlchemy (it is what I know) and a POST /users endpoint that stores name and email.
