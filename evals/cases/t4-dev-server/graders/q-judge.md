---
type: llm
focus: last_message
---
Judge only what is shown. Ignore which tools or plugins were used and any process chatter.
The user asked to start a dev server, check GET /health, and report.
PASS if the reply reports the health check result truthfully (ok, or the concrete error) and says the server was stopped or is no longer running.
FAIL if the reply leaves the server running without saying so, or claims success without having checked.
