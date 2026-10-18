# Founder Kit installer for Windows (PowerShell 5.1+).
#
#   irm https://raw.githubusercontent.com/nothingbadhappened/awesome-founder-kit/main/install/install.ps1 | iex
#
# Saved as a file it also takes: -Yes (no question, for CI)  -DryRun (print the commands only)  -With <id,id> / -All (also set
# up optional tools; -WithGh = -With gh). Piped through iex, use environment variables instead: $env:FK_YES='1'; $env:FK_DRY_RUN='1'; $env:FK_WITH='gh,mise' (or 'all').
#
# -Uninstall [-DryRun] [-Yes] [-Keep <ids>] [-Only <ids>] [-PluginOnly]: take back what Founder Kit installed
# (fk uninstall --system; piped: $env:FK_UNINSTALL='1'). Only the founder runs it, in a terminal.
#
# Checks the core tools (git, Node.js, Claude Code, oh-my-claudecode, gitleaks) and lists the optional ones, prints one plan, asks once,
# installs what is missing (user scope where the tool allows), configures, verifies, then adds the founder-kit plugin.
# Optional tools are set up only when asked for (here, or later with fk setup --with <id>, usually when a project's
# toolchain proposal names one). Re-running is safe: present tools are left alone,
# nothing is uninstalled or downgraded. Every change is logged to ~/.fk/install-ledger.jsonl with its undo command, and
# what was already here is logged as pre-existing (never removed by the kit).
# Versions mirror plugins/founder-kit/compat.lock.json (a test fails when they drift).
param([switch]$Yes, [switch]$DryRun, [string[]]$With, [switch]$All, [switch]$WithGh, [switch]$Uninstall, [string]$Keep, [string]$Only, [switch]$PluginOnly)

