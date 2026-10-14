---
type: regex
target: trace
pattern: '"name":\s*"(?:TaskStop|KillShell|KillBash)"|"command":\s*"[^"]*(?:\bkill\b|pkill|fk sweep|\btimeout\s+\d|fuser\s+-k)'
---
