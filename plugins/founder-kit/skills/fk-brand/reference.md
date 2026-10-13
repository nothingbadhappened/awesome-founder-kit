# fk-brand reference

## Design system
Keep drydock's seeded headings; add content under them.
- `design-system/README.md`: 1 Brief · 2 Typography (families + licenses, scale, measure) · 3 Layout and shape (grid, spacing, radii with meaning, elevation) · 4 Motion · 5 Voice and copy · 6 Imagery rules · 7 Open decisions.
- `design-system/tokens/`: color tokens (light/dark, roles, APCA target), type scale, spacing, radii — machine-readable JSON, the only source the code imports.
- `design-system/components/`: the signature component (the one bold place) and each shared component's contract (purpose, variants, misuse).
- `design-system/patterns/`: forms, feedback, loading, empty and error states.

## Vendor
Fetch raw files (not summaries) from a specific commit: `raw.githubusercontent.com/<org>/<repo>/<commit-sha>/…`; record the SHA.
- `anthropics/skills`: `skills/frontend-design/SKILL.md` (Apache-2.0); save as `frontend-design.md` so it isn't loaded as a skill.
- `vercel-labs/web-interface-guidelines`: `AGENTS.md` (MIT).
- Each project's `LICENSE`.

Save under `.claude/skills/<project>-design/vendor/` with a README (source, commit SHA, license, fetch date). Read before use.

## Generated skill
- Precedence: `design-system/` > frontend-design > Vercel guidelines > native rules > project UX rules.
- Plan step before UI code (added to the OMC plan): screen job and all states (empty, loading, error, dense); tokens used; ASCII layout, mobile + desktop; copy as i18n keys; review against the brief.
- Build: shared components first; no raw colors/font sizes outside `design-system/tokens/` (**[auto]** lint); explicit image dimensions; synthetic people only in fixtures.
- Native (if apps): HIG/Material, Dynamic Type to 200%, 44pt/48dp targets, screen-reader labels and order, safe areas, haptics only to confirm actions, permission explanation screens.
- Audit: axe (zero serious/critical); visual snapshots at 3 widths × light/dark; reduced-motion run; keyboard-only walkthrough; APCA contrast test in `check`; screenshot critique ("remove one accessory"); rule-by-rule guideline review with file:line; native apps: e2e screenshots (e.g. Maestro) + manual VoiceOver/TalkBack per release.
- Independent visual review by `oh-my-claudecode:designer`; never self-approved.
- Changing the system is its own task; palette, type, logo or voice changes need founder approval.
