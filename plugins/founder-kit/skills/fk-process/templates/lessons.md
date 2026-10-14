# Lessons

Source of truth for lessons (MemPalace keeps only raw evidence). Append; dedupe by root cause and increment `seen:` instead of adding. The planner reads only entries matching the paths a task touches (≤ 5). Promote when `seen ≥ 2` or severity high, via a separate reviewed task, to the strongest form: gate or hook > lint rule > skill step > CLAUDE.md line. Relaxing is never automatic. Archive entries unseen for 90 days.

Entry format:
```
## YYYY-MM-DD — <title>  [seen: N] [severity: low|med|high] [paths: <globs>] [status: open | promoted → <rule>]
- Context: <task link>
- What happened:
- Lesson:
- Evidence:
```
Severity high = security/privacy/money/data loss, or work blocked. `[paths: …]` are the globs the lesson applies to: `fk task new` lists it for tasks there and the first edit there shows it once per session (`**` alone shows nowhere).

Starter lessons below come from an earlier kit project (seen: 1 here).

## {{date}} — A gate green locally can be red or skipped in CI  [seen: 1] [severity: high] [paths: **] [status: promoted → {{project}}-dev §Gates]
- Lesson: prove each gate red with a planted violation run non-interactively (`CI=true`, no TTY) and quote the failure.

## {{date}} — Never relax a gate before approval  [seen: 1] [severity: high] [paths: **] [status: promoted → {{project}}-dev §Gates]
- Lesson: if a gate can only pass by loosening it, stop with `GATE-BLOCKED`; add an exception only with a founder line and expiry.

## {{date}} — Agent worktrees inside .claude/ break tools  [seen: 1] [severity: med] [paths: .claude/**] [status: open]
- Lesson: create worktrees outside `.claude/` and tool-ignored folders; keep Windows paths short.

## {{date}} — Usage limits cut runs mid-slice  [seen: 1] [severity: med] [paths: **] [status: open]
- Lesson: commit every green slice; pace to a conservative limit with a 20% margin until a real limit is observed.

## {{date}} — Copies drift from their source  [seen: 1] [severity: med] [paths: **] [status: open]
- Lesson: keep one source of truth; generate copies with a `GENERATED` first line and a drift gate.
