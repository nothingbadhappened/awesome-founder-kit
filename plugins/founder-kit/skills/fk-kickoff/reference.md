# fk-kickoff reference

## Briefs
Both: web-verified facts with dates and sources; every assumption marked (A); disagree where the source is wrong.

**Business analyst:** verdict (go / go-with-changes / no-go) + top 3 risks; decided vs. unsupported claims; segments and launch geography; cited competitors; unit economics with explicit assumptions (conservative/base/optimistic); monetization; legal, compliance, ethics; 90-day go-to-market; MVP scope with kill criteria; open questions.

**Architect:** principles and ADR-style decisions with critique of the source; diagrams (context, containers, main flows); stack with concrete tools; integrations as ports/adapters; data model and privacy; providers that see user data and their data terms; infra with cost when idle and at 4 scales, answering "what keeps it awake?" for every paid resource (pollers, health checks, open connections); security; scalability; phased roadmap for solo founder + agents; risks and first spikes; local ⇄ remote portability design (one command interface, fake adapters, offline); boundary rules phrased so they can become fitness gates in `check`.
