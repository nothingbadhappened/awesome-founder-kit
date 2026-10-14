---
type: regex
target: { source: file, path: src/services/orders.js }
pattern: '[^=!<>]==(?!=)|console\.log'
match: not_contains
---
