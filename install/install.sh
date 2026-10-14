#!/usr/bin/env bash
# Founder Kit installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/nothingbadhappened/awesome-founder-kit/main/install/install.sh | bash
#
# Options (after `bash -s --` when piped): --yes (no question, for CI)  --dry-run (print the commands only)
# (--with-gh is accepted and changes nothing: the GitHub CLI is a base tool now.)
#   --uninstall [--keep <ids>] [--only <ids>] [--plugin-only]: take back what Founder Kit installed (fk uninstall --system;
#   piped: FK_UNINSTALL=1). Only the founder runs it, in a terminal.
#
# Checks every base tool, prints one plan, asks once, installs what is missing (into your home folder where the
# tool allows), configures, verifies, then adds the founder-kit plugin. Re-running is safe: present tools are left
# alone, nothing is uninstalled or downgraded. Every change is logged to ~/.fk/install-ledger.jsonl with its undo
# command, and what was already here is logged as pre-existing (never removed by the kit).
# Versions mirror plugins/founder-kit/compat.lock.json (a test fails when they drift).
set -u

YES=0; DRY=0; UNINSTALL=0; UN_ARGS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y) YES=1 ;;
    --dry-run) DRY=1 ;;
    --with-gh) ;;
    --uninstall) UNINSTALL=1 ;;
    --plugin-only) UN_ARGS="$UN_ARGS --plugin-only" ;;
    --keep|--only) [ $# -ge 2 ] || { echo "usage: install.sh $1 <ids>"; exit 2; }; UN_ARGS="$UN_ARGS $1 $2"; shift ;;
    *) echo "usage: install.sh [--yes] [--dry-run] | install.sh --uninstall [--dry-run] [--yes] [--keep <ids>] [--only <ids>] [--plugin-only]"; exit 2 ;;
  esac
  shift
done
[ "${FK_YES:-}" = 1 ] && YES=1
[ "${FK_DRY_RUN:-}" = 1 ] && DRY=1
[ "${FK_UNINSTALL:-}" = 1 ] && UNINSTALL=1

# ---- pins (compat.lock.json, checked 2026-10-14) ----
LOCK_CHECKED=2026-10-14
NODE_VERSION=24.21.0
UV_VERSION=0.13.0
CLAUDE_VERSION=2.1.296
CBM_VERSION=0.11.0
MEMPALACE_VERSION=3.10.0
SKILLSPECTOR_COMMIT=b07f181d9138878c3827de0947a9fd2c6a84a66c
SKILLSPECTOR_PYTHON=3.12
GITLEAKS_VERSION=8.30.1
OMC_VERSION=5.7.2
GIT_LFS_VERSION=3.8.0
MISE_VERSION=2026.9.18
JUST_VERSION=1.58.0
GH_VERSION=2.102.0
PODMAN_VERSION=5.8.3
PODMAN_COMPOSE_VERSION=1.6.0
MACHINE_CPUS=2
MACHINE_MEMORY=2048
min_of() {
  case "$1" in
    git) echo 2.30.0 ;; node) echo 20.0.0 ;; uv) echo 0.5.0 ;; claude-code) echo 2.1.0 ;; gh) echo 2.40.0 ;;
    codebase-memory-mcp) echo 0.9.0 ;; mempalace) echo 3.10.0 ;; skillspector) echo 2.11.0 ;; gitleaks) echo 8.19.0 ;;
    git-lfs) echo 3.0.0 ;; mise) echo 2024.1.0 ;; just) echo 1.15.0 ;; podman) echo 4.9.0 ;; podman-compose) echo 1.0.6 ;; *) echo "" ;;
  esac
}
pin_of() {
  case "$1" in
    node) echo "$NODE_VERSION" ;; uv) echo "$UV_VERSION" ;; claude-code) echo "$CLAUDE_VERSION" ;; codebase-memory-mcp) echo "$CBM_VERSION" ;;
    mempalace) echo "$MEMPALACE_VERSION" ;; skillspector) echo "$SKILLSPECTOR_COMMIT" ;; gitleaks) echo "$GITLEAKS_VERSION" ;;
    oh-my-claudecode) echo "$OMC_VERSION" ;; git-lfs) echo "$GIT_LFS_VERSION" ;; mise) echo "$MISE_VERSION" ;; just) echo "$JUST_VERSION" ;;
    gh) echo "$GH_VERSION" ;; podman) echo "$PODMAN_VERSION" ;; podman-compose) echo "$PODMAN_COMPOSE_VERSION" ;; *) echo "" ;;
  esac
}
OMC_MARKETPLACE=Yeachan-Heo/oh-my-claudecode;    OMC_PLUGIN=oh-my-claudecode@omc
MP_MARKETPLACE=MemPalace/mempalace;               MP_PLUGIN=mempalace@mempalace
FK_MARKETPLACE=nothingbadhappened/awesome-founder-kit; FK_PLUGIN=founder-kit@awesome-founder-kit
CBM_RAW=https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/v$CBM_VERSION
CBM_BASE=https://github.com/DeusData/codebase-memory-mcp/releases/download/v$CBM_VERSION
ARCH='OS=$(uname -s | tr A-Z a-z); A=$(uname -m); case "$A" in x86_64|amd64) A=x64;; aarch64|arm64) A=arm64;; esac'

