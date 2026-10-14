# Third-party notices

Founder Kit includes material adapted from the third-party projects below. Each project's license applies to the material taken from it.

## everything-claude-code (ECC)

- Repository: https://github.com/affaan-m/ECC (formerly `affaan-m/everything-claude-code`)
- Version: tag `v2.2.3`, commit `c05b2d6614f62f6db0047669aa4eefb223d478f9`
- License: MIT
- Copyright: Copyright (c) 2026 Affaan Mustafa
- Full license text: [`vendor/ecc/LICENSE`](vendor/ecc/LICENSE); each `plugins/fk-practice-*/NOTICE.md` repeats it so installed plugins carry the notice.
- Used in: `plugins/fk-practice-core`, `fk-practice-web`, `fk-practice-python`, `fk-practice-go`, `fk-practice-jvm`, `fk-practice-apple`, `fk-practice-rust`, `fk-practice-dotnet`, `fk-practice-php`, `fk-practice-llm`.
- Per-file provenance (upstream path, ref, commit, sha256 of the upstream file, local paths, adaptation note): [`vendor/ecc/MANIFEST.json`](vendor/ecc/MANIFEST.json).

### Adaptations

The upstream skills were modified, not copied verbatim:

- renamed to `fk-*` (`security-review` became `fk-security-checklist` to avoid the Claude Code built-in `/security-review`; `*-tdd` skills became `*-testing`);
- descriptions rewritten trigger-first (at most 200 characters) and bodies cut to at most 150 lines, with overflow moved to a sibling `reference.md`;
- references to ECC agents, commands, hooks, scripts and settings removed; workflow steps point to oh-my-claudecode (OMC) only where useful;
- marketing text, dated price tables and examples that do not change behaviour dropped;
- absolutes (always-immutable data, fixed coverage percentages) softened into defaults that the project's own standards can override;
- several skills merged or distilled (ADRs merged with the Founder Kit ADR template; token advice distilled from `context-budget`, `token-budget-advisor`, `docs/token-optimization.md` and `the-longform-guide.md`).

### Import scan

Every vendored upstream file was downloaded at the pinned commit into a quarantine directory outside the repository, its git blob hash checked against the upstream tree, and scanned with SkillSpector (`skillspector scan <dir> --no-llm -f json`). The scan reported 56 pattern findings (24 HIGH, 32 MEDIUM, 0 CRITICAL); all were triaged as documentation false positives (example `DELETE` routes, `.env`/`~/.claude/settings.json` mentioned in advice, unpinned `npx` examples, a benign maintainer HTML comment). No file was rejected. Unpinned install examples, settings-file paths and the HTML comment do not appear in the adapted skills.

`postgres-patterns` upstream credits Supabase Agent Skills (MIT) as its basis; that credit is kept in the adapted skill.
