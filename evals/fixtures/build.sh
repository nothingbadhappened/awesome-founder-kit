#!/usr/bin/env bash
# Builds one eval fixture in the current (empty) directory: files, git history, `fk init`, three accepted ADRs,
# `fk gates build`, the check command, the install guard in enforce mode. Same workspace for every arm; only the
# plugins loaded into the agent differ.
#
#   build.sh <web|python|unity|nocode> [variant]      variants: web lint-red | web task-accepted
#
# Called by each case's scaffold.sh. `claude plugin eval --scaffold` runs it with cwd = <run>/home/cwd,
# HOME = <run>/home and a minimal environment (PATH, HOME, TMPDIR); nothing else from your shell arrives here.
# FK_EVAL_KIT (only when you run this by hand) points at another founder-kit plugin dir.
set -euo pipefail

FIXTURE=${1:?usage: build.sh <web|python|unity|nocode> [variant]}
VARIANT=${2:-}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
KIT=${FK_EVAL_KIT:-$REPO/plugins/founder-kit}
[ -f "$KIT/bin/fk.mjs" ] || { echo "build.sh: founder-kit CLI not found at $KIT/bin/fk.mjs" >&2; exit 1; }
command -v node >/dev/null || { echo "build.sh: node is not on PATH" >&2; exit 1; }
command -v git >/dev/null || { echo "build.sh: git is not on PATH" >&2; exit 1; }
[ -z "$(ls -A . 2>/dev/null)" ] || { echo "build.sh: $(pwd) is not empty" >&2; exit 1; }

fk() { node "$KIT/bin/fk.mjs" "$@"; }
G=(git -c user.name="Fixture Author" -c user.email="fixture@example.invalid" -c commit.gpgsign=false -c init.defaultBranch=main -c core.autocrlf=false)
put() { mkdir -p "$(dirname "$1")"; cat > "$1"; }

# Inside an eval run (cwd = $HOME/cwd) the kit's state folder (<HOME>/.fk) is moved into the workspace, because the
# Bash sandbox only lets commands write inside the workspace: `fk task`, `fk config set` and `fk ledger` must work
# for the agent as they do on a founder's machine. Never done outside that layout (your real ~/.fk is not touched).
if [ "$PWD" = "$HOME/cwd" ] && [ ! -e "$HOME/.fk" ]; then
  mkdir -p .fk-state && ln -s "$PWD/.fk-state" "$HOME/.fk"
fi

"${G[@]}" init -q
mkdir -p .git/info && printf '.fk-state/\n' >> .git/info/exclude

# shellcheck source=/dev/null
. "$HERE/$FIXTURE.sh"
"fixture_$FIXTURE" "$VARIANT"

"${G[@]}" add -A
"${G[@]}" commit -q -m "Initial project"

# Install guard enforced from the start (the founder's `fk-approve tool enforce` in a real project).
put .fk/toolchain.json <<EOF
{
  "approved": ${APPROVED:-[]},
  "enforce": true
}
EOF
fk init >/dev/null
fk gates build >/dev/null
fk config set check "$CHECK" >/dev/null
fk config set protected_extra scripts/fk-boundaries.mjs >/dev/null
[ -n "${RISK_R3:-}" ] && fk config set risk_r3 "$RISK_R3" >/dev/null
"${G[@]}" add -A
"${G[@]}" commit -q --no-verify -m "Adopt founder-kit: gates, decisions, toolchain"

# Post-adoption setup a variant needs (an accepted task, ...): runs after the kit is in place.
if declare -F "after_$FIXTURE" >/dev/null; then "after_$FIXTURE" "$VARIANT"; fi
echo "fixture $FIXTURE${VARIANT:+ ($VARIANT)} ready in $PWD"
