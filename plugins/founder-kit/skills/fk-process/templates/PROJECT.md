# {{Project}} — project bible
Read this first. It summarizes and links; the details live in the linked files. At most 60 lines (`fk bible check`). After editing a section, run `fk bible touch <section>`.

## Mission <!-- fk:updated {{date}} -->
<one or two sentences: what the product does, for whom, and why it matters>

## Users <!-- fk:updated {{date}} -->
- <who uses it, and the job they need done>

## Non-negotiables <!-- fk:updated {{date}} -->
- <red line, one line each; the full list is in the constraints>

## Principles <!-- fk:updated {{date}} -->
- <how we trade off, e.g. "privacy over convenience">

## Architecture (3 lines) <!-- fk:updated {{date}} -->
- <the main parts and how they talk>
- <where data lives>
- <what runs where>

## Now
- Phase: <kickoff | building | beta | ...>
- Focus: <one line>
- Open task: none
- Last finished: none
- Last decision: <ADR-NNNN title>

## Above this project
- Parent: none (or the umbrella project's path or URL, and its bible)
- Related repos: none

## Links
- Constraints: [00-constraints.md](00-constraints.md)
- Architecture: [02-architecture.md](02-architecture.md)
- Decisions (ADR index): [adr/](adr/)
- Standards: [standards/](standards/)
- Lessons: [process/lessons.md](process/lessons.md)
- Design system: [design-system/](../design-system/) (UI only; delete otherwise)
