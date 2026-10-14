---
name: fk-search-first
description: Use before writing a new utility, integration or feature that may already exist - search the repo, package registries, MCP servers and maintained OSS, then adopt, extend or build.
---

# Search before building

Writing code is the last option, not the first. For a non-trivial need, run OMC's `research` workflow (or its document-specialist agent) with the brief below; for a small helper, do the quick pass yourself.

## Quick pass (inline, minutes)

1. **Repo**: search the codebase and tests for an existing helper, wrapper or pattern (`rg` for the concept, not just the name).
2. **Dependencies already installed**: does a current dependency already do this?
3. **Registry**: is this a common problem with a maintained package (npm, PyPI, crates.io, Go modules, Maven, Packagist, NuGet)?
4. **Tools**: is there an MCP server, CLI or skill already available in this session for it?
5. **Reference implementations**: maintained OSS or official examples to copy the approach from.

Report honestly which channels you could and could not check (no network, no `gh` auth, no registry access); never say "nothing exists" about a channel you skipped.

## Full pass (delegate to OMC research)

Brief: the need in one sentence; language/framework and version; constraints (license, size, runtime, security, offline); what "good enough" means. Ask for a short comparison table and a recommendation.

## Evaluate candidates

Score each on: fit to the need; maintenance (recent releases, open-issue response); adoption; documentation; license compatible with the project; dependency weight and transitive risk; security history.

## Decide

| Signal | Action |
|---|---|
| Exact match, maintained, compatible license | **Adopt**: install pinned, use directly |
| Good foundation, partial match | **Extend**: install + thin wrapper owned by the project |
| Several small partial matches | **Compose** 2-3 small packages |
| Nothing suitable | **Build**, informed by what you found; keep it minimal |

Record a non-obvious adopt/build choice for a core concern (auth, payments, data store, framework) as an ADR (`fk-adr-writing`).

## Install rules

- Pin exact versions and commit lock files; follow the project's dependency policy.
- New dependencies get the same review as code: license, maintainer, install scripts, size.

## Anti-patterns

- Writing a utility before searching the repo for an existing one.
- Ignoring an available MCP server or CLI that already does the job.
- Wrapping a library so heavily it loses its benefits.
- Pulling a large package for one small function.
- Claiming coverage of a search channel that was unavailable.

_Source: adapted from ECC `skills/search-first` (MIT), mapped onto OMC research; see NOTICE.md._
