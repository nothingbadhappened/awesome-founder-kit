---
name: fk-journal
description: Use at the end of every task or session, after a notable problem or fix, and when a tool or practice proves its worth or fails, to log how the project is built with AI.
---

# Process Journal

Records HOW the product is built so a future non-technical founder can repeat it: plain words, a concrete example per claim, jargon explained on first use. Project-agnostic.

## Where memory lives (one home each)
- Repo (source of truth): `docs/process/journal.md` (story) and `docs/process/lessons.md` (lessons with a `seen:` counter). A fresh clone needs nothing else.
- OMC `remember` / `project-memory.json`: short project conventions only; never journal entries or lessons.
- MemPalace: raw history (transcripts, diary) as evidence; link to it, never copy it here and never treat it as truth.

## Files (`docs/process/`)
- `journal.md`: one entry per task/session. Append-only, newest at bottom.
- `toolkit.md`: each tool/plugin/MCP/skill/agent type relied on (purpose, setup, cost, verdict). Edit in place; change a verdict only with journal evidence.
- `playbook.md`: distilled method (phases, rituals, prompts that worked, failure patterns and fixes). Edit only via distill pass; each rule links its journal entries.
- `skill-candidates.md`: repeating practices that could become generic skills. Append; promote when `seen ≥ 2` or severity high (the same threshold as lessons).

## Entry
```
## YYYY-MM-DD — <title>   [tags: planning|build|review|infra|design|legal|tooling|incident|process|privacy] [severity: low|med|high]
Goal:
What we did / how:
Why this way (rejected alternative):
Issues → fixes (problem → root cause → fix, or "open"):
Human decisions (and the question behind each):
Evidence (files, commits, tasks):
Lesson (one actionable sentence, or "none"; also added to lessons.md or its `seen:` incremented):
Cost/time:
```
- Facts only; name real problems, even embarrassing ones.
- No secrets or personal data.
- Write it in the same session as the work.

## Distill (every ~10 entries or at phase ends)
1. Move repeated lessons into `playbook.md` (with links); update `toolkit.md` verdicts.
2. Add recurring practices to `skill-candidates.md`.
3. Keep the playbook readable by a non-technical founder; rewrite plainly if not.
4. A lesson that is a precaution not seen in the journal is labelled "precaution, not observed".
5. For the kit, a distill pass may also write `docs/playbook-from-<project>.md` (portable method) and `docs/process/kit-feedback.md` (concrete skill gaps for the next kit update).
6. `oh-my-claudecode:critic` reviews playbook changes; never self-approve.
