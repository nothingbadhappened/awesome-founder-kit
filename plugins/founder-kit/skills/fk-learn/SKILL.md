---
name: fk-learn
description: "Use after a failed gate, reviewer REVISE, rollback or founder correction: record one deduplicated lesson; flag promotions."
---

# Learning loop

`docs/process/lessons.md` is the source of truth (format: fk-process `templates/lessons.md`). MemPalace keeps raw evidence only. Write lessons through `fk lessons`, never by hand-editing counters.

## Record (one entry per trigger)
1. Name the root cause, not the symptom: why did it happen, and what would have caught it earlier?
2. If MemPalace is available, call `mempalace_check_duplicate` with the lesson text; if it finds a lesson already filed, use its wording for the title.
3. Run:
   `fk lessons add --title "<root cause, short>" --what "<symptom and cause>" --lesson "<what to do instead>" --severity low|med|high --paths "<globs touched>" --context "<task or PR>" --evidence "<commit, log or transcript link>"`
   - A matching lesson is bumped (`seen:` +1) instead of duplicated. If the match is wrong, re-run with `--new`.
   - Severity high = security, privacy, money, data loss, or work blocked.
   - `--paths`: the narrowest globs where it can recur (e.g. `src/billing/**`); tasks there list it in Context and the first edit there shows it. `**` shows it nowhere.
4. To count a recurrence directly: `fk lessons bump <number|title words> --evidence "<link>"`.

## Promote (a different agent)
5. Run `fk lessons promote-candidates`. Candidates: status open and `seen >= 2` or severity high.
6. Hand each candidate to OMC's critic as a separate reviewed task. The critic picks the strongest form that works: a gate or hook, else a lint rule, else a skill step, else a CLAUDE.md line. Relaxing a rule is never automatic.
7. After the promotion lands, set the entry's status to `promoted → <rule or file>` in the same task.
8. If a CLAUDE.md line was added, run `fk lessons budget`; over 40 lines means merge or evict a rule (prefer turning it into a gate).

## Upkeep (at milestones)
9. `fk lessons archive` moves lessons unseen for 90 days to `docs/process/lessons-archive.md`. If an archived lesson recurs, move it back and bump it.

## Don't
- Write a lesson for a one-off typo or a flaky network call.
- Copy transcripts into lessons; link them.
- Promote in the same task that recorded the lesson.