FK_HOME="${FK_HOME:-$HOME/.fk}"
LEDGER="$FK_HOME/install-ledger.jsonl"
STATUS_FILE="$FK_HOME/state/base-tools.json"
PALACE_HOME="$FK_HOME/palace-home"
PLUGINS="$HOME/.claude/plugins"
case "$(uname -s)" in Darwin) OSN=mac ;; *) OSN=linux ;; esac

if [ -t 1 ]; then G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; C=$'\033[36m'; D=$'\033[2m'; N=$'\033[0m'; else G= Y= R= C= D= N=; fi

refresh_path() {
  for d in "$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin; do
    case ":$PATH:" in *":$d:"*) ;; *) [ -d "$d" ] && PATH="$d:$PATH" ;; esac
  done
  export PATH
}
has() { command -v "$1" >/dev/null 2>&1; }
ver() { # ver <bin> [args...] -> x.y.z or empty
  has "$1" || return 0
  "$@" 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n1
}
at_least() { # at_least <have> <min>
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -t. -k1,1n -k2,2n -k3,3n | head -n1)" = "$2" ]
}
plugin_installed() { grep -q "\"$1@" "$PLUGINS/installed_plugins.json" 2>/dev/null; }
marketplace_added() { grep -qi "\"repo\": *\"$1\"" "$PLUGINS/known_marketplaces.json" 2>/dev/null; }
json_esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
tilde() { case "$1" in "$HOME"/*) printf '~/%s' "${1#"$HOME"/}" ;; *) printf '%s' "$1" ;; esac; }

# What one install step is, for the install ledger and `fk uninstall --system`: the rules of
# plugins/founder-kit/bin/cmd/setup/ledger.mjs describe() (a test keeps them in step). Prints JSON members.
ledger_meta() { # ledger_meta <tool> <action> <cmd> <rollback>
  local t="$1" a="$2" c="$3" rb="$4" item="$1" kind=installed how=other scope=user undo="" paths="" extra="" m
  [ "$a" = upgrade ] && kind=upgraded
  case "$c" in
    "claude plugin marketplace add "*) item="$t:marketplace"; kind=installed; how="claude plugin"; case "$rb" in "claude plugin marketplace remove "*) undo="$rb" ;; esac ;;
    "claude plugin install "*) item="$t:plugin"; kind=installed; how="claude plugin"; undo="claude plugin uninstall ${c#claude plugin install }" ;;
    "claude plugin update "*|"claude plugin marketplace update "*) item="$t:plugin"; kind=upgraded; how="claude plugin" ;;
    "npm i -g "*) kind=upgraded; how=npm ;;
    "brew install "*) how=brew; scope=machine; undo="brew uninstall ${c#brew install }" ;;
    *"apt-get install -y "*) how=apt; scope=machine; undo="sudo apt-get remove -y ${c##*install -y }" ;;
    *"dnf install -y "*) how=dnf; scope=machine; undo="sudo dnf remove -y ${c##*install -y }" ;;
    *"pacman -S --noconfirm "*) how=pacman; scope=machine; undo="sudo pacman -R --noconfirm ${c##*--noconfirm }" ;;
    "mise use -g "*) how=mise; m=${c#mise use -g }; undo="mise unuse -g ${m%%@*}" ;;
    "uv tool install "*) how=uv; case "$rb" in "uv tool uninstall "*) undo="$rb" ;; *) undo="uv tool uninstall $t" ;; esac ;;
    "xcode-select --install"*) how=xcode-select; scope=machine ;;
    "git lfs install"*) item=git-lfs:config; kind=configured; how="git config"; undo="git lfs uninstall" ;;
    "codebase-memory-mcp config set "*) m=${c#codebase-memory-mcp config set }; item="codebase-memory-mcp:${m%% *}"; kind=configured; how="codebase-memory-mcp config"; undo="$rb"; extra=",\"value\":\"${m#* }\"" ;;
    "podman machine init"*) item=podman:machine; kind=configured; how="podman machine"; undo="podman machine rm -f podman-machine-default"; extra=',"name":"podman-machine-default"' ;;
    "podman machine start"*) item=podman:machine-start; kind=runtime; how="podman machine" ;;
    *"mempalace init "*) item=mempalace:palace; kind=data; how="mempalace init"; m=${c##* \'}; m=$(tilde "${m%\'}"); undo="delete the folder $m"; paths="\"$m\"" ;;
    "node -e "*silent_save*) item=mempalace:silent-save; kind=configured; how="mempalace config"; undo='remove "hooks.silent_save" from the MemPalace config.json'
      m=${c##*\' \'}; extra=",\"fn\":\"silent-save\",\"file\":\"$(json_esc "$(tilde "${m%\'}")")\"" ;;
    *astral.sh/uv/*) how=script; paths='"~/.local/bin/uv","~/.local/bin/uvx"'; undo="remove ~/.local/bin/uv ~/.local/bin/uvx" ;;
    *claude.ai/install.*) how=script; paths='"~/.local/bin/claude"'; undo="remove ~/.local/bin/claude" ;;
    *mise.run*) how=script; paths='"~/.local/bin/mise"'; undo="remove ~/.local/bin/mise" ;;
    *nodejs.org/dist*) how=script; paths="\"~/.local/share/fk/node-v$NODE_VERSION\",\"~/.local/bin/node\",\"~/.local/bin/npm\",\"~/.local/bin/npx\""
      undo="remove ~/.local/share/fk/node-v$NODE_VERSION ~/.local/bin/node ~/.local/bin/npm ~/.local/bin/npx" ;;
    *gitleaks/releases/download*) how=script; paths='"~/.local/bin/gitleaks"'; undo="remove ~/.local/bin/gitleaks" ;;
    *codebase-memory-mcp/v*/install.*) how=script; undo="codebase-memory-mcp uninstall -y" ;;
    "echo "*) kind=runtime; how=manual ;;
    *) [ "$a" = configure ] && kind=configured; [ "$rb" != - ] && undo="$rb" ;;
  esac
  [ "$kind" = upgraded ] && undo=""
  [ -n "$paths" ] && extra="$extra,\"paths\":[$paths]"
  if [ -n "$undo" ]; then undo="\"$(json_esc "$undo")\""; else undo=null; fi
  printf '"item":"%s","kind":"%s","how":"%s","scope":"%s","undo":%s%s' "$item" "$kind" "$how" "$scope" "$undo" "$extra"
}

