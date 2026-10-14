#!/usr/bin/env bash
# Smoke checks after a real `install/install.sh` run (Linux, macOS). No Claude login, no API key.
#   bash evals/smoke/check.sh <install log> <repo checkout>
# 1. the base tools answer; 2. `fk doctor --hooks` has no red row except sign-in related ones; 3. `fk init` works in a
# fresh repo; 4. planted guard events are denied (evals/smoke/guards.mjs). Every failure prints what it saw.
set -u
LOG=${1:?usage: check.sh <install log> <repo checkout>}
SRC=${2:?usage: check.sh <install log> <repo checkout>}
export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:/opt/homebrew/bin:/usr/local/bin:$PATH"
FAILS=0
fail() { echo "FAIL  $*"; FAILS=$((FAILS + 1)); }
ok() { echo "ok    $*"; }
strip() { sed 's/\x1b\[[0-9;]*m//g'; }

echo "== installer result"
code=$(sed -n 's/^installer exit: //p' "$LOG" | tail -n1)
echo "installer exit code: ${code:-unknown} (1 means some row stayed red; the checks below decide)"
grep -E '^\s*(green|yellow|red) ' "$LOG" | strip | tail -n 20

echo "== base tools"
for t in "git --version" "node --version" "claude --version" "gitleaks version" "uv --version"; do
  if out=$($t 2>&1); then ok "$t: $(echo "$out" | head -n1)"; else fail "$t: not runnable ($(echo "$out" | head -n1))"; fi
done

echo "== founder-kit plugin"
REG="$HOME/.claude/plugins/installed_plugins.json"
KIT=""
[ -f "$REG" ] && KIT=$(node -e 'const j=require(process.argv[1]);const e=[].concat(j.plugins["founder-kit@awesome-founder-kit"]||[])[0]||{};process.stdout.write(e.installPath||"")' "$REG" 2>/dev/null)
ALLOW='sign(ed)? in|log ?in|auth'
if [ -n "$KIT" ] && [ -f "$KIT/bin/fk.mjs" ]; then ok "installed plugin at $KIT"
else
  # `claude plugin install` without a signed-in Claude can fail; the checks still run on the checked-out kit.
  echo "::warning::founder-kit plugin was not installed by the installer (see the plan above); checking the checked-out plugin instead"
  grep -E 'failed: claude plugin' "$LOG" || true
  KIT="$SRC/plugins/founder-kit"
  grep -qE 'failed: claude plugin' "$LOG" && ALLOW="$ALLOW|oh-my-claudecode"
fi

echo "== fk init in a fresh repo"
T=$(mktemp -d)
git -C "$T" init -q
if out=$(cd "$T" && node "$KIT/bin/fk.mjs" init 2>&1) && [ -f "$T/.fk/config.json" ]; then ok "fk init: $(echo "$out" | tail -n1)"
else fail "fk init did not create .fk/config.json:"; echo "$out"; fi
hp=$(git -C "$T" config --get core.hooksPath || true)
[ "$hp" = .githooks ] && ok "core.hooksPath = .githooks" || fail "core.hooksPath is '$hp', expected .githooks"

echo "== fk doctor --hooks"
doc=$(cd "$T" && node "$KIT/bin/fk.mjs" doctor --hooks 2>&1 | strip)
echo "$doc"
reds=$(echo "$doc" | grep -E '^red ' || true)
bad=$(echo "$reds" | grep -Ev "$ALLOW" | grep -v '^$' || true)
[ -n "$reds" ] && echo "red rows allowed here (sign-in related): $(echo "$reds" | grep -E "$ALLOW" | wc -l | tr -d ' ')"
if [ -n "$bad" ]; then fail "fk doctor --hooks has red rows:"; echo "$bad"; else ok "fk doctor --hooks: no red rows except sign-in related"; fi
echo "$doc" | grep -q 'planted:' || fail "fk doctor --hooks printed no planted-violation rows"

echo "== guards"
node "$SRC/evals/smoke/guards.mjs" "$KIT" || fail "planted guard events were not all denied"
rm -rf "$T"

echo
if [ "$FAILS" -gt 0 ]; then
  echo "smoke: $FAILS check(s) failed. Install log tail:"; tail -n 60 "$LOG"
  for f in "$HOME/.fk/install-ledger.jsonl" "$HOME/.fk/state/base-tools.json"; do [ -f "$f" ] && { echo "--- $f"; tail -n 40 "$f"; }; done
  exit 1
fi
echo "smoke: all checks passed"
