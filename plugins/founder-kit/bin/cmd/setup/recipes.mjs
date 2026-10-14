// Install/configure commands per platform for `fk setup`. Versions come only from compat.lock.json.
// install/install.ps1 and install/install.sh carry the same commands for a machine without the kit yet.
// Each step: { cmd, rollback }. cmd runs in PowerShell (win) or bash (mac, linux).

const WINGET = (id, extra = '') =>
  `winget install --id ${id} -e --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity${extra ? ' ' + extra : ''}`;
const ARCH = 'OS=$(uname -s | tr A-Z a-z); A=$(uname -m); case "$A" in x86_64|amd64) A=x64;; aarch64|arm64) A=arm64;; esac';

export function pluginSteps(spec, { marketplaceAdded, pluginInstalled }) {
  const steps = [];
  const mkt = spec.plugin.split('@')[1];
  if (!marketplaceAdded) steps.push({ cmd: `claude plugin marketplace add ${spec.marketplace}`, rollback: `claude plugin marketplace remove ${mkt}` });
  if (!pluginInstalled) steps.push({ cmd: `claude plugin install ${spec.plugin}`, rollback: `claude plugin uninstall ${spec.plugin}` });
  return steps;
}

// os: 'win' | 'mac' | 'linux'. has(bin) tells which package managers exist. upgrade: tool present but below the floor.
export function installSteps(id, lock, os, { has = () => false, upgrade = false } = {}) {
  const t = lock.tools[id];
  const win = os === 'win';
  switch (id) {
    case 'git':
      if (win) return [{ cmd: WINGET('Git.Git'), rollback: 'winget uninstall --id Git.Git' }];
      if (os === 'mac') return has('brew') ? [{ cmd: 'brew install git', rollback: 'brew uninstall git' }]
        : [{ cmd: 'xcode-select --install', rollback: 'leave in place (Apple developer tools)' }];
      if (has('apt-get')) return [{ cmd: 'sudo apt-get update && sudo apt-get install -y git', rollback: 'sudo apt-get remove git' }];
      if (has('dnf')) return [{ cmd: 'sudo dnf install -y git', rollback: 'sudo dnf remove git' }];
      return [{ cmd: 'echo "Install git with your system package manager" && exit 1', rollback: '-' }];
    case 'node':
      if (win) return [{ cmd: WINGET('OpenJS.NodeJS.LTS'), rollback: 'winget uninstall --id OpenJS.NodeJS.LTS' }];
      return [{
        cmd: `set -e; V=${t.version}; ${ARCH}; D="$HOME/.local/share/fk/node-v$V"; mkdir -p "$D" "$HOME/.local/bin"; `
          + 'curl -fsSL "https://nodejs.org/dist/v$V/node-v$V-$OS-$A.tar.gz" | tar -xz -C "$D" --strip-components=1; '
          + 'for b in node npm npx; do ln -sf "$D/bin/$b" "$HOME/.local/bin/$b"; done',
        rollback: `rm -rf ~/.local/share/fk/node-v${t.version} ~/.local/bin/node ~/.local/bin/npm ~/.local/bin/npx`,
      }];
    case 'uv':
      return win
        ? [{ cmd: `irm https://astral.sh/uv/${t.version}/install.ps1 | iex`, rollback: 'Remove-Item $HOME\\.local\\bin\\uv.exe, $HOME\\.local\\bin\\uvx.exe' }]
        : [{ cmd: `curl -LsSf https://astral.sh/uv/${t.version}/install.sh | sh`, rollback: 'rm ~/.local/bin/uv ~/.local/bin/uvx' }];
    case 'claude-code':
      return win
        ? [{ cmd: `& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) ${t.version}`, rollback: 'Remove-Item $HOME\\.local\\bin\\claude.exe' }]
        : [{ cmd: `curl -fsSL https://claude.ai/install.sh | bash -s ${t.version}`, rollback: 'rm ~/.local/bin/claude' }];
    case 'gh':
      if (win) return [{ cmd: WINGET('GitHub.cli'), rollback: 'winget uninstall --id GitHub.cli' }];
      if (has('brew')) return [{ cmd: 'brew install gh', rollback: 'brew uninstall gh' }];
      return [{ cmd: 'echo "Install gh from https://cli.github.com (optional)" && exit 1', rollback: '-' }];
    case 'codebase-memory-mcp': {
      const base = `https://github.com/${t.repo}/releases/download/v${t.version}`;
      const raw = `https://raw.githubusercontent.com/${t.repo}/v${t.version}`;
      return win
        ? [{
          cmd: `$f = Join-Path $env:TEMP 'cbm-install-${t.version}.ps1'; Invoke-WebRequest -UseBasicParsing -Uri ${raw}/install.ps1 -OutFile $f; `
            + `$env:CBM_DOWNLOAD_URL = '${base}'; & powershell -NoProfile -ExecutionPolicy Bypass -File $f; $c = $LASTEXITCODE; Remove-Item $f; exit $c`,
          rollback: 'codebase-memory-mcp uninstall -y',
        }]
        : [{ cmd: `curl -fsSL ${raw}/install.sh | CBM_DOWNLOAD_URL=${base} bash`, rollback: 'codebase-memory-mcp uninstall -y' }];
    }
    case 'mempalace':
      return [{ cmd: `uv tool install mempalace==${t.version}`, rollback: 'uv tool uninstall mempalace' }];
    case 'skillspector':
      return [{
        cmd: `uv tool install --python ${t.python} git+https://github.com/${t.repo}.git@${t.commit}${upgrade ? ' --reinstall' : ''}`,
        rollback: 'uv tool uninstall skillspector',
      }];
    case 'gitleaks':
      if (win) return [{ cmd: WINGET('Gitleaks.Gitleaks', `--version ${t.version}`), rollback: 'winget uninstall --id Gitleaks.Gitleaks' }];
      if (os === 'mac' && has('brew')) return [{ cmd: 'brew install gitleaks', rollback: 'brew uninstall gitleaks' }];
      return [{
        cmd: `set -e; V=${t.version}; ${ARCH}; mkdir -p "$HOME/.local/bin"; `
          + `curl -fsSL "https://github.com/${t.repo}/releases/download/v$V/gitleaks_"$V"_"$OS"_"$A".tar.gz" | tar -xz -C "$HOME/.local/bin" gitleaks`,
        rollback: 'rm ~/.local/bin/gitleaks',
      }];
    default: return [];
  }
}

// The MemPalace palace: created once in a kit-owned empty folder; stdin is closed so init skips its mining prompt.
export function palaceInitStep(lock, os, dir) {
  const backend = lock.tools.mempalace.backend;
  const mk = os === 'win' ? `New-Item -ItemType Directory -Force -Path '${dir}' | Out-Null` : `mkdir -p '${dir}'`;
  const and = os === 'win' ? '; if ($?) {' : ' &&';
  return {
    cmd: `${mk}${and} mempalace init --yes --no-llm --backend ${backend} '${dir}'${os === 'win' ? ' }' : ''}`,
    rollback: `delete the palace folder MemPalace reports in \`mempalace status\` and the "backend" line in its config.json`,
  };
}
