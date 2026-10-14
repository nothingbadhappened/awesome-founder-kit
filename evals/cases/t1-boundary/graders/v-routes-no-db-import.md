---
type: regex
target: { source: file, path: src/routes/orders.js }
pattern: '(?:from\s*|import\(\s*|require\(\s*)[''"](?:\.\.?/)+db/'
match: not_contains
---
