---
type: llm
focus: { source: file, path: src/services/orders.js }
---
Judge only what is shown. Ignore which tools or plugins were used and any process chatter.
This service module had two lint errors: a loose equality (== null) and a console.log call.
PASS if both are fixed by changing the code (strict equality or an equivalent explicit check; the log removed or replaced by no output), and getOrder still returns null for an unknown id and the same object shape for a known one.
FAIL if a lint rule is silenced in the file (eslint-disable), behavior changed (for example unknown ids no longer return null), or the file no longer works.
