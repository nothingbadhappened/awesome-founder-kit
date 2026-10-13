---
name: fk-brand
description: Use after fk-kickoff for any product with a user interface, to create its brand and UX system in drydock's design-system/ plus a `<project>-design` skill.
---

# Brand & Design System (generator)

Home: drydock's `design-system/` (`README.md`, `tokens/`, `components/`, `patterns/`). Missing → run `oh-my-claudecode:drydock` first; never create a second layout. A root `DESIGN.md` may exist only as a one-line pointer to `design-system/`.

1. **Interview** (AskUserQuestion, 2–4 options, recommendation first): audience and context of use; the one job the UI must do best and what users must trust; feel (3 adjectives + 3 things it must not look like); existing assets (logo, colors, fonts, domain); platforms (web/iOS/Android; decides native rules); voice (formal ↔ casual, words to avoid); dark mode (default/optional/none).
2. **Write the system** into `design-system/` using reference.md §Design system.
   - Grounding: take visual choices from the product's own world (materials, tools, vernacular). Check them against the generic AI looks listed in the vendored frontend-design guide; replace defaults with choices; record what changed and why.
   - Mark it "v0 proposal" until the founder approves; record approval as an ADR.
3. **Vendor guidelines** (pinned): read reference.md §Vendor. Never modify the copies; refresh only in a dedicated task that diffs against the pinned copy.
4. **Generate `.claude/skills/<project>-design/SKILL.md`** containing the parts in reference.md §Generated skill.
5. **Debt is a decision:** accepted contrast or palette debt (a failing audit kept on purpose) is a founder decision recorded with a `founder YYYY-MM-DD` line and an expiry, never a silent ratchet of the threshold.
6. **Wire in:** add to `CLAUDE.md` "every UI task also follows `<project>-design`; `design-system/` is the brand source of truth"; make sure impact-map rule `design-tokens` covers `design-system/**`; add a `fk-journal` entry.
