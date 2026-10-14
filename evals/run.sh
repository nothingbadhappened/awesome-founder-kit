#!/usr/bin/env bash
# founder-kit agent-quality A/B: kit vs no plugin vs OMC only, same model and prompts. See evals/README.md.
#
#   evals/run.sh validate          free: prerequisites, suite structure, every fixture scaffold, report self-test,
#                                  and a zero-cost load of each arm (--max-cost-usd 0: cases load, no run starts)
#   evals/run.sh subset            per-PR: T2 T5 T6, 3 runs, kit vs none, no LLM judge (about $8)
#   evals/run.sh full              all cases, 5 runs, kit vs none (+ OMC only when OMC_DIR is set) (about $50)
#   evals/run.sh <mode> -- <extra claude plugin eval options>
#
# Environment: MODEL (agent, default claude-sonnet-5-5), JUDGE_MODEL (default claude-haiku-5-5), RUNS, CONCURRENCY (4),
# MAX_COST_USD (per arm; full 40, subset 12), OMC_DIR (an oh-my-claudecode plugin directory for the OMC arms).
set -euo pipefail

MODE=${1:-}; shift || true
[ "${1:-}" = -- ] && shift
EXTRA=("$@")
EVALS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$EVALS/.." && pwd)
MODEL=${MODEL:-claude-sonnet-5-5}
JUDGE_MODEL=${JUDGE_MODEL:-claude-haiku-5-5}
CONCURRENCY=${CONCURRENCY:-4}
SUBSET=(t2-ci-green t5-formatter t6-post-accept-tweak)
die() { echo "run.sh: $*" >&2; exit 1; }

case "$MODE" in
  validate) RUNS=${RUNS:-1}; COST=0 ;;
  subset) RUNS=${RUNS:-3}; COST=${MAX_COST_USD:-12} ;;
  full) RUNS=${RUNS:-5}; COST=${MAX_COST_USD:-40} ;;
  *) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac

# ---- prerequisites (plain answers when something is missing) ----
ver_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]; }
command -v claude >/dev/null || die "claude is not on PATH (Claude Code 2.1.269 or later)"
command -v node >/dev/null || die "node is not on PATH (the fixtures and the kit need Node.js 20+)"
command -v git >/dev/null || die "git is not on PATH"
CV=$(claude --version | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)
ver_ge "$CV" 2.1.269 || die "Claude Code $CV is too old for plugin evals (2.1.269+): run claude update"
GV=$(git --version | grep -Eo '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -n1)
ver_ge "$GV" 2.31 || die "git $GV is too old: claude plugin eval needs 2.31+ to switch off repository hooks"
case "$(uname -s)" in
  Linux)
    if [ "$MODE" != validate ]; then
      command -v bwrap >/dev/null || die "bubblewrap (bwrap) is missing: the Bash sandbox needs it (sudo apt-get install -y bubblewrap socat)"
      command -v socat >/dev/null || die "socat is missing: the Bash sandbox needs it (sudo apt-get install -y bubblewrap socat)"
    fi
    # The Bash sandbox must inspect every PATH folder; WSL adds Windows folders (/mnt/c/...) that Linux can't always read,
    # and then Claude Code refuses every run. Keep only readable Linux folders.
    CLEAN=""; IFS=: ; for d in $PATH; do case "$d" in /mnt/*|"") continue ;; esac; [ -r "$d" ] && [ -x "$d" ] && CLEAN="${CLEAN:+$CLEAN:}$d"; done; unset IFS
    export PATH="$CLEAN"
    # Docker Desktop's WSL integration links folders inside ~/.docker; the sandbox refuses a credential store with links.
    # The evals never use Docker, so point it at an empty folder for this run only (the real ~/.docker is untouched).
    export DOCKER_CONFIG="$(mktemp -d)" ;;
  Darwin) ;;
  MINGW*|MSYS*|CYGWIN*)
    [ "$MODE" = validate ] || die "native Windows has no Bash sandbox, so every run would be refused. Run this inside WSL2 (see evals/README.md)." ;;
esac
command -v python3 >/dev/null || echo "run.sh: note: python3 not on PATH; the python cases (t3, t7) will run without a working test command"

# ---- arms: copies of evals/cases with the plugins line set per arm (evals/arms/ is generated, gitignored) ----
OMC_REL=""
if [ -n "${OMC_DIR:-}" ]; then
  [ -f "$OMC_DIR/.claude-plugin/plugin.json" ] || die "OMC_DIR=$OMC_DIR has no .claude-plugin/plugin.json"
  # Plugins must sit beneath the eval target (the repo), so OMC is copied in once per version (evals/vendor/ is gitignored).
  if ! cmp -s "$OMC_DIR/.claude-plugin/plugin.json" "$EVALS/vendor/omc/.claude-plugin/plugin.json"; then
    echo "run.sh: copying OMC from OMC_DIR into evals/vendor/omc"
    rm -rf "$EVALS/vendor/omc" && mkdir -p "$EVALS/vendor/omc"
    (cd "$OMC_DIR" && tar --exclude=.git -cf - .) | (cd "$EVALS/vendor/omc" && tar -xf -)
  fi
  OMC_REL='"../../../vendor/omc"'
fi
build_arm() { # build_arm <arm> <plugins list> <judge on|off> <case>...
  local arm=$1 plugins=$2 judge=$3; shift 3
  rm -rf "$EVALS/arms/$arm" && mkdir -p "$EVALS/arms/$arm"
  for c in "$@"; do
    cp -R "$EVALS/cases/$c" "$EVALS/arms/$arm/$c"
    sed -i.bak "s#^plugins: .*#plugins: [$plugins]#" "$EVALS/arms/$arm/$c/prompt.md" && rm -f "$EVALS/arms/$arm/$c/prompt.md.bak"
    [ "$judge" = on ] || rm -f "$EVALS/arms/$arm/$c/graders/q-judge.md"
  done
  node "$EVALS/check-suite.mjs" "$EVALS/arms/$arm" >/dev/null || node "$EVALS/check-suite.mjs" "$EVALS/arms/$arm"
}
rm -rf "$EVALS/arms"   # never run a stale arm left by an earlier mode
ALL=(); for d in "$EVALS"/cases/t*/; do ALL+=("$(basename "$d")"); done
if [ "$MODE" = subset ]; then CASES=("${SUBSET[@]}"); JUDGE=off; else CASES=("${ALL[@]}"); JUDGE=on; fi
KIT_PLUGINS='"../../../../plugins/founder-kit"'
[ -n "$OMC_REL" ] && [ "$MODE" != subset ] && KIT_PLUGINS="$KIT_PLUGINS, $OMC_REL"
build_arm kit "$KIT_PLUGINS" "$JUDGE" "${CASES[@]}"
[ -n "$OMC_REL" ] && [ "$MODE" != subset ] && build_arm omc "$OMC_REL" "$JUDGE" "${CASES[@]}"

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$EVALS/results/$STAMP-$MODE"
mkdir -p "$OUT"
# Flags verified against `claude plugin eval --help` (2.1.299) and code.claude.com/docs/en/plugin-evals.
eval_arm() { # eval_arm <arm> <ablation>
  local arm=$1 ablation=$2 code=0
  echo "run.sh: arm $arm (ablation $ablation, $RUNS run(s) per case, model $MODEL, judge $JUDGE_MODEL, ceiling \$$COST)"
  (cd "$ROOT" && claude plugin eval . \
    --eval-dir "evals/arms/$arm" \
    --ablation "$ablation" \
    --scaffold --trust-plugin \
    --runs "$RUNS" --concurrency "$CONCURRENCY" \
    --model "$MODEL" --judge-model "$JUDGE_MODEL" \
    --max-cost-usd "$COST" --threshold 0 \
    --no-publish --output-dir "$OUT/$arm" \
    --json "$OUT/$arm.json" \
    ${EXTRA[@]+"${EXTRA[@]}"} \
    --allow-tools Bash Write Edit) || code=$?
  echo "run.sh: arm $arm exited $code"
  return 0
}

