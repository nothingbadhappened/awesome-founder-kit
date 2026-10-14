---
name: fk-token-hygiene
description: Use when context fills up fast, sessions degrade, costs climb, or before adding plugins/MCP servers/skills - audit always-on context, choose models, compact, delegate and cache wisely.
---

# Token hygiene

Every always-on token is paid on every turn. Keep the resident layer thin, load detail just in time, and spend expensive models only where they change the outcome.

## 1. Audit what is always loaded

Use the harness's own numbers first (`/context`, `/cost` or `/usage`); estimate the rest with `words x 1.3` for prose, `chars / 4` for code.

| Component | What loads every turn | Flag when |
|---|---|---|
| CLAUDE.md chain | Full text | > ~40 lines per project file; procedures instead of pointers |
| Skills | Name + description only | Descriptions > 200 chars; skills for stacks this project does not use |
| Agents | Descriptions | Long descriptions, duplicates of OMC roles |
| MCP servers | Tool names (schemas when loaded) | > ~6 servers per project; servers wrapping a CLI that is already available (`gh`, `git`, cloud CLIs) |
| Rules / hooks injecting text | Injected text | Anything not needed for the current action |

Classify each item: **always needed** (keep), **sometimes** (scope to projects that use it; load on demand), **rarely** (disable or remove). Report the top 3 savings with an estimate each.

## 2. Scope per project

- Enable plugins and MCP servers per project, not globally, so a web project does not carry game-engine or audio tool lists.
- Prefer a CLI plus a short skill over an always-loaded MCP server when the CLI does the job.
- Keep CLAUDE.md to facts and pointers; move procedures into skills and long material into reference files read only by the step that needs them.

## 3. Choose the model per task

| Task | Tier |
|---|---|
| File search, reading, simple lookups, docs | cheapest (e.g. Haiku) |
| Day-to-day implementation, reviews, tests | standard (e.g. Sonnet) |
| Architecture, subtle debugging, security-critical code, a failed first attempt | strongest (e.g. Opus) |

Use OMC's model routing for delegated agents. Lower the thinking budget for routine work; raise it for hard reasoning.

## 4. Manage the session

- `/clear` between unrelated tasks; stale context costs on every message.
- Compact at logical breakpoints (after exploration, after a milestone, before switching focus), not mid-implementation or mid-debug.
- Before clearing a long task, write a short state file: what worked (with evidence), what failed, what is left. Start the next session from it.
- Delegate wide exploration to a subagent that returns a summary; give it the objective, not just the query, and ask follow-ups (at most ~3 rounds) before accepting the result.
- Parallel sessions only for genuinely independent work, each in its own git worktree with a clear scope.
- Keep files modular (hundreds of lines, not thousands): smaller reads, more first-try successes.

## 5. Prompt caching (API-built apps and long sessions)

- Put stable content first (system prompt, tool definitions, reference docs) and volatile content last; any change early in the prompt invalidates the cache after it.
- Do not inject timestamps, random ids or search results into the early, cached part.
- For details and current pricing/TTL rules, consult the provider's docs (Claude API: the `claude-api` skill) rather than memory.

## 6. Answer length

When the user asks for a short or long answer, keep that length for the rest of the session. Default to the shortest answer that fully resolves the question.

_Source: distilled from ECC `skills/context-budget`, `skills/token-budget-advisor`, `docs/token-optimization.md` and `the-longform-guide.md` (MIT); see NOTICE.md._
