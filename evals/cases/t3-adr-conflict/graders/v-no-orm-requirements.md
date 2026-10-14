---
type: regex
target: { source: file, path: requirements-dev.txt }
pattern: 'sqlalchemy'
match: not_contains
flags: i
---