if [ "$MODE" = validate ]; then
  echo "== suite structure"; node "$EVALS/check-suite.mjs" "$EVALS/cases"
  echo "== report scoring"; node "$EVALS/report.mjs" --self-test
  echo "== fixtures (scaffolds in an eval-like layout: <tmp>/home/cwd, HOME=<tmp>/home)"
  T=$(mktemp -d)
  for c in "${ALL[@]}"; do
    mkdir -p "$T/$c/home/cwd"
    if (cd "$T/$c/home/cwd" && HOME="$T/$c/home" bash "$EVALS/cases/$c/scaffold.sh" > "$T/$c.log" 2>&1); then
      echo "  ok   $c: $(tail -n1 "$T/$c.log")"
    else echo "  FAIL $c:"; sed 's/^/       /' "$T/$c.log"; exit 1; fi
  done
  rm -rf "$T"
  # The ceiling is checked before each run starts (spent >= ceiling), so with 0 nothing starts. Every case file is
  # still parsed and schema-checked (frontmatter keys, grader types and targets), and the plugins: lines resolve.
  echo "== zero-cost load of each arm (--max-cost-usd 0: every case is loaded and checked, no agent run starts)"
  for arm in kit omc; do
    [ -d "$EVALS/arms/$arm" ] || continue
    code=0
    (cd "$ROOT" && claude plugin eval . --eval-dir "evals/arms/$arm" --ablation "$([ "$arm" = kit ] && echo with-without || echo none)" \
      --scaffold --trust-plugin --runs 1 --max-cost-usd 0 --threshold 0 --no-publish --output-dir "$OUT/$arm" \
      --allow-tools Bash Write Edit) > "$OUT/$arm-load.txt" 2>&1 || code=$?
    sed 's/^/  /' "$OUT/$arm-load.txt" | grep -v '^  *$'
    n=$(ls -d "$EVALS/arms/$arm"/t*/ | wc -l | tr -d ' ')
    if [ "$code" -ne 2 ] || grep -q 'failed to load' "$OUT/$arm-load.txt" || { [ "$arm" = kit ] && ! grep -q "2 arms × $n cases" "$OUT/$arm-load.txt"; }; then
      die "arm $arm: expected all $n cases to load and the run to stop at the \$0 ceiling (exit 2), got exit $code"
    fi
  done
  echo "run.sh: validate OK (nothing was spent)"
  exit 0
fi

eval_arm kit with-without
[ -d "$EVALS/arms/omc" ] && eval_arm omc none
echo
node "$EVALS/report.mjs" "$OUT/kit.json" $([ -f "$OUT/omc.json" ] && echo "$OUT/omc.json") | tee "$OUT/report.txt"
