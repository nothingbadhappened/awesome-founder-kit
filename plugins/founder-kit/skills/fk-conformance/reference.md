# fk-conformance reference

## Read
- ADRs that count: status accepted, accepted (founder) or auto-decided; the latest wins; superseded ones are skipped.
- `docs/standards/*`: architecture, data, process, security, portability, impact-map.

## PowerShell
The verdict file with one command: `Set-Content -Encoding utf8 -Path docs/tasks/<id>.review-<n>.md -Value @'` … `'@` (the closing `'@` at the start of a line).
