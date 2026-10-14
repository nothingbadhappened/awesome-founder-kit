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
      // apt ships old gh (Ubuntu 22.04: 2.4.0, below the floor): mise installs the pinned release instead. Homebrew is current.
      if (has('mise') && !(os === 'mac' && has('brew'))) return [{ cmd: `mise use -g gh@${t.version}`, rollback: 'mise unuse -g gh' }];
      return pkg('gh', 'gh', os, has, 'Install gh from https://cli.github.com', { pacman: 'github-cli' });
    case 'git-lfs':
      if (win) return [{ cmd: WINGET('GitHub.GitLFS', `--version ${t.version}`), rollback: 'winget uninstall --id GitHub.GitLFS' }];
      return pkg('git-lfs', 'git-lfs', os, has, 'Install Git LFS from https://git-lfs.com');
    case 'mise':
      if (win) return [{ cmd: WINGET('jdx.mise', `--version ${t.version}`), rollback: 'winget uninstall --id jdx.mise' }];
      if (os === 'mac' && has('brew')) return [{ cmd: 'brew install mise', rollback: 'brew uninstall mise' }];
      return [{ cmd: `curl -fsSL https://mise.run | MISE_VERSION=v${t.version} sh`, rollback: 'rm ~/.local/bin/mise' }];
    case 'just':
      // mise here or installed earlier in the same run: one more pinned tool in its global config (no admin, no package manager).
      if (has('mise')) return [{ cmd: `mise use -g just@${t.version}`, rollback: 'mise unuse -g just' }];
      if (win) return [{ cmd: WINGET('Casey.Just', `--version ${t.version}`), rollback: 'winget uninstall --id Casey.Just' }];
      return pkg('just', 'just', os, has, `Install just with: mise use -g just@${t.version}`);
    case 'podman':
      if (win) return [{ cmd: WINGET('RedHat.Podman', `--version ${t.version}`), rollback: 'winget uninstall --id RedHat.Podman' }];
      return pkg('podman', 'podman', os, has, 'Install Podman from https://podman.io');
    case 'podman-compose':
      // Windows: podman compose hands the work to docker-compose (Podman Desktop's own Compose setup); the Podman
      // machine forwards the Docker API, so the standalone binary needs no Docker Desktop.
      if (win) return [{ cmd: WINGET(t.windows.winget, `--version ${t.windows.version}`), rollback: `winget uninstall --id ${t.windows.winget}` }];
      return [{ cmd: `uv tool install podman-compose==${t.version}`, rollback: 'uv tool uninstall podman-compose' }];
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

// OS package managers (no version pins there; the floor in compat.lock.json is checked afterwards).
function pkg(name, brew, os, has, fallback, alt = {}) {
  if (os === 'mac') return has('brew') ? [{ cmd: `brew install ${brew}`, rollback: `brew uninstall ${brew}` }]
    : [{ cmd: `echo "${fallback} (or install Homebrew first)" && exit 1`, rollback: '-' }];
  if (has('apt-get')) return [{ cmd: `sudo apt-get update && sudo apt-get install -y ${name}`, rollback: `sudo apt-get remove ${name}` }];
  if (has('dnf')) return [{ cmd: `sudo dnf install -y ${name}`, rollback: `sudo dnf remove ${name}` }];
  if (has('pacman')) return [{ cmd: `sudo pacman -S --noconfirm ${alt.pacman || name}`, rollback: `sudo pacman -R ${alt.pacman || name}` }];
  return [{ cmd: `echo "${fallback}" && exit 1`, rollback: '-' }];
}

// Windows and macOS run containers in a small Linux machine. Modest defaults; created once, never deleted by the kit.
export function machineSteps(lock) {
  const m = lock.tools.podman.machine;
  return [
    { action: 'configure', cmd: `podman machine init --cpus ${m.cpus} --memory ${m.memory_mib}`, rollback: 'ask the founder first; then: podman machine rm podman-machine-default' },
    { action: 'configure', cmd: 'podman machine start', rollback: 'podman machine stop' },
  ];
}

// Steps only the founder can take (admin rights, a restart, a browser sign-in): shown in the plan and in `fk actions`.
export const FOUNDER = {
  wsl: { id: 'wsl2', blocking: true, cmd: 'wsl --install --no-distribution',
    text: 'Turn on WSL2 (Windows\' built-in Linux support; Podman needs it): open PowerShell as administrator, run `wsl --install --no-distribution`, restart the computer, then run `fk setup` again to finish Podman.' },
  gh: { id: 'gh-auth', blocking: false, cmd: 'gh auth login',
    text: 'Sign the GitHub CLI in to your account: in a terminal run `gh auth login` and follow the steps (it opens your browser).' },
  ghMise: { id: 'gh-auth', blocking: false, cmd: 'mise exec -- gh auth login',
    text: 'Sign the GitHub CLI in to your account: in a terminal run `mise exec -- gh auth login` and follow the steps (it opens your browser).' },
  podmanOld: (v) => ({ id: 'podman-old', blocking: false, cmd: '-',
    text: `Your Linux ships Podman ${v}; Podman ≥4.9 needs Ubuntu 24.04+/Debian 13+ or packages from podman.io.` }),
};

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