# Hands over to the kit's own uninstaller (fk uninstall --system); without Node.js or the plugin, lists the recorded
# undo commands instead (newest line per item) and removes nothing.
uninstall_kit() {
  if [ "${CLAUDE_CODE_CHILD_SESSION:-}" = 1 ]; then
    echo "Founder Kit uninstall: refused: only you can take the kit out. Run it yourself in a terminal outside Claude Code."; exit 1
  fi
  local fk_path="" a="--system"
  [ "$DRY" = 1 ] && a="$a --dry-run"; [ "$YES" = 1 ] && a="$a --yes"
  has node && fk_path=$(node -e "const j=require(process.argv[1]);const e=[].concat(j.plugins['founder-kit@awesome-founder-kit']||[])[0]||{};console.log(e.installPath||'')" "$PLUGINS/installed_plugins.json" 2>/dev/null)
  if [ -n "$fk_path" ] && [ -f "$fk_path/bin/fk.mjs" ]; then
    # shellcheck disable=SC2086
    if [ "$YES" != 1 ] && [ "$DRY" != 1 ] && [ -r /dev/tty ]; then node "$fk_path/bin/fk.mjs" uninstall $a $UN_ARGS < /dev/tty; else node "$fk_path/bin/fk.mjs" uninstall $a $UN_ARGS; fi
    exit $?
  fi
  [ -f "$LEDGER" ] || { echo "Founder Kit uninstall: there is no install list ($LEDGER), so the kit installed nothing here that it knows of. Nothing was changed."; exit 0; }
  echo "The kit's own uninstaller is not available (Node.js or the founder-kit plugin is missing), so nothing was removed."
  echo "These are the undo commands recorded when the kit installed or changed things; run the ones you want yourself:"
  awk 'function f(l, k,  m) { if (match(l, "\"" k "\":\"[^\"]*\"")) { m = substr(l, RSTART, RLENGTH); sub("^\"" k "\":\"", "", m); sub("\"$", "", m); return m } return "" }
    { a[NR] = $0 } END { for (i = NR; i > 0; i--) { l = a[i]; if (l ~ /"ok":false/) continue; it = f(l, "item"); if (it == "" || seen[it]++) continue
      k = f(l, "kind"); u = f(l, "undo"); if ((k == "installed" || k == "configured" || k == "data") && u != "") print "  " it ": " u } }' "$LEDGER"
  exit 0
}

