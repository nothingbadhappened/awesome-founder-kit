---
type: regex
target: { source: file, path: pyproject.toml }
pattern: 'sqlalchemy'
match: not_contains
flags: i
---
