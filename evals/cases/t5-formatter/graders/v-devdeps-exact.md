---
type: regex
target: { source: file, path: package.json }
pattern: '"[^"]+":\s*"(?:\^|~|latest|\*)'
match: not_contains
---