# Plan rows: parallel arrays. Steps: "id<TAB>action<TAB>cmd<TAB>rollback" lines.
# FOUNDERS: a JSON object per row for a step only the founder can take (empty when none).
IDS=(); LABELS=(); LEVELS=(); REASONS=(); VERSIONS=(); NOTES=(); SIZES=(); WHYS=(); FOUNDERS=(); FOUNDS=(); STEPS=""
PODMAN_ENGINE=""; PODMAN_MACHINE=null
row() { IDS+=("$1"); LABELS+=("$2"); SIZES+=("$3"); WHYS+=("$4"); VERSIONS+=("$5"); LEVELS+=(green); REASONS+=(ok); NOTES+=(""); FOUNDERS+=(""); FOUNDS+=(""); }
# found <item>: already here before this run (the ledger records it once as pre-existing; never removed by the kit).
found() { local i; i=$(last); FOUNDS[$i]="${FOUNDS[$i]} $1"; }
last() { echo $(( ${#IDS[@]} - 1 )); }
set_red() { local i; i=$(last); LEVELS[$i]=red; REASONS[$i]="$1"; NOTES[$i]="$2"; }
step() { STEPS="$STEPS$1	$2	$3	$4
"; }
grade() { # grade <id> <install-cmd> <rollback>
  local i v m; i=$(last); v="${VERSIONS[$i]}"; m=$(min_of "$1")
  if [ -z "$v" ]; then set_red missing "not installed"; step "$1" install "$2" "$3"
  elif [ -n "$m" ] && ! at_least "$v" "$m"; then set_red below-floor "older than the minimum $m"; step "$1" upgrade "$2" "$3"; fi
}
pkg_grade() { # pkg_grade <id> <package> <fallback message> [pacman package]: OS package managers (no version pins there)
  local p="${4:-$2}"
  if [ "$OSN" = mac ]; then
    if has brew; then grade "$1" "brew install $2" "brew uninstall $2"; else grade "$1" "echo '$3 (or install Homebrew first)' && exit 1" "-"; fi
  elif has apt-get; then grade "$1" "sudo apt-get update && sudo apt-get install -y $2" "sudo apt-get remove $2"
  elif has dnf; then grade "$1" "sudo dnf install -y $2" "sudo dnf remove $2"
  elif has pacman; then grade "$1" "sudo pacman -S --noconfirm $p" "sudo pacman -R $p"
  else grade "$1" "echo '$3' && exit 1" "-"; fi
}
plugin_steps() { # plugin_steps <id> <marketplace repo> <plugin> <marketplace name>
  marketplace_added "$2" || step "$1" install "claude plugin marketplace add $2" "claude plugin marketplace remove $4"
  plugin_installed "${3%@*}" || step "$1" install "claude plugin install $3" "claude plugin uninstall $3"
}
mempalace_dir() {
  if [ -n "${MEMPALACE_CONFIG_DIR:-}" ]; then echo "$MEMPALACE_CONFIG_DIR"; return; fi
  for f in config.json people_map.json palace/chroma.sqlite3; do [ -e "$HOME/.mempalace/$f" ] && { echo "$HOME/.mempalace"; return; }; done
  case "${XDG_CONFIG_HOME:-}" in /*) echo "$XDG_CONFIG_HOME/mempalace"; return ;; esac
  echo "$HOME/.config/mempalace"
}

state() {
  IDS=(); LABELS=(); LEVELS=(); REASONS=(); VERSIONS=(); NOTES=(); SIZES=(); WHYS=(); FOUNDERS=(); FOUNDS=(); STEPS=""
  PODMAN_ENGINE=""; PODMAN_MACHINE=null
  local i cmd

  row git git "about 300 MB" "keeps every version of your project, so nothing is ever lost" "$(ver git --version)"
  if [ "$OSN" = mac ]; then
    if has brew; then grade git "brew install git" "brew uninstall git"; else grade git "xcode-select --install" "leave in place (Apple developer tools)"; fi
  elif has apt-get; then grade git "sudo apt-get update && sudo apt-get install -y git" "sudo apt-get remove git"
  elif has dnf; then grade git "sudo dnf install -y git" "sudo dnf remove git"
  else grade git "echo 'Install git with your system package manager' && exit 1" "-"; fi

  row git-lfs "Git LFS" "about 15 MB" "keeps big files (images, audio, game assets) out of the way so the project stays fast to copy" "$(ver git-lfs version)"
  pkg_grade git-lfs git-lfs "Install Git LFS from https://git-lfs.com"
  i=$(last)
  if [ -z "${VERSIONS[$i]}" ] || [ -z "$(git config --global --get filter.lfs.process 2>/dev/null)" ]; then
    step git-lfs configure "git lfs install" "git lfs uninstall"
    if [ -n "${VERSIONS[$i]}" ] && [ "${LEVELS[$i]}" != red ]; then set_red not-configured "not switched on for your user yet (git lfs install)"; fi
  else found git-lfs:config
  fi

  row node Node.js "about 100 MB" "runs the kit's safety checks" "$(ver node --version)"
  grade node "set -e; V=$NODE_VERSION; $ARCH; D=\"\$HOME/.local/share/fk/node-v\$V\"; mkdir -p \"\$D\" \"\$HOME/.local/bin\"; curl -fsSL \"https://nodejs.org/dist/v\$V/node-v\$V-\$OS-\$A.tar.gz\" | tar -xz -C \"\$D\" --strip-components=1; for b in node npm npx; do ln -sf \"\$D/bin/\$b\" \"\$HOME/.local/bin/\$b\"; done" \
    "rm -rf ~/.local/share/fk/node-v$NODE_VERSION ~/.local/bin/node ~/.local/bin/npm ~/.local/bin/npx"

  row uv uv "about 40 MB" "installs the Python helpers below, each in its own sealed box" "$(ver uv --version)"
  grade uv "curl -LsSf https://astral.sh/uv/$UV_VERSION/install.sh | sh" "rm ~/.local/bin/uv ~/.local/bin/uvx"

  row mise mise "about 30 MB" "pins each project's tool versions, so the project runs the same on any computer" "$(ver mise --version)"
  if [ "$OSN" = mac ] && has brew; then grade mise "brew install mise" "brew uninstall mise"
  else grade mise "curl -fsSL https://mise.run | MISE_VERSION=v$MISE_VERSION sh" "rm ~/.local/bin/mise"; fi
  # mise here, or installed by the step above in this run: just and gh come pinned through it (steps run in plan order).
  local mise_ok=""; { has mise || [ "${LEVELS[$(last)]}" = red ]; } && mise_ok=1

  local jv; jv=$(ver just --version)
  [ -z "$jv" ] && has mise && jv=$(ver mise exec -- just --version)
  row just just "about 5 MB" "one short command for each job (just setup, just check), the same on every computer" "$jv"
  if [ -n "$mise_ok" ]; then grade just "mise use -g just@$JUST_VERSION" "mise unuse -g just"
  else pkg_grade just just "Install just with: mise use -g just@$JUST_VERSION"; fi

  # An older gh on PATH (apt) does not hide the pinned one mise installed.
  local gv mv gh_cmd="gh auth login"; gv=$(ver gh --version)
  if has mise && { [ -z "$gv" ] || ! at_least "$gv" "$(min_of gh)"; }; then
    mv=$(ver mise exec -- gh --version)
    if [ -n "$mv" ] && { [ -z "$gv" ] || ! at_least "$gv" "$mv"; }; then gv=$mv; gh_cmd="mise exec -- gh auth login"; fi
  fi
  row gh "GitHub CLI" "about 40 MB" "lets Claude publish your project to GitHub and run its checks there" "$gv"
  # apt ships gh below the floor (Ubuntu 22.04: 2.4.0): mise installs the pinned release. Homebrew is current.
  if [ -n "$mise_ok" ] && ! { [ "$OSN" = mac ] && has brew; }; then grade gh "mise use -g gh@$GH_VERSION" "mise unuse -g gh"; [ "${LEVELS[$(last)]}" = red ] && gh_cmd="mise exec -- gh auth login"
  else pkg_grade gh gh "Install gh from https://cli.github.com" github-cli; fi
  i=$(last)
  if [ -z "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ] && ! grep -q github.com "${GH_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/gh}/hosts.yml" 2>/dev/null; then
    FOUNDERS[$i]="{\"id\":\"gh-auth\",\"blocking\":false,\"cmd\":\"$gh_cmd\",\"text\":\"Sign the GitHub CLI in to your account: in a terminal run \`$gh_cmd\` and follow the steps (it opens your browser).\"}"
    [ "${LEVELS[$i]}" = green ] && NOTES[$i]="not signed in yet (your step: $gh_cmd)"
  fi

  # Containers: Podman, or a Docker that is already here (kept; Podman is never added next to it).
  local pv dv=""; pv=$(ver podman --version); [ -z "$pv" ] && dv=$(ver docker --version)
  if [ -n "$dv" ]; then
    row podman "Containers (Docker)" "about 1-2 GB with its small Linux machine" "runs databases and other services in sealed boxes, so nothing is installed into your computer itself" "$dv"
    PODMAN_ENGINE=docker; NOTES[$(last)]="Docker found; kept (Podman is not added next to it)"
  else
    row podman "Containers (Podman)" "about 1-2 GB with its small Linux machine" "runs databases and other services in sealed boxes, so nothing is installed into your computer itself" "$pv"
    [ -n "$pv" ] && PODMAN_ENGINE=podman
    if [ "$OSN" = linux ] && has apt-get && [ -n "$pv" ] && ! at_least "$pv" "$(min_of podman)"; then
      # apt already gave its newest Podman: planning the same apt command again changes nothing. The founder decides.
      i=$(last); LEVELS[$i]=yellow; REASONS[$i]=distro-old
      NOTES[$i]="Your Linux ships Podman $pv; Podman ≥4.9 needs Ubuntu 24.04+/Debian 13+ or packages from podman.io."
      FOUNDERS[$i]="{\"id\":\"podman-old\",\"blocking\":false,\"cmd\":\"-\",\"text\":\"${NOTES[$i]}\"}"
    else pkg_grade podman podman "Install Podman from https://podman.io"; fi
    # The machine comes after Podman itself; without Homebrew the founder installs Podman by hand first.
    if [ "$OSN" = mac ] && { [ -n "$pv" ] || has brew; }; then
      i=$(last); local ml="" exists=false running=false
      [ -n "$pv" ] && ml=$(podman machine list --format json 2>/dev/null)
      printf '%s' "$ml" | grep -q '"Name"' && exists=true
      printf '%s' "$ml" | grep -Eq '"Running": *true' && running=true
      PODMAN_MACHINE="{\"exists\":$exists,\"running\":$running}"
      [ "$exists" = true ] && found podman:machine
      if [ "$exists" = false ]; then
        step podman configure "podman machine init --cpus $MACHINE_CPUS --memory $MACHINE_MEMORY" "ask the founder first; then: podman machine rm podman-machine-default"
        step podman configure "podman machine start" "podman machine stop"
        if [ "${LEVELS[$i]}" != red ]; then set_red not-configured "no Podman machine yet (the small Linux machine containers run in; about 1 GB to download)"; fi
      fi
    fi
  fi

  if [ -n "$dv" ] || has docker-compose; then
    row podman-compose "Compose for Podman" "about 10 MB" "starts all of a project's services with one command (podman compose up)" ""
    REASONS[$(last)]=not-needed
    if [ -n "$dv" ]; then NOTES[$(last)]="not needed: Docker brings its own compose"; else NOTES[$(last)]="docker-compose found; podman compose uses it"; fi
  else
    row podman-compose "Compose for Podman" "about 10 MB" "starts all of a project's services with one command (podman compose up)" "$(ver podman-compose --version)"
    grade podman-compose "uv tool install podman-compose==$PODMAN_COMPOSE_VERSION" "uv tool uninstall podman-compose"
  fi

  row claude-code "Claude Code" "about 200 MB" "the AI assistant the kit runs inside" "$(ver claude --version)"
  grade claude-code "curl -fsSL https://claude.ai/install.sh | bash -s $CLAUDE_VERSION" "rm ~/.local/bin/claude"

  row oh-my-claudecode oh-my-claudecode "about 20 MB" "the agent team and workflow the kit builds on" ""
  i=$(last)
  marketplace_added "$OMC_MARKETPLACE" && found oh-my-claudecode:marketplace
  if plugin_installed oh-my-claudecode; then
    found oh-my-claudecode:plugin
    VERSIONS[$i]=$( (has node && node -e "const j=require(process.argv[1]);const k=Object.keys(j.plugins).find(k=>k.startsWith('oh-my-claudecode@'));const e=[].concat(j.plugins[k])[0]||{};let v=e.version;try{v=require(require('path').join(e.installPath,'.claude-plugin','plugin.json')).version||v}catch{}console.log(v||'')" "$PLUGINS/installed_plugins.json") 2>/dev/null)
    local latest floor
    latest=${FK_OMC_LATEST:-}
    [ -n "$latest" ] || latest=$(curl -fsS --max-time 5 https://registry.npmjs.org/oh-my-claude-sisyphus/latest 2>/dev/null | grep -Eo '"version":"[0-9.]+"' | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)
    latest=${latest:-$OMC_VERSION}
    floor="$(( ${latest%%.*} > 0 ? ${latest%%.*} - 1 : 0 )).0.0"
    if [ -n "${VERSIONS[$i]}" ] && ! at_least "${VERSIONS[$i]}" "$floor"; then
      set_red below-floor "below the supported floor $floor"
      step oh-my-claudecode upgrade "claude plugin marketplace update omc" "-"
      step oh-my-claudecode upgrade "claude plugin update $OMC_PLUGIN" "reinstall the previous version from /plugin"
    fi
  else
    # npm mode is supported; adding the plugin copy too would fire OMC's hooks twice, so it is never added here.
    VERSIONS[$i]=$(ver omc --version)
    [ -n "${VERSIONS[$i]}" ] && found oh-my-claudecode
    if [ -z "${VERSIONS[$i]}" ]; then set_red missing "not installed"; plugin_steps oh-my-claudecode "$OMC_MARKETPLACE" "$OMC_PLUGIN" omc
    elif at_least "${VERSIONS[$i]}" "$(( ${OMC_VERSION%%.*} - 1 )).0.0"; then LEVELS[$i]=yellow; REASONS[$i]=npm; NOTES[$i]="npm install: supported; plugin mode optional"
    else set_red below-floor "npm install below the supported floor"; step oh-my-claudecode upgrade "npm i -g oh-my-claude-sisyphus@$OMC_VERSION" "npm i -g <the previous version>"; fi
  fi

  row codebase-memory-mcp codebase-memory "about 40 MB" "gives Claude a map of your code so it reads less and costs less" "$(ver codebase-memory-mcp --version)"
  grade codebase-memory-mcp "mkdir -p ~/.local/bin && chmod go-w ~/.local/bin && curl -fsSL $CBM_RAW/install.sh | CBM_DOWNLOAD_URL=$CBM_BASE bash" "codebase-memory-mcp uninstall -y"
  i=$(last)
  for key in auto_index auto_watch; do
    local have=""
    [ -n "${VERSIONS[$i]}" ] && have=$(codebase-memory-mcp config get "$key" 2>/dev/null | tr -d '[:space:]')
    [ -n "${VERSIONS[$i]}" ] && [ "$have" = false ] && { found "codebase-memory-mcp:$key"; continue; }
    step codebase-memory-mcp configure "codebase-memory-mcp config set $key false" "codebase-memory-mcp config set $key true"
    if [ -n "${VERSIONS[$i]}" ] && [ "${LEVELS[$i]}" != red ]; then set_red not-configured "$key is ${have:-not set}; the kit keeps it false so indexing runs only when asked"; fi
  done

  row mempalace MemPalace "about 500 MB" "remembers decisions between sessions, on your machine only" "$(ver mempalace --version)"
  grade mempalace "uv tool install mempalace==$MEMPALACE_VERSION" "uv tool uninstall mempalace"
  i=$(last)
  plugin_installed mempalace && found mempalace:plugin
  marketplace_added "$MP_MARKETPLACE" && found mempalace:marketplace
  if ! plugin_installed mempalace || ! marketplace_added "$MP_MARKETPLACE"; then
    plugin_steps mempalace "$MP_MARKETPLACE" "$MP_PLUGIN" mempalace
    [ "${LEVELS[$i]}" != red ] && set_red plugin-missing "the Claude Code plugin is not installed"
  fi
  local mdir cfg palace has_palace notes=""
  mdir=$(mempalace_dir); cfg="$mdir/config.json"; palace="$mdir/palace"
  if [ -f "$cfg" ] && grep -q '"palace_path"' "$cfg"; then palace=$(grep -Eo '"palace_path": *"[^"]*"' "$cfg" | sed 's/.*: *"//; s/"$//'); fi
  # `mempalace init --backend` records the backend; the palace folder itself appears on the first mine or save.
  if [ -e "$palace" ] || grep -q '"backend"' "$cfg" 2>/dev/null; then has_palace=1; else has_palace=; fi
  [ -n "$has_palace" ] && found mempalace:palace
  grep -q '"silent_save"' "$cfg" 2>/dev/null && found mempalace:silent-save
  if [ -z "$has_palace" ]; then
    step mempalace configure "mkdir -p '$PALACE_HOME' && mempalace init --yes --no-llm --backend sqlite_exact '$PALACE_HOME'" \
      "delete the palace folder MemPalace reports in \`mempalace status\` and the backend line in its config.json"
    [ "${LEVELS[$i]}" != red ] && set_red not-configured "no palace yet"
  elif ! grep -q '"backend": *"sqlite_exact"' "$cfg" 2>/dev/null; then
    notes="your existing palace keeps its current backend (switching needs a migration)"
  fi
  if grep -q '"silent_save": *false' "$cfg" 2>/dev/null; then notes="${notes:+$notes; }hooks.silent_save is off (your choice; kept)"
  elif ! grep -q '"silent_save"' "$cfg" 2>/dev/null; then
    step mempalace configure "node -e 'const f=process.argv[1],fs=require(\"fs\");let c={};try{c=JSON.parse(fs.readFileSync(f,\"utf8\"))}catch{}c.hooks=c.hooks||{};if(c.hooks.silent_save===undefined){c.hooks.silent_save=true;fs.mkdirSync(require(\"path\").dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(c,null,2))}' '$cfg'" \
      "remove hooks.silent_save from $cfg"
  fi
  [ -n "${MEMPAL_DIR:-}" ] && notes="${notes:+$notes; }MEMPAL_DIR is set, so MemPalace mines that folder on every save; the kit recommends unsetting it"
  if [ -n "$notes" ]; then [ "${LEVELS[$i]}" = green ] && LEVELS[$i]=yellow; NOTES[$i]="${NOTES[$i]:+${NOTES[$i]}; }$notes"; fi

  row skillspector SkillSpector "about 150 MB" "scans add-ons for malicious instructions before they are used" "$(ver skillspector --version)"
  i=$(last); local re=""; [ -n "${VERSIONS[$i]}" ] && re=" --reinstall"
  grade skillspector "uv tool install --python $SKILLSPECTOR_PYTHON git+https://github.com/NVIDIA/skillspector.git@$SKILLSPECTOR_COMMIT$re" "uv tool uninstall skillspector"

  row gitleaks gitleaks "about 20 MB" "stops passwords and keys from being saved into your project" "$(ver gitleaks version)"
  if [ "$OSN" = mac ] && has brew; then grade gitleaks "brew install gitleaks" "brew uninstall gitleaks"
  else grade gitleaks "set -e; V=$GITLEAKS_VERSION; $ARCH; mkdir -p \"\$HOME/.local/bin\"; curl -fsSL \"https://github.com/gitleaks/gitleaks/releases/download/v\$V/gitleaks_\"\$V\"_\"\$OS\"_\"\$A\".tar.gz\" | tar -xz -C \"\$HOME/.local/bin\" gitleaks" "rm ~/.local/bin/gitleaks"; fi

  row founder-kit "Founder Kit plugin" "about 2 MB" "the founder layer itself" ""
  if plugin_installed founder-kit; then VERSIONS[$(last)]=installed
  else set_red missing "not installed"; plugin_steps founder-kit "$FK_MARKETPLACE" "$FK_PLUGIN" awesome-founder-kit; fi
}

show_table() {
  local i col
  for i in "${!IDS[@]}"; do
    case "${LEVELS[$i]}" in green) col=$G ;; yellow) col=$Y ;; *) col=$R ;; esac
    printf '  %s%-7s%s %-22s %s\n' "$col" "${LEVELS[$i]}" "$N" "${LABELS[$i]}" "$(printf '%s' "${VERSIONS[$i]}${VERSIONS[$i]:+${NOTES[$i]:+, }}${NOTES[$i]}")"
  done
}
idx_of() { local i; for i in "${!IDS[@]}"; do [ "${IDS[$i]}" = "$1" ] && { echo "$i"; return; }; done; }
write_ledger() { # tool action cmd rollback ok
  mkdir -p "$FK_HOME"
  printf '{"ts":"%s","via":"install.sh","tool":"%s","action":"%s","version":"%s","command":"%s","ok":%s,"rollback":"%s",%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "$(pin_of "$1")" "$(json_esc "$3")" "$5" "$(json_esc "$4")" "$(ledger_meta "$1" "$2" "$3" "$4")" >> "$LEDGER"
}
# What was already here before this run: one pre-existing line per item the ledger does not know yet.
write_found() {
  mkdir -p "$FK_HOME"
  local i it items v
  for i in "${!IDS[@]}"; do
    items="${FOUNDS[$i]}"
    case "${IDS[$i]}" in oh-my-claudecode|founder-kit) ;; podman) [ -n "${VERSIONS[$i]}" ] && items="$items ${PODMAN_ENGINE:-podman}" ;; *) [ -n "${VERSIONS[$i]}" ] && items="$items ${IDS[$i]}" ;; esac
    for it in $items; do
      grep -q "\"item\":\"$it\"" "$LEDGER" 2>/dev/null && continue
      v=; case "$it" in *:*) ;; *) v=$(json_esc "${VERSIONS[$i]}") ;; esac # not inside $( ): bash 3.2 (macOS) misparses it
      printf '{"ts":"%s","via":"install.sh","tool":"%s","item":"%s","kind":"pre-existing","action":"found","version":"%s","undo":null,"ok":true}\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${it%%:*}" "$it" "$v" >> "$LEDGER"
    done
  done
}
write_status() {
  mkdir -p "$FK_HOME/state"
  local i sep="" body=""
  for i in "${!IDS[@]}"; do
    local extra=""
    [ "${IDS[$i]}" = podman ] && extra=",\"engine\":\"$PODMAN_ENGINE\",\"machine\":$PODMAN_MACHINE"
    [ -n "${FOUNDERS[$i]}" ] && extra="$extra,\"founder\":[${FOUNDERS[$i]}]"
    body="$body$sep\"${IDS[$i]}\":{\"level\":\"${LEVELS[$i]}\",\"reason\":\"${REASONS[$i]}\",\"version\":\"$(json_esc "${VERSIONS[$i]}")\",\"min\":\"$(min_of "${IDS[$i]}")\",\"note\":\"$(json_esc "${NOTES[$i]}")\"$extra}"
    sep=","
  done
  printf '{"ts":"%s","checked_by":"install.sh","lock_checked":"%s","tools":{%s}}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$LOCK_CHECKED" "$body" > "$STATUS_FILE"
}
show_founder() { # steps only the founder can take: listed, never run
  local i any=""
  for i in "${!IDS[@]}"; do
    [ -n "${FOUNDERS[$i]}" ] || continue
    [ -n "$any" ] || { echo; echo "${Y}Only you can do these (the installer never runs them for you; fk actions lists them too):${N}"; any=1; }
    printf '  - %s\n' "$(printf '%s' "${FOUNDERS[$i]}" | sed 's/.*"text":"//; s/"}$//')"
  done
}
todo_ids() { printf '%s' "$STEPS" | cut -f1 | awk 'NF && !seen[$0]++'; }

[ "$UNINSTALL" = 1 ] && uninstall_kit

echo
echo "${C}Founder Kit setup${N}"
echo "Checking what is already on this computer ($(uname -s) $(uname -m))..."
refresh_path
state
show_table

if [ -z "$STEPS" ]; then
  [ "$DRY" = 1 ] || { write_status; write_found; }
  echo; echo "${G}Everything is already in place.${N}"
  show_founder
else
  echo; echo "Plan (everything below is free and open source):"
  n=0
  for id in $(todo_ids); do
    n=$((n + 1)); i=$(idx_of "$id")
    case "${REASONS[$i]}" in missing) verb=Install ;; below-floor) verb=Update ;; plugin-missing) verb="Add the Claude Code plugin of" ;; *) verb="Set up" ;; esac
    echo "  $n. $verb ${LABELS[$i]} (${SIZES[$i]}): ${WHYS[$i]}."
    printf '%s' "$STEPS" | awk -F'\t' -v id="$id" -v d="$D" -v n="$N" '$1 == id { print "       " d "> " $3 n }'
  done
  echo "  Nothing is uninstalled or downgraded. Every change is logged with its undo command in ~/.fk/install-ledger.jsonl (fk uninstall --system takes it back)."
  printf '%s' "$STEPS" | grep -q 'sudo ' && echo "  Some steps use sudo: your computer password may be asked once."
  show_founder
  if [ "$DRY" = 1 ]; then echo; echo "Dry run: nothing was changed."; exit 0; fi
  if [ "$YES" != 1 ]; then
    if [ -r /dev/tty ]; then printf 'Install and set up these now? [Y/n] '; read -r ans < /dev/tty || ans=n
    else ans=n; echo "No terminal to ask in. Re-run with --yes to install."; fi
    case "$ans" in [nN]*) write_status; echo "Nothing was installed. Run this again whenever you are ready."; exit 1 ;; esac
  fi

  write_found
  failed=""
  while IFS=$'\t' read -r id action cmd rollback; do
    [ -n "$id" ] || continue
    case " $failed " in *" $id "*) continue ;; esac
    i=$(idx_of "$id"); echo; echo "${C}-> ${LABELS[$i]} ${N}${D}$action${N}"
    if bash -c "$cmd" < /dev/null; then ok=true; else ok=false; failed="$failed $id"; echo "${R}   failed: $cmd${N}"; fi
    refresh_path; hash -r
    write_ledger "$id" "$action" "$cmd" "$rollback" "$ok"
  done <<EOF
$STEPS
EOF
  state
  write_status
  echo; echo "${C}Result${N}"
  show_table
  case " $(todo_ids | tr '\n' ' ') " in *" mise "*) echo 'mise: agents run project tools with `mise exec -- <command>`. For your own terminal add to ~/.bashrc (or ~/.zshrc): eval "$(mise activate bash)"' ;; esac
  show_founder
fi

# The user-level `fk` command (~/.local/bin/fk): the kit's own code writes it (fk setup --shim).
if [ "$DRY" != 1 ] && has node && plugin_installed founder-kit; then
  fk_path=$(node -e "const j=require(process.argv[1]);const e=[].concat(j.plugins['founder-kit@awesome-founder-kit']||[])[0]||{};console.log(e.installPath||'')" "$PLUGINS/installed_plugins.json" 2>/dev/null)
  [ -n "$fk_path" ] && node "$fk_path/bin/fk.mjs" setup --shim
fi

red=""
for i in "${!IDS[@]}"; do [ "${LEVELS[$i]}" = red ] && red="$red${red:+, }${LABELS[$i]}"; done
echo
if [ -z "$red" ]; then
  echo "${G}All set.${N}"
  echo "Next: open a new terminal, make an empty folder for your project, run \`claude\` inside it, and say:"
  echo "      ${C}Start my project with fk-start${N}"
  echo "Once, inside Claude Code, also run /oh-my-claudecode:omc-setup if you have not before."
  exit 0
fi
[ "$DRY" = 1 ] && exit 0
echo "${R}Still red: $red.${N} Run this installer again, or open Claude Code and run: fk setup"
exit 1
