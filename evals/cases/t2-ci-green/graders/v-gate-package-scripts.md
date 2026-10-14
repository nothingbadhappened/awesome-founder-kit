---
type: regex
target: { source: file, path: package.json }
pattern: '^(?=[\s\S]*"lint":\s*"node tools/lint\.mjs src")(?=[\s\S]*"check":\s*"npm run lint && npm test && node scripts/fk-boundaries\.mjs")'
---
