# Unity-like fixture: ProjectSettings/ProjectVersion.txt, C# runtime and editor scripts, a large generated PNG
# (about 2.4 MB of noise) committed without Git LFS. No Unity needed: nothing here is built.
# Sourced by build.sh (put, fk and G come from there).
CHECK="node scripts/fk-boundaries.mjs"
APPROVED='[]'

fixture_unity() {
  put ProjectSettings/ProjectVersion.txt <<'EOF'
m_EditorVersion: 6000.0.23f1
m_EditorVersionWithRevision: 6000.0.23f1 (000000000000)
EOF
  put Packages/manifest.json <<'EOF'
{
  "dependencies": {
    "com.unity.inputsystem": "1.11.2",
    "com.unity.test-framework": "1.4.5"
  }
}
EOF
  put Assets/Scripts/Runtime/Player.cs <<'EOF'
using UnityEngine;

namespace Game.Runtime
{
    public class Player : MonoBehaviour
    {
        [SerializeField] private float laneWidth = 2.5f;
        private int lane;

        public void MoveLeft() => lane = Mathf.Max(-1, lane - 1);
        public void MoveRight() => lane = Mathf.Min(1, lane + 1);
        private void Update() => transform.position = new Vector3(lane * laneWidth, 0f, transform.position.z);
    }
}
EOF
  put Assets/Scripts/Editor/LevelTool.cs <<'EOF'
using UnityEditor;

namespace Game.Editor
{
    public static class LevelTool
    {
        [MenuItem("Game/Validate Levels")]
        public static void Validate() => EditorUtility.DisplayDialog("Levels", "All levels valid.", "OK");
    }
}
EOF
  mkdir -p Assets/Textures
  # Deterministic noise image, so it does not compress: the repo's "large binary not in LFS".
  node -e '
const zlib = require("zlib"), fs = require("fs");
const w = 1024, h = 768, row = w * 3 + 1, raw = Buffer.alloc(row * h);
let s = 0x2545f491;
for (let i = 0; i < raw.length; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; raw[i] = i % row === 0 ? 0 : s & 255; }
const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(process.argv[1], Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 1 })), chunk("IEND", Buffer.alloc(0))]));
' Assets/Textures/atlas.png
  put .gitignore <<'EOF'
Library/
Temp/
Obj/
Build/
Logs/
UserSettings/
EOF
  put README.md <<'EOF'
# lane-runner

A three-lane endless runner for mobile, made in Unity 6. Before changing anything, read docs/PROJECT.md and
docs/standards/process.md.
EOF
  put docs/PROJECT.md <<'EOF'
# lane-runner

## Mission <!-- fk:updated 2026-09-01 -->
A two-minute-session runner people replay on the bus.

## Users <!-- fk:updated 2026-09-01 -->
Casual mobile players.

## Non-negotiables <!-- fk:updated 2026-09-01 -->
- 60 fps on a mid-range phone; install size under 150 MB (ADR-0002).

## Principles <!-- fk:updated 2026-09-01 -->
- Runtime code never depends on editor code (ADR-0001).

## Architecture <!-- fk:updated 2026-09-01 -->
Assets/Scripts/Runtime (game), Assets/Scripts/Editor (tools only).
EOF
  put docs/standards/process.md <<'EOF'
# How work is done here

- The gate is `node scripts/fk-boundaries.mjs`. Never loosen it.
- Docs live in docs/; level designs in docs/levels.md.
- Decisions live in docs/adr/. If a request contradicts an accepted ADR, say so and ask.
EOF
  put docs/adr/0001-runtime-never-uses-editor.md <<'EOF'
---
applies_to: [Assets/Scripts/**]
bible: [principles]
fit:
  - forbid_import: {from: "Assets/Scripts/Runtime/**", to: "Assets/Scripts/Editor/**"}
---
# 0001 — Runtime code never uses editor code
Date: 2026-09-01 · Status: accepted (founder)

## Decision
Nothing under Assets/Scripts/Runtime/ uses a namespace from Assets/Scripts/Editor/ (player builds would break).
## Fitness gate
- `fit:` forbid_import above (`fk gates build`).
EOF
  put docs/adr/0002-performance-budget.md <<'EOF'
---
applies_to: [Assets/**]
bible: [non-negotiables]
fit: []
---
# 0002 — 60 fps and 150 MB
Date: 2026-09-01 · Status: accepted (founder)

## Decision
60 fps on a mid-range phone and an install size under 150 MB are release blockers.
EOF
  put docs/adr/0003-asset-naming.md <<'EOF'
---
applies_to: [Assets/**]
bible: []
fit:
  - forbid_path: "Assets/**/* *"
---
# 0003 — Asset names have no spaces
Date: 2026-09-01 · Status: accepted (founder)

## Decision
Asset file names use kebab-case; no spaces (they break command-line builds).
EOF
}
