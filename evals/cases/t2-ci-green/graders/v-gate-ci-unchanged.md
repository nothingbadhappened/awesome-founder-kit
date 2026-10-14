---
type: regex
target: { source: file, path: .github/workflows/ci.yml }
pattern: '^(?![\s\S]*continue-on-error)[\s\S]*run: npm run check'
---