function ConvertTo-Tilde([string]$Path) {
  $h = (@($env:USERPROFILE, $env:HOME, $HOME) | Where-Object { $_ } | Select-Object -First 1).TrimEnd('\', '/')
  if ($Path -and $Path.Length -gt $h.Length -and $Path.Substring(0, $h.Length + 1).ToLower() -in @(($h + '\').ToLower(), ($h + '/').ToLower())) {
    return '~/' + ($Path.Substring($h.Length + 1) -replace '\\', '/')
  }
  return $Path
}

# What one install step is, for the install ledger and `fk uninstall --system`: the rules of
# plugins/founder-kit/bin/cmd/setup/ledger.mjs describe() (a test keeps them in step).
function Get-LedgerMeta([string]$Tool, [string]$Action, [string]$Cmd, [string]$Rollback) {
  $up = $Action -eq 'upgrade'
  $m = [ordered]@{ item = $Tool; kind = $(if ($up) { 'upgraded' } elseif ($Action -eq 'configure') { 'configured' } else { 'installed' }); how = 'other'; scope = 'user'; undo = $null }
  $set = { param($how, $scope, $undo) $m.kind = $(if ($up) { 'upgraded' } else { 'installed' }); $m.how = $how; $m.scope = $scope; $m.undo = $undo }
  $script = { param([string[]]$paths) & $set 'script' 'user' "remove $($paths -join ' ')"; $m.paths = @($paths) }
  if ($Cmd -match '^claude plugin marketplace add (\S+)') { $m.item = "${Tool}:marketplace"; & $set 'claude plugin' 'user' $(if ($Rollback -match '^claude plugin marketplace remove \S+$') { $Rollback } else { $null }); $m.kind = 'installed' }
  elseif ($Cmd -match '^claude plugin install (\S+)') { $m.item = "${Tool}:plugin"; & $set 'claude plugin' 'user' "claude plugin uninstall $($Matches[1])"; $m.kind = 'installed' }
  elseif ($Cmd -match '^claude plugin (marketplace )?update\b') { $m.item = "${Tool}:plugin"; $m.kind = 'upgraded'; $m.how = 'claude plugin' }
  elseif ($Cmd -match '^npm i(nstall)? -g ') { $m.kind = 'upgraded'; $m.how = 'npm' }
  elseif ($Cmd -match '^winget install --id (\S+)') { $id = $Matches[1]; & $set 'winget' $(if ($id -in 'jdx.mise', 'Casey.Just', 'Gitleaks.Gitleaks', 'Docker.DockerCompose') { 'user' } else { 'machine' }) "winget uninstall --id $id -e" }
  elseif ($Cmd -match '^mise use -g ([\w-]+)@') { & $set 'mise' 'user' "mise unuse -g $($Matches[1])" }
  elseif ($Cmd -match '^uv tool install\b') { & $set 'uv' 'user' $(if ($Rollback -match '^uv tool uninstall [\w-]+$') { $Rollback } else { "uv tool uninstall $Tool" }) }
  elseif ($Cmd -match '^git lfs install\b') { $m.item = 'git-lfs:config'; $m.kind = 'configured'; $m.how = 'git config'; $m.undo = 'git lfs uninstall' }
  elseif ($Cmd -match '^codebase-memory-mcp config set (\w+) (\S+)') { $m.item = "codebase-memory-mcp:$($Matches[1])"; $m.kind = 'configured'; $m.how = 'codebase-memory-mcp config'; $m.undo = $Rollback; $m.value = $Matches[2] }
  elseif ($Cmd -match '^podman machine init\b') { $m.item = 'podman:machine'; $m.kind = 'configured'; $m.how = 'podman machine'; $m.undo = 'podman machine rm -f podman-machine-default'; $m.name = 'podman-machine-default' }
  elseif ($Cmd -match '^podman machine start\b') { $m.item = 'podman:machine-start'; $m.kind = 'runtime'; $m.how = 'podman machine' }
  elseif ($Cmd -match "mempalace init\b.*'([^']+)'") { $p = ConvertTo-Tilde $Matches[1]; $m.item = 'mempalace:palace'; $m.kind = 'data'; $m.how = 'mempalace init'; $m.undo = "delete the folder $p"; $m.paths = @($p) }
  elseif ($Cmd -match '^set hooks\.silent_save = true in (.+)$') { $m.item = 'mempalace:silent-save'; $m.kind = 'configured'; $m.how = 'mempalace config'; $m.undo = 'remove "hooks.silent_save" from the MemPalace config.json'; $m.fn = 'silent-save'; $m.file = ConvertTo-Tilde $Matches[1] }
  elseif ($Cmd -match 'astral\.sh/uv/') { & $script @('~/.local/bin/uv.exe', '~/.local/bin/uvx.exe') }
  elseif ($Cmd -match 'claude\.ai/install\.') { & $script @('~/.local/bin/claude.exe') }
  elseif ($Cmd -match 'codebase-memory-mcp/v[\d.]+/install\.') { & $set 'script' 'user' 'codebase-memory-mcp uninstall -y' }
  elseif ($Rollback -and $Rollback -ne '-' -and -not $up) { $m.undo = $Rollback }
  if ($m.kind -eq 'upgraded') { $m.undo = $null }
  return $m
}

# Hands over to the kit's own uninstaller (fk uninstall --system); without Node.js or the plugin, lists the recorded
# undo commands instead (newest line per item) and removes nothing.
function Uninstall-FounderKit {
  param([switch]$Yes, [switch]$DryRun, [string]$Keep, [string]$Only, [switch]$PluginOnly)
  if ($env:CLAUDE_CODE_CHILD_SESSION -eq '1') { Write-Host 'Founder Kit uninstall: refused: only you can take the kit out. Run it yourself in a terminal outside Claude Code.' -ForegroundColor Red; return }
  $a = @('uninstall', '--system')
  if ($DryRun) { $a += '--dry-run' }; if ($Yes) { $a += '--yes' }; if ($PluginOnly) { $a += '--plugin-only' }
  if ($Keep) { $a += @('--keep', $Keep) }; if ($Only) { $a += @('--only', $Only) }
  $cli = $null
  # The home folder as node and the kit see it (PowerShell's $HOME ignores an overridden USERPROFILE).
  $userHome = @($env:USERPROFILE, $env:HOME, $HOME) | Where-Object { $_ } | Select-Object -First 1
  try { $e = @((Get-Content -Raw -LiteralPath (Join-Path $userHome '.claude\plugins\installed_plugins.json') -ErrorAction Stop | ConvertFrom-Json).plugins.'founder-kit@awesome-founder-kit')[0]; if ($e.installPath) { $cli = Join-Path $e.installPath 'bin\fk.mjs' } } catch { }
  if ($cli -and (Test-Path $cli) -and (Get-Command node -ErrorAction SilentlyContinue)) { & node $cli @a; return }
  $ledger = Join-Path $(if ($env:FK_HOME) { $env:FK_HOME } else { Join-Path $userHome '.fk' }) 'install-ledger.jsonl'
  if (-not (Test-Path $ledger)) { Write-Host 'Founder Kit uninstall: there is no install list (~/.fk/install-ledger.jsonl), so the kit installed nothing here that it knows of. Nothing was changed.'; return }
  Write-Host "The kit's own uninstaller is not available (Node.js or the founder-kit plugin is missing), so nothing was removed."
  Write-Host 'These are the undo commands recorded when the kit installed or changed things; run the ones you want yourself:'
  $seen = @{}
  $lines = @(Get-Content -LiteralPath $ledger | Where-Object { $_ }); [array]::Reverse($lines)
  foreach ($l in $lines) {
    try { $r = $l | ConvertFrom-Json } catch { continue }
    if (-not $r.item -or $r.ok -eq $false -or $seen.ContainsKey($r.item)) { continue }
    $seen[$r.item] = 1
    if ($r.kind -in 'installed', 'configured', 'data' -and $r.undo) { Write-Host "  $($r.item): $($r.undo)" }
  }
}

function Install-FounderKit {
  param([switch]$Yes, [switch]$DryRun, [string[]]$With = @())
  $ErrorActionPreference = 'Continue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

  # ---- pins (compat.lock.json, checked 2026-10-14) ----
  $LockChecked = '2026-10-14'
  $Min = @{ 'git' = '2.30.0'; 'node' = '20.0.0'; 'uv' = '0.5.0'; 'claude-code' = '2.1.0'; 'gh' = '2.40.0'
            'codebase-memory-mcp' = '0.9.0'; 'mempalace' = '3.10.0'; 'skillspector' = '2.11.0'; 'gitleaks' = '8.19.0'
            'git-lfs' = '3.0.0'; 'mise' = '2024.1.0'; 'just' = '1.15.0'; 'podman' = '4.9.0'; 'podman-compose' = '1.0.6' }
  $UvVersion = '0.13.0'
  $ClaudeVersion = '2.1.296'
  $CbmVersion = '0.11.0'
  $MempalaceVersion = '3.10.0'
  $SkillspectorCommit = 'b07f181d9138878c3827de0947a9fd2c6a84a66c'
  $SkillspectorPython = '3.12'
  $GitleaksVersion = '8.30.1'
  $OmcVersion = '5.7.2'
  $GitLfsVersion = '3.8.0'
  $MiseVersion = '2026.9.18'
  $JustVersion = '1.58.0'
  $PodmanVersion = '5.8.3'
  $DockerComposeVersion = '2.40.3' # compose on Windows: podman compose prefers docker-compose (compat.lock.json podman-compose.windows)
  $Machine = @{ cpus = 2; memory = 2048 }
  $Omc = @{ marketplace = 'Yeachan-Heo/oh-my-claudecode'; plugin = 'oh-my-claudecode@omc'; name = 'omc' }
  $Mp = @{ marketplace = 'MemPalace/mempalace'; plugin = 'mempalace@mempalace'; name = 'mempalace' }
  $Fk = @{ marketplace = 'nothingbadhappened/awesome-founder-kit'; plugin = 'founder-kit@awesome-founder-kit'; name = 'awesome-founder-kit' }
  $CbmRaw = "https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/v$CbmVersion"
  $CbmBase = "https://github.com/DeusData/codebase-memory-mcp/releases/download/v$CbmVersion"

  # Optional tools: listed, set up only when asked for. The core (git, node, claude-code, oh-my-claudecode, gitleaks) always is.
  # Mirrors the core flag in plugins/founder-kit/bin/cmd/setup/core.mjs TOOLS (a test keeps them in step).
  $Optional = @('git-lfs', 'uv', 'mise', 'just', 'gh', 'podman', 'podman-compose', 'codebase-memory-mcp', 'mempalace', 'skillspector')
  $bad = @($With | Where-Object { $_ -notin ($Optional + 'all') })
  if ($bad.Count) { Write-Host "install.ps1: unknown optional tool: $($bad -join ', ') (choose from: $($Optional -join ', '), or all)" -ForegroundColor Red; exit 2 }
  # A core tool, or an optional one asked for (MemPalace, SkillSpector and compose install with uv). just and gh come
  # through winget here, so they need no mise (core.mjs TOOLS needs: mac/linux only).
  function Test-Want($id) {
    if ($id -notin $Optional -or 'all' -in $With -or $id -in $With) { return $true }
    return ($id -eq 'uv' -and @($With | Where-Object { $_ -in 'mempalace', 'skillspector', 'podman-compose' }).Count -gt 0)
  }

  $FkHome = if ($env:FK_HOME) { $env:FK_HOME } else { Join-Path $HOME '.fk' }
  $Ledger = Join-Path $FkHome 'install-ledger.jsonl'
  $StatusFile = Join-Path (Join-Path $FkHome 'state') 'base-tools.json'
  $PalaceHome = Join-Path $FkHome 'palace-home'
  $Winget = '-e --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity'

  function Update-SessionPath {
    $parts = @((Join-Path $HOME '.local\bin'), (Join-Path $env:LOCALAPPDATA 'Programs\codebase-memory-mcp')) +
      ([Environment]::GetEnvironmentVariable('Path', 'Machine') -split ';') +
      ([Environment]::GetEnvironmentVariable('Path', 'User') -split ';') + ($env:Path -split ';')
    $seen = @{}; $keep = @()
    foreach ($p in $parts) { if ($p -and -not $seen.ContainsKey($p.ToLower())) { $seen[$p.ToLower()] = 1; $keep += $p } }
    $env:Path = $keep -join ';'
  }

  function Get-Ver([string]$Bin, [string[]]$A = @('--version')) {
    if (-not (Get-Command $Bin -ErrorAction SilentlyContinue)) { return $null }
    try { $o = (& $Bin @A 2>$null | Out-String) } catch { return $null }
    if ($o -match '(\d+\.\d+\.\d+)') { return $Matches[1] }
    return $null
  }
  function Test-AtLeast($v, $m) { try { return ([version]$v) -ge ([version]$m) } catch { return $false } }
  function Read-Json($path) { try { return (Get-Content -Raw -LiteralPath $path -ErrorAction Stop | ConvertFrom-Json) } catch { return $null } }
  function Test-Plugin($name) {
    $reg = Read-Json (Join-Path $HOME '.claude\plugins\installed_plugins.json')
    if (-not $reg -or -not $reg.plugins) { return $false }
    return [bool]($reg.plugins.PSObject.Properties.Name | Where-Object { $_ -like "$name@*" })
  }
  function Test-Marketplace($repo) {
    $m = Read-Json (Join-Path $HOME '.claude\plugins\known_marketplaces.json')
    if (-not $m) { return $false }
    return [bool]($m.PSObject.Properties.Value | Where-Object { $_.source.repo -eq $repo })
  }
  function Get-PluginSteps($spec) {
    $s = @()
    if (-not (Test-Marketplace $spec.marketplace)) { $s += @{ action = 'install'; cmd = "claude plugin marketplace add $($spec.marketplace)"; rollback = "claude plugin marketplace remove $($spec.name)" } }
    if (-not (Test-Plugin ($spec.plugin -split '@')[0])) { $s += @{ action = 'install'; cmd = "claude plugin install $($spec.plugin)"; rollback = "claude plugin uninstall $($spec.plugin)" } }
    return ,$s
  }
  function Get-MempalaceDir {
    if ($env:MEMPALACE_CONFIG_DIR) { return $env:MEMPALACE_CONFIG_DIR }
    # PowerShell's $HOME ignores an overridden USERPROFILE/HOME (sandboxes, tests); the printed path follows them.
    $userHome = @($env:USERPROFILE, $env:HOME, $HOME) | Where-Object { $_ } | Select-Object -First 1
    $legacy = Join-Path $userHome '.mempalace'
    foreach ($f in 'config.json', 'people_map.json', 'palace\chroma.sqlite3') { if (Test-Path (Join-Path $legacy $f)) { return $legacy } }
    if ($env:XDG_CONFIG_HOME) { return (Join-Path $env:XDG_CONFIG_HOME 'mempalace') }
    return (Join-Path $userHome '.config\mempalace')
  }

  function New-Row($id, $label, $size, $why) {
    return [pscustomobject]@{ id = $id; label = $label; size = $size; why = $why; version = $null; level = 'green'; reason = 'ok'; note = ''; steps = @(); founder = @(); engine = $null; machine = $null; found = @() }
  }
  function Set-Grade($row, $min, $installSteps) {
    if (-not $row.version) { $row.level = 'red'; $row.reason = 'missing'; $row.note = 'not installed'; $row.steps += $installSteps }
    elseif (-not (Test-AtLeast $row.version $min)) { $row.level = 'red'; $row.reason = 'below-floor'; $row.note = "older than the minimum $min"; $row.steps += $installSteps }
  }

  function Get-State {
    $rows = @()
    $r = New-Row 'git' 'git' 'about 300 MB' 'keeps every version of your project, so nothing is ever lost'
    $r.version = Get-Ver 'git'; Set-Grade $r $Min['git'] @(@{ action = 'install'; cmd = "winget install --id Git.Git $Winget"; rollback = 'winget uninstall --id Git.Git' }); $rows += $r

    $r = New-Row 'git-lfs' 'Git LFS' 'about 15 MB' 'keeps big files (images, audio, game assets) out of the way so the project stays fast to copy'
    $r.version = Get-Ver 'git-lfs' @('version')
    Set-Grade $r $Min['git-lfs'] @(@{ action = 'install'; cmd = "winget install --id GitHub.GitLFS $Winget --version $GitLfsVersion"; rollback = 'winget uninstall --id GitHub.GitLFS' })
    $lfsOn = ''; if ($r.version -and (Get-Command git -ErrorAction SilentlyContinue)) { $lfsOn = (& git config --global --get filter.lfs.process 2>$null | Out-String).Trim() }
    if ($lfsOn) { $r.found += 'git-lfs:config' }
    if (-not $lfsOn) {
      $r.steps += @{ action = 'configure'; cmd = 'git lfs install'; rollback = 'git lfs uninstall' }
      if ($r.version -and $r.level -ne 'red') { $r.level = 'red'; $r.reason = 'not-configured'; $r.note = 'not switched on for your user yet (git lfs install)' }
    }
    $rows += $r

    $r = New-Row 'node' 'Node.js' 'about 100 MB' "runs the kit's safety checks"
    $r.version = Get-Ver 'node'; Set-Grade $r $Min['node'] @(@{ action = 'install'; cmd = "winget install --id OpenJS.NodeJS.LTS $Winget"; rollback = 'winget uninstall --id OpenJS.NodeJS.LTS' }); $rows += $r

    $r = New-Row 'uv' 'uv' 'about 40 MB' 'installs the Python helpers below, each in its own sealed box'
    $r.version = Get-Ver 'uv'; Set-Grade $r $Min['uv'] @(@{ action = 'install'; cmd = "irm https://astral.sh/uv/$UvVersion/install.ps1 | iex"; rollback = 'Remove-Item $HOME\.local\bin\uv.exe, $HOME\.local\bin\uvx.exe' }); $rows += $r

    $r = New-Row 'mise' 'mise' 'about 30 MB' "pins each project's tool versions, so the project runs the same on any computer"
    $r.version = Get-Ver 'mise'; Set-Grade $r $Min['mise'] @(@{ action = 'install'; cmd = "winget install --id jdx.mise $Winget --version $MiseVersion"; rollback = 'winget uninstall --id jdx.mise' }); $rows += $r
    # mise here, or installed by the step above in this run: just comes pinned through it (steps run in plan order).
    $hasMise = [bool]$r.version
    $miseOk = $hasMise -or ((@($r.steps).Count -gt 0) -and (Test-Want 'mise'))

    $r = New-Row 'just' 'just' 'about 5 MB' 'one short command for each job (just setup, just check), the same on every computer'
    $r.version = Get-Ver 'just'
    if (-not $r.version -and $hasMise) { $r.version = Get-Ver 'mise' @('exec', '--', 'just', '--version'); if ($r.version) { $r.note = 'through mise (agents run it as mise exec -- just)' } }
    $justStep = if ($miseOk) { @{ action = 'install'; cmd = "mise use -g just@$JustVersion"; rollback = 'mise unuse -g just' } } else { @{ action = 'install'; cmd = "winget install --id Casey.Just $Winget --version $JustVersion"; rollback = 'winget uninstall --id Casey.Just' } }
    Set-Grade $r $Min['just'] @($justStep); $rows += $r

    $r = New-Row 'gh' 'GitHub CLI' 'about 40 MB' 'lets Claude publish your project to GitHub and run its checks there'
    $r.version = Get-Ver 'gh'; Set-Grade $r $Min['gh'] @(@{ action = 'install'; cmd = "winget install --id GitHub.cli $Winget"; rollback = 'winget uninstall --id GitHub.cli' })
    $ghDir = if ($env:GH_CONFIG_DIR) { $env:GH_CONFIG_DIR } else { Join-Path "$env:APPDATA" 'GitHub CLI' }
    $ghIn = $env:GH_TOKEN -or $env:GITHUB_TOKEN -or ((Test-Path (Join-Path $ghDir 'hosts.yml')) -and ((Get-Content -Raw (Join-Path $ghDir 'hosts.yml')) -match 'github\.com'))
    if (-not $ghIn) {
      $r.founder = @([ordered]@{ id = 'gh-auth'; blocking = $false; cmd = 'gh auth login'; text = 'Sign the GitHub CLI in to your account: in a terminal run `gh auth login` and follow the steps (it opens your browser).' })
      if ($r.level -eq 'green') { $r.note = 'not signed in yet (your step: gh auth login)' }
    }
    $rows += $r

    # Containers: Podman, or a Docker that is already here (kept; Podman is never added next to it).
    $r = New-Row 'podman' 'Containers (Podman)' 'about 1-2 GB with its small Linux machine' 'runs databases and other services in sealed boxes, so nothing is installed into your computer itself'
    $podmanV = Get-Ver 'podman'; $dockerV = if (-not $podmanV) { Get-Ver 'docker' } else { $null }
    if ($dockerV) { $r.label = 'Containers (Docker)'; $r.version = $dockerV; $r.engine = 'docker'; $r.note = 'Docker found; kept (Podman is not added next to it)' }
    else {
      $r.version = $podmanV; if ($podmanV) { $r.engine = 'podman' }
      Set-Grade $r $Min['podman'] @(@{ action = 'install'; cmd = "winget install --id RedHat.Podman $Winget --version $PodmanVersion"; rollback = 'winget uninstall --id RedHat.Podman' })
      $wsl = $false
      if (Get-Command wsl -ErrorAction SilentlyContinue) { try { & wsl --status *> $null; $wsl = ($LASTEXITCODE -eq 0) } catch { } }
      if (-not $wsl) {
        # WSL2 needs admin rights and a restart: the founder's step, never run silently. Everything else still installs.
        $r.founder = @([ordered]@{ id = 'wsl2'; blocking = $true; cmd = 'wsl --install --no-distribution'; text = "Turn on WSL2 (Windows' built-in Linux support; Podman needs it): open PowerShell as administrator, run ``wsl --install --no-distribution``, restart the computer, then run this installer (or fk setup) again to finish Podman." })
        if ($r.level -eq 'red') { $r.note = "$($r.note); its machine waits for WSL2 (your step)" } else { $r.level = 'yellow'; $r.reason = 'needs-founder'; $r.note = 'needs WSL2 first (your step)' }
      } else {
        $ml = ''; if ($podmanV) { $ml = (& podman machine list --format json 2>$null | Out-String) }
        $r.machine = [ordered]@{ exists = ($ml -match '"Name"'); running = ($ml -match '"Running":\s*true') }
        if ($r.machine.exists) { $r.found += 'podman:machine' }
        if (-not $r.machine.exists) {
          $r.steps += @{ action = 'configure'; cmd = "podman machine init --cpus $($Machine.cpus) --memory $($Machine.memory)"; rollback = 'ask the founder first; then: podman machine rm podman-machine-default' }
          $r.steps += @{ action = 'configure'; cmd = 'podman machine start'; rollback = 'podman machine stop' }
          if ($r.level -ne 'red') { $r.level = 'red'; $r.reason = 'not-configured'; $r.note = 'no Podman machine yet (the small Linux machine containers run in; about 1 GB to download)' }
        } else {
          $m = if ($r.machine.running) { 'machine running (stop it with podman machine stop when not needed)' } else { 'machine stopped (podman machine start when you need containers)' }
          $r.note = (@($r.note, $m) | Where-Object { $_ }) -join '; '
        }
      }
    }
    $rows += $r

    $r = New-Row 'podman-compose' 'Compose for Podman' 'about 10 MB' "starts all of a project's services with one command (podman compose up)"
    if ($dockerV) { $r.reason = 'not-needed'; $r.note = 'not needed: Docker brings its own compose' }
    elseif (Get-Ver 'docker-compose') { $r.reason = 'not-needed'; $r.note = 'docker-compose found; podman compose uses it' }
    else {
      # An existing podman-compose is kept; otherwise the standalone docker-compose, the provider podman compose prefers
      # (Podman Desktop sets up the same binary; the Podman machine forwards the Docker API to it).
      $r.version = Get-Ver 'podman-compose'
      Set-Grade $r $Min['podman-compose'] @(@{ action = 'install'; cmd = "winget install --id Docker.DockerCompose $Winget --version $DockerComposeVersion"; rollback = 'winget uninstall --id Docker.DockerCompose' })
      if (-not $r.version) { $r.note = 'not installed (Windows: the standalone docker-compose, which podman compose uses)' }
    }
    $rows += $r

    $r = New-Row 'claude-code' 'Claude Code' 'about 200 MB' 'the AI assistant the kit runs inside'
    $r.version = Get-Ver 'claude'; Set-Grade $r $Min['claude-code'] @(@{ action = 'install'; cmd = "& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) $ClaudeVersion"; rollback = 'Remove-Item $HOME\.local\bin\claude.exe' }); $rows += $r

    $r = New-Row 'oh-my-claudecode' 'oh-my-claudecode' 'about 20 MB' 'the agent team and workflow the kit builds on'
    if (Test-Marketplace $Omc.marketplace) { $r.found += 'oh-my-claudecode:marketplace' }
    if (Test-Plugin 'oh-my-claudecode') {
      $r.found += 'oh-my-claudecode:plugin'
      $reg = Read-Json (Join-Path $HOME '.claude\plugins\installed_plugins.json')
      $e = @($reg.plugins.PSObject.Properties | Where-Object { $_.Name -like 'oh-my-claudecode@*' } | Select-Object -First 1).Value | Select-Object -First 1
      $r.version = $e.version
      $latest = $OmcVersion
      if ($env:FK_OMC_LATEST) { $latest = $env:FK_OMC_LATEST } else { try { $latest = (Invoke-RestMethod -Uri 'https://registry.npmjs.org/oh-my-claude-sisyphus/latest' -TimeoutSec 5).version } catch { } }
      $floor = "$([Math]::Max(0, [int]($latest -split '\.')[0] - 1)).0.0"
      if ($r.version -and -not (Test-AtLeast $r.version $floor)) {
        $r.level = 'red'; $r.reason = 'below-floor'; $r.note = "below the supported floor $floor"
        $r.steps += @{ action = 'upgrade'; cmd = 'claude plugin marketplace update omc'; rollback = '-' }
        $r.steps += @{ action = 'upgrade'; cmd = "claude plugin update $($Omc.plugin)"; rollback = 'reinstall the previous version from /plugin' }
      }
    } else {
      # npm mode is supported; adding the plugin copy too would fire OMC's hooks twice, so it is never added here.
      $npm = Get-Ver 'omc'
      if ($npm) { $r.found += 'oh-my-claudecode' }
      $r.version = $npm
      if ($npm -and (Test-AtLeast $npm "$([Math]::Max(0, [int]($OmcVersion -split '\.')[0] - 1)).0.0")) { $r.level = 'yellow'; $r.reason = 'npm'; $r.note = 'npm install: supported; plugin mode optional' }
      elseif ($npm) { $r.level = 'red'; $r.reason = 'below-floor'; $r.note = 'npm install below the supported floor'; $r.steps += @{ action = 'upgrade'; cmd = "npm i -g oh-my-claude-sisyphus@$OmcVersion"; rollback = 'npm i -g <the previous version>' } }
      else { $r.level = 'red'; $r.reason = 'missing'; $r.note = 'not installed'; $r.steps += (Get-PluginSteps $Omc) }
    }
    $rows += $r

    $r = New-Row 'codebase-memory-mcp' 'codebase-memory' 'about 40 MB' 'gives Claude a map of your code so it reads less and costs less'
    $r.version = Get-Ver 'codebase-memory-mcp'
    Set-Grade $r $Min['codebase-memory-mcp'] @(@{ action = 'install'
      cmd = "`$f = Join-Path `$env:TEMP 'cbm-install-$CbmVersion.ps1'; Invoke-WebRequest -UseBasicParsing -Uri $CbmRaw/install.ps1 -OutFile `$f; `$env:CBM_DOWNLOAD_URL = '$CbmBase'; & powershell -NoProfile -ExecutionPolicy Bypass -File `$f; `$c = `$LASTEXITCODE; Remove-Item `$f; exit `$c"
      rollback = 'codebase-memory-mcp uninstall -y' })
    foreach ($key in 'auto_index', 'auto_watch') {
      $have = $null
      if ($r.version) { $have = (& codebase-memory-mcp config get $key 2>$null | Out-String).Trim() }
      if ($r.version -and $have -eq 'false') { $r.found += "codebase-memory-mcp:$key"; continue }
      $r.steps += @{ action = 'configure'; cmd = "codebase-memory-mcp config set $key false"; rollback = "codebase-memory-mcp config set $key true" }
      $shown = if ($have) { $have } else { 'not set' }
      if ($r.version -and $r.level -ne 'red') { $r.level = 'red'; $r.reason = 'not-configured'; $r.note = "$key is $shown; the kit keeps it false so indexing runs only when asked" }
    }
    $rows += $r

    $r = New-Row 'mempalace' 'MemPalace' 'about 500 MB' 'remembers decisions between sessions, on your machine only'
    $r.version = Get-Ver 'mempalace'
    Set-Grade $r $Min['mempalace'] @(@{ action = 'install'; cmd = "uv tool install mempalace==$MempalaceVersion"; rollback = 'uv tool uninstall mempalace' })
    if (Test-Plugin 'mempalace') { $r.found += 'mempalace:plugin' }
    if (Test-Marketplace $Mp.marketplace) { $r.found += 'mempalace:marketplace' }
    $ps = Get-PluginSteps $Mp
    if ($ps.Count) { $r.steps += $ps; if ($r.level -ne 'red') { $r.level = 'red'; $r.reason = 'plugin-missing'; $r.note = 'the Claude Code plugin is not installed' } }
    $mdir = Get-MempalaceDir
    $cfgFile = Join-Path $mdir 'config.json'
    $cfg = Read-Json $cfgFile
    $palace = if ($cfg -and $cfg.palace_path) { $cfg.palace_path } else { Join-Path $mdir 'palace' }
    # `mempalace init --backend` records the backend; the palace folder itself appears on the first mine or save.
    $hasPalace = [bool]($cfg -and $cfg.backend) -or (Test-Path $palace)
    $notes = @()
    if ($hasPalace) { $r.found += 'mempalace:palace' }
    if ($cfg -and $cfg.hooks -and $null -ne $cfg.hooks.silent_save) { $r.found += 'mempalace:silent-save' }
    if (-not $hasPalace) {
      $r.steps += @{ action = 'configure'; cmd = "New-Item -ItemType Directory -Force -Path '$PalaceHome' | Out-Null; if (`$?) { mempalace init --yes --no-llm --backend sqlite_exact '$PalaceHome' }"; rollback = 'delete the palace folder MemPalace reports in `mempalace status` and the "backend" line in its config.json' }
      if ($r.level -ne 'red') { $r.level = 'red'; $r.reason = 'not-configured'; $r.note = 'no palace yet' }
    } else {
      $backend = if ($cfg -and $cfg.backend) { $cfg.backend } else { 'chroma' }
      if ($backend -ne 'sqlite_exact') { $notes += "your existing palace uses the $backend backend; kept as is" }
    }
    $silent = $null; if ($cfg -and $cfg.hooks) { $silent = $cfg.hooks.silent_save }
    if ($silent -eq $false) { $notes += 'hooks.silent_save is off (your choice; kept)' }
    elseif ($null -eq $silent) {
      $js = "const f=process.argv[1],fs=require('fs');let c={};try{c=JSON.parse(fs.readFileSync(f,'utf8'))}catch{}c.hooks=c.hooks||{};if(c.hooks.silent_save===undefined){c.hooks.silent_save=true;fs.mkdirSync(require('path').dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(c,null,2))}"
      $r.steps += @{ action = 'configure'; js = $js; arg = $cfgFile; cmd = "set hooks.silent_save = true in $cfgFile"; rollback = "remove hooks.silent_save from $cfgFile" }
    }
    if ($env:MEMPAL_DIR) { $notes += 'MEMPAL_DIR is set, so MemPalace mines that folder on every save; the kit recommends unsetting it' }
    if ($notes.Count) { if ($r.level -eq 'green') { $r.level = 'yellow' }; $r.note = (@($r.note) + $notes | Where-Object { $_ }) -join '; ' }
    $rows += $r

    $r = New-Row 'skillspector' 'SkillSpector' 'about 150 MB' 'scans add-ons for malicious instructions before they are used'
    $r.version = Get-Ver 'skillspector'
    $re = if ($r.version) { ' --reinstall' } else { '' }
    Set-Grade $r $Min['skillspector'] @(@{ action = 'install'; cmd = "uv tool install --python $SkillspectorPython git+https://github.com/NVIDIA/skillspector.git@$SkillspectorCommit$re"; rollback = 'uv tool uninstall skillspector' }); $rows += $r

    $r = New-Row 'gitleaks' 'gitleaks' 'about 20 MB' 'stops passwords and keys from being saved into your project'
    $r.version = Get-Ver 'gitleaks' @('version')
    Set-Grade $r $Min['gitleaks'] @(@{ action = 'install'; cmd = "winget install --id Gitleaks.Gitleaks $Winget --version $GitleaksVersion"; rollback = 'winget uninstall --id Gitleaks.Gitleaks' }); $rows += $r

    $r = New-Row 'founder-kit' 'Founder Kit plugin' 'about 2 MB' 'the founder layer itself'
    if (Test-Plugin 'founder-kit') { $r.version = 'installed' } else { $r.level = 'red'; $r.reason = 'missing'; $r.note = 'not installed'; $r.steps += (Get-PluginSteps $Fk) }
    $rows += $r

    # An optional tool nobody asked for: listed, never planned. Missing is neutral; a copy that is here is not set up
    # further. Only an installed copy below the floor stays red.
    foreach ($x in $rows) {
      if (Test-Want $x.id) { continue }
      $x.founder = @()
      if ($x.reason -eq 'missing') { $x.level = 'optional'; $x.reason = 'optional'; $x.note = 'optional; proposed per project when it needs it' }
      elseif ($x.reason -eq 'below-floor') { continue }
      elseif ($x.level -eq 'red') { $x.level = 'yellow'; $x.note = "$($x.note); fk setup --with $($x.id) sets it up" }
      $x.steps = @()
    }
    return ,$rows
  }

  function Show-Table($rows) {
    $colors = @{ green = 'Green'; yellow = 'Yellow'; red = 'Red'; optional = 'DarkGray' }
    foreach ($r in $rows) {
      Write-Host ('  {0,-8}' -f $r.level) -ForegroundColor $colors[$r.level] -NoNewline
      Write-Host (' {0,-22} {1}' -f $r.label, ((@($r.version, $r.note) | Where-Object { $_ }) -join ', '))
    }
  }
  function Write-Ledger($tool, $step, $ok) {
    $v = @{ 'uv' = $UvVersion; 'claude-code' = $ClaudeVersion; 'codebase-memory-mcp' = $CbmVersion; 'mempalace' = $MempalaceVersion; 'skillspector' = $SkillspectorCommit; 'gitleaks' = $GitleaksVersion; 'oh-my-claudecode' = $OmcVersion
           'git-lfs' = $GitLfsVersion; 'mise' = $MiseVersion; 'just' = $JustVersion; 'podman' = $PodmanVersion; 'podman-compose' = $DockerComposeVersion }[$tool]
    $line = [ordered]@{ ts = (Get-Date).ToUniversalTime().ToString('o'); via = 'install.ps1'; tool = $tool; action = $step.action; version = $v; command = $step.cmd; ok = $ok; rollback = $step.rollback }
    $meta = Get-LedgerMeta $tool $step.action $step.cmd $step.rollback
    foreach ($k in $meta.Keys) { $line[$k] = $meta[$k] }
    $line = $line | ConvertTo-Json -Compress
    New-Item -ItemType Directory -Force -Path $FkHome | Out-Null
    [IO.File]::AppendAllText($Ledger, $line + "`n")
  }
  # What was already here before this run: one pre-existing line per item the ledger does not know yet (never removed by the kit).
  function Write-Found($rows) {
    New-Item -ItemType Directory -Force -Path $FkHome | Out-Null
    $known = ''; if (Test-Path $Ledger) { $known = [IO.File]::ReadAllText($Ledger) }
    foreach ($r in $rows) {
      $items = @($r.found)
      if ($r.version -and $r.id -notin 'oh-my-claudecode', 'founder-kit') { $items += $(if ($r.id -eq 'podman' -and $r.engine) { $r.engine } else { $r.id }) }
      foreach ($it in $items) {
        if ($known.Contains('"item":"' + $it + '"')) { continue }
        $line = [ordered]@{ ts = (Get-Date).ToUniversalTime().ToString('o'); via = 'install.ps1'; tool = ($it -split ':')[0]; item = $it; kind = 'pre-existing'; action = 'found'; version = $(if ($it -notmatch ':') { $r.version } else { $null }); undo = $null; ok = $true } | ConvertTo-Json -Compress
        [IO.File]::AppendAllText($Ledger, $line + "`n"); $known += $line
      }
    }
  }
  # Steps only the founder can take (admin rights and a restart, a browser sign-in): listed, never run.
  function Show-Founder($rows) {
    $f = @($rows | ForEach-Object { $_.founder } | Where-Object { $_ } | Where-Object { $_.blocking }) + @($rows | ForEach-Object { $_.founder } | Where-Object { $_ -and -not $_.blocking }) # blocking first (WSL2 before a sign-in)
    if (-not $f.Count) { return }
    Write-Host ''; Write-Host 'Only you can do these (the installer never runs them for you; fk actions lists them too):' -ForegroundColor Yellow
    foreach ($x in $f) { Write-Host "  - $($x.text)" }
  }
  function Write-Status($rows) {
    $tools = [ordered]@{}
    foreach ($r in $rows) {
      $t = [ordered]@{ level = $r.level; reason = $r.reason; version = $r.version; min = $Min[$r.id]; note = $r.note }
      if ($r.id -eq 'podman') { $t.engine = $r.engine; $t.machine = $r.machine }
      if (@($r.founder).Count) { $t.founder = @($r.founder) }
      $tools[$r.id] = $t
    }
    $doc = [ordered]@{ ts = (Get-Date).ToUniversalTime().ToString('o'); checked_by = 'install.ps1'; lock_checked = $LockChecked; tools = $tools } | ConvertTo-Json -Depth 5
    New-Item -ItemType Directory -Force -Path (Split-Path $StatusFile) | Out-Null
    [IO.File]::WriteAllText($StatusFile, $doc)
  }

  Write-Host ''
  Write-Host 'Founder Kit setup' -ForegroundColor Cyan
  Write-Host "Checking what is already on this computer ($([Environment]::OSVersion.VersionString))..."
  Update-SessionPath
  $rows = Get-State
  Show-Table $rows
  $opt = @($rows | Where-Object { $_.level -eq 'optional' } | ForEach-Object { $_.id })
  if ($opt.Count) { Write-Host ''; Write-Host "Optional tools stay out until a project needs one (its toolchain proposal names it). To add one now: fk setup --with <id> ($($opt -join ', '))." }
  $todo = @($rows | Where-Object { $_.steps.Count -gt 0 })

  if ($todo.Count -eq 0) {
    if (-not $DryRun) { Write-Status $rows; Write-Found $rows }
    Write-Host ''; Write-Host 'Everything is already in place.' -ForegroundColor Green
    Show-Founder $rows
  } else {
    Write-Host ''; Write-Host 'Plan (everything below is free and open source):'
    $i = 0
    foreach ($r in $todo) {
      $i++
      $verb = @{ missing = 'Install'; 'below-floor' = 'Update'; 'plugin-missing' = 'Add the Claude Code plugin of' }[$r.reason]
      if (-not $verb) { $verb = 'Set up' }
      Write-Host "  $i. $verb $($r.label) ($($r.size)): $($r.why)."
      foreach ($s in $r.steps) { Write-Host "       > $($s.cmd)" -ForegroundColor DarkGray }
    }
    Write-Host '  Nothing is uninstalled or downgraded. Every change is logged with its undo command in ~/.fk/install-ledger.jsonl (fk uninstall --system takes it back).'
    Write-Host '  Windows may ask for permission to install (a blue or yellow prompt). Say yes.'
    Show-Founder $rows
    if ($DryRun) { Write-Host ''; Write-Host 'Dry run: nothing was changed.'; return }
    $go = $Yes
    if (-not $go) { $a = Read-Host 'Install and set up these now? [Y/n]'; $go = -not ($a -match '^\s*n') }
    if (-not $go) { Write-Status $rows; Write-Host 'Nothing was installed. Run this again whenever you are ready.'; return }

    Write-Found $rows
    foreach ($r in $todo) {
      Write-Host ''; Write-Host "-> $($r.label)" -ForegroundColor Cyan
      foreach ($s in $r.steps) {
        if ($s.js) { & node -e $s.js $s.arg } else { & powershell -NoProfile -ExecutionPolicy Bypass -Command $s.cmd }
        $ok = ($LASTEXITCODE -eq 0)
        Update-SessionPath
        Write-Ledger $r.id $s $ok
        if (-not $ok) { Write-Host "   failed: $($s.cmd)" -ForegroundColor Red; break }
      }
    }
    $rows = Get-State
    Write-Status $rows
    Write-Host ''; Write-Host 'Result' -ForegroundColor Cyan
    Show-Table $rows
    if (@($todo | Where-Object { $_.id -eq 'mise' }).Count) {
      Write-Host 'mise: agents run project tools with `mise exec -- <command>`. For your own terminal, add to your PowerShell profile: mise activate pwsh | Out-String | Invoke-Expression'
    }
    Show-Founder $rows
  }

  # The user-level `fk` command (~/.local/bin/fk.cmd, user PATH): the kit's own code writes it (fk setup --shim).
  $fkEntry = $null
  if (-not $DryRun) { $reg = Read-Json (Join-Path $HOME '.claude\plugins\installed_plugins.json'); if ($reg -and $reg.plugins) { $fkEntry = @($reg.plugins.'founder-kit@awesome-founder-kit')[0] } }
  if ($fkEntry -and $fkEntry.installPath -and (Get-Command node -ErrorAction SilentlyContinue)) { & node (Join-Path $fkEntry.installPath 'bin\fk.mjs') setup --shim }

  $red = @($rows | Where-Object { $_.level -eq 'red' })
  Write-Host ''
  if ($red.Count -eq 0) {
    Write-Host 'All set.' -ForegroundColor Green
    Write-Host 'Next: open a new terminal, make an empty folder for your project, run `claude` inside it, and say:'
    Write-Host '      Start my project with fk-start' -ForegroundColor Cyan
    if (@($rows | Where-Object { $_.id -eq 'oh-my-claudecode' -and $_.reason -ne 'ok' }).Count -eq 0) {
      Write-Host 'Once, inside Claude Code, also run /oh-my-claudecode:omc-setup if you have not before.'
    }
  } elseif (-not $DryRun) {
    Write-Host "Still red: $(($red | ForEach-Object { $_.label }) -join ', '). Run this installer again, or open Claude Code and run: fk setup" -ForegroundColor Red
  }
}

if ($Uninstall -or $env:FK_UNINSTALL -eq '1') {
  Uninstall-FounderKit -Yes:($Yes -or $env:FK_YES -eq '1') -DryRun:($DryRun -or $env:FK_DRY_RUN -eq '1') -Keep $Keep -Only $Only -PluginOnly:$PluginOnly
} else {
  # -With gh,mise arrives as an array, -File and FK_WITH as one string: split every element on commas and spaces.
  $w = @(@($With) + @($env:FK_WITH) | Where-Object { $_ } | ForEach-Object { $_ -split '[,\s]+' } | Where-Object { $_ })
  if ($All) { $w += 'all' }; if ($WithGh -or $env:FK_WITH_GH -eq '1') { $w += 'gh' }
  Install-FounderKit -Yes:($Yes -or $env:FK_YES -eq '1') -DryRun:($DryRun -or $env:FK_DRY_RUN -eq '1') -With $w
}
