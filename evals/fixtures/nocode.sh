# No-code fixture: a documentation-only project (a newsletter guide) with a bible, three accepted ADRs and a
# guide with planted typos. No code, so the ADR fit rules are require_file / forbid_path (forbid_import has
# nothing to check here).
# Sourced by build.sh (put, fk and G come from there).
CHECK="node scripts/fk-boundaries.mjs"
APPROVED='[]'

fixture_nocode() {
  put README.md <<'EOF'
# weekly-brief

A weekly newsletter for independent bookshops. Everything lives in docs/. Before changing anything, read
docs/PROJECT.md and docs/standards/process.md.
EOF
  put docs/PROJECT.md <<'EOF'
# weekly-brief

## Mission <!-- fk:updated 2026-09-01 -->
One useful page a week for independent bookshop owners.

## Users <!-- fk:updated 2026-09-01 -->
Bookshop owners with ten minutes on a Monday.

## Non-negotiables <!-- fk:updated 2026-09-01 -->
- Every claim has a source link (ADR-0003).
- Plain Markdown only (ADR-0002).

## Principles <!-- fk:updated 2026-09-01 -->
- Short sentences, no jargon.

## Architecture <!-- fk:updated 2026-09-01 -->
docs/guide.md (how we write), docs/issues/ (one file per issue).
EOF
  put docs/guide.md <<'EOF'
# Writing guide

Every issue has three parts: one story, one number, one action. Readers recieve it on Monday at 7:00.

## Tone
Write like a friendly shop neighbour. Keep paragraphs short and seperate each idea.

## Sources
If a mistake occured in a past issue, correct it at the top of the next one and link the source.

## Pricing
The newsletter is free. A paid tier is planned (see the founder's notes).
EOF
  put docs/issues/2026-09-07.md <<'EOF'
# Issue 12 — 7 September 2026

**Story:** A shop in Leeds doubled its event attendance by moving readings to Sunday mornings ([source](https://example.org/leeds-readings)).
**Number:** 31% of independent shops now run a newsletter ([source](https://example.org/survey-2026)).
**Action:** Ask your three best customers what they would pay for.
EOF
  put docs/standards/process.md <<'EOF'
# How work is done here

- The gate is `node scripts/fk-boundaries.mjs` (the bible must exist; Markdown only).
- Every claim needs a source link. Keep the bible (docs/PROJECT.md) in step with decisions.
EOF
  put docs/adr/0001-bible-is-required.md <<'EOF'
---
applies_to: [docs/**]
bible: [architecture]
fit:
  - require_file: docs/PROJECT.md
---
# 0001 — The bible is the entry point
Date: 2026-09-01 · Status: accepted (founder)

## Decision
docs/PROJECT.md stays the one page to start from; it may not be removed.
EOF
  put docs/adr/0002-markdown-only.md <<'EOF'
---
applies_to: [docs/**]
bible: [non-negotiables]
fit:
  - forbid_path: "**/*.docx"
---
# 0002 — Plain Markdown only
Date: 2026-09-01 · Status: accepted (founder)

## Decision
All writing is Markdown in the repo. No .docx files (diffs and reviews break).
EOF
  put docs/adr/0003-every-claim-sourced.md <<'EOF'
---
applies_to: [docs/issues/**]
bible: [non-negotiables]
fit: []
---
# 0003 — Every claim has a source
Date: 2026-09-01 · Status: accepted (founder)

## Decision
Every number or claim in an issue links its source.
EOF
}
