# Founder Kit installer for Windows (PowerShell 5.1+).
#
#   irm https://raw.githubusercontent.com/nothingbadhappened/awesome-founder-kit/main/install/install.ps1 | iex
#
# Saved as a file it also takes: -Yes (no question, for CI)  -DryRun (print the commands only)  -WithGh (add GitHub CLI).
# Piped through iex, use environment variables instead: $env:FK_YES='1'; $env:FK_DRY_RUN='1'; $env:FK_WITH_GH='1'.
#
# Checks every base tool, prints one plan, asks once, installs what is missing (user scope where the tool allows),
# configures, verifies, then adds the founder-kit plugin. Re-running is safe: present tools are left alone,
# nothing is uninstalled or downgraded. Every change is logged to ~/.fk/install-ledger.jsonl with an undo hint.
# Versions mirror plugins/founder-kit/compat.lock.json (a test fails when they drift).
param([switch]$Yes, [switch]$DryRun, [switch]$WithGh)

function Install-FounderKit {
  param([switch]$Yes, [switch]$DryRun, [switch]$WithGh)
  $ErrorActionPreference = 'Continue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

  # ---- pins (compat.lock.json, checked 2026-10-14) ----
  $LockChecked = '2026-10-14'
  $Min = @{ 'git' = '2.30.0'; 'node' = '20.0.0'; 'uv' = '0.5.0'; 'claude-code' = '2.1.0'; 'gh' = '2.40.0'
            'codebase-memory-mcp' = '0.9.0'; 'mempalace' = '3.10.0'; 'skillspector' = '2.11.0'; 'gitleaks' = '8.19.0' }
  $UvVersion = '0.13.0'
  $ClaudeVersion = '2.1.296'
  $CbmVersion = '0.11.0'
  $MempalaceVersion = '3.10.0'
  $SkillspectorCommit = 'b07f181d9138878c3827de0947a9fd2c6a84a66c'
  $SkillspectorPython = '3.12'
  $GitleaksVersion = '8.30.1'
  $OmcVersion = '5.7.2'
  $Omc = @{ marketplace = 'Yeachan-Heo/oh-my-claudecode'; plugin = 'oh-my-claudecode@omc'; name = 'omc' }
  $Mp = @{ marketplace = 'MemPalace/mempalace'; plugin = 'mempalace@mempalace'; name = 'mempalace' }
  $Fk = @{ marketplace = 'nothingbadhappened/awesome-founder-kit'; plugin = 'founder-kit@awesome-founder-kit'; name = 'awesome-founder-kit' }
  $CbmRaw = "https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/v$CbmVersion"
  $CbmBase = "https://github.com/DeusData/codebase-memory-mcp/releases/download/v$CbmVersion"

  $FkHome = if ($env:FK_HOME) { $env:FK_HOME } else { Join-Path $HOME '.fk' }
  $Ledger = Join-Path $FkHome 'install-ledger.jsonl'
  $StatusFile = Join-Path $FkHome 'base-tools.json'
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
    return [pscustomobject]@{ id = $id; label = $label; size = $size; why = $why; version = $null; level = 'green'; reason = 'ok'; note = ''; steps = @() }
  }
  function Set-Grade($row, $min, $installSteps) {
    if (-not $row.version) { $row.level = 'red'; $row.reason = 'missing'; $row.note = 'not installed'; $row.steps += $installSteps }
    elseif (-not (Test-AtLeast $row.version $min)) { $row.level = 'red'; $row.reason = 'below-floor'; $row.note = "older than the minimum $min"; $row.steps += $installSteps }
  }

  function Get-State {
    $rows = @()
    $r = New-Row 'git' 'git' 'about 300 MB' 'keeps every version of your project, so nothing is ever lost'
    $r.version = Get-Ver 'git'; Set-Grade $r $Min['git'] @(@{ action = 'install'; cmd = "winget install --id Git.Git $Winget"; rollback = 'winget uninstall --id Git.Git' }); $rows += $r

    $r = New-Row 'node' 'Node.js' 'about 100 MB' "runs the kit's safety checks"
    $r.version = Get-Ver 'node'; Set-Grade $r $Min['node'] @(@{ action = 'install'; cmd = "winget install --id OpenJS.NodeJS.LTS $Winget"; rollback = 'winget uninstall --id OpenJS.NodeJS.LTS' }); $rows += $r

    $r = New-Row 'uv' 'uv' 'about 40 MB' 'installs the Python helpers below, each in its own sealed box'
    $r.version = Get-Ver 'uv'; Set-Grade $r $Min['uv'] @(@{ action = 'install'; cmd = "irm https://astral.sh/uv/$UvVersion/install.ps1 | iex"; rollback = 'Remove-Item $HOME\.local\bin\uv.exe, $HOME\.local\bin\uvx.exe' }); $rows += $r

    $r = New-Row 'claude-code' 'Claude Code' 'about 200 MB' 'the AI assistant the kit runs inside'
    $r.version = Get-Ver 'claude'; Set-Grade $r $Min['claude-code'] @(@{ action = 'install'; cmd = "& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) $ClaudeVersion"; rollback = 'Remove-Item $HOME\.local\bin\claude.exe' }); $rows += $r

    $r = New-Row 'gh' 'GitHub CLI (optional)' 'about 40 MB' 'lets Claude publish your project to GitHub'
    $r.version = Get-Ver 'gh'
    if (-not $r.version) {
      $r.level = 'yellow'; $r.reason = 'optional'
      if ($WithGh) { $r.note = 'not installed'; $r.steps += @{ action = 'install'; cmd = "winget install --id GitHub.cli $Winget"; rollback = 'winget uninstall --id GitHub.cli' } }
      else { $r.note = 'not installed (optional; re-run with -WithGh to add it)' }
    }
    $rows += $r

    $r = New-Row 'oh-my-claudecode' 'oh-my-claudecode' 'about 20 MB' 'the agent team and workflow the kit builds on'
    if (Test-Plugin 'oh-my-claudecode') {
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
      if ($r.version -and $have -eq 'false') { continue }
      $r.steps += @{ action = 'configure'; cmd = "codebase-memory-mcp config set $key false"; rollback = "codebase-memory-mcp config set $key true" }
      $shown = if ($have) { $have } else { 'not set' }
      if ($r.version -and $r.level -ne 'red') { $r.level = 'red'; $r.reason = 'not-configured'; $r.note = "$key is $shown; the kit keeps it false so indexing runs only when asked" }
    }
    $rows += $r

    $r = New-Row 'mempalace' 'MemPalace' 'about 500 MB' 'remembers decisions between sessions, on your machine only'
    $r.version = Get-Ver 'mempalace'
    Set-Grade $r $Min['mempalace'] @(@{ action = 'install'; cmd = "uv tool install mempalace==$MempalaceVersion"; rollback = 'uv tool uninstall mempalace' })
    $ps = Get-PluginSteps $Mp
    if ($ps.Count) { $r.steps += $ps; if ($r.level -ne 'red') { $r.level = 'red'; $r.reason = 'plugin-missing'; $r.note = 'the Claude Code plugin is not installed' } }
    $mdir = Get-MempalaceDir
    $cfgFile = Join-Path $mdir 'config.json'
    $cfg = Read-Json $cfgFile
    $palace = if ($cfg -and $cfg.palace_path) { $cfg.palace_path } else { Join-Path $mdir 'palace' }
    $notes = @()
    if (-not (Test-Path $palace)) {
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
    return ,$rows
  }

  function Show-Table($rows) {
    $colors = @{ green = 'Green'; yellow = 'Yellow'; red = 'Red' }
    foreach ($r in $rows) {
      Write-Host ('  {0,-7}' -f $r.level) -ForegroundColor $colors[$r.level] -NoNewline
      Write-Host (' {0,-22} {1}' -f $r.label, ((@($r.version, $r.note) | Where-Object { $_ }) -join ', '))
    }
  }
  function Write-Ledger($tool, $step, $ok) {
    $v = @{ 'uv' = $UvVersion; 'claude-code' = $ClaudeVersion; 'codebase-memory-mcp' = $CbmVersion; 'mempalace' = $MempalaceVersion; 'skillspector' = $SkillspectorCommit; 'gitleaks' = $GitleaksVersion; 'oh-my-claudecode' = $OmcVersion }[$tool]
    $line = [ordered]@{ ts = (Get-Date).ToUniversalTime().ToString('o'); via = 'install.ps1'; tool = $tool; action = $step.action; version = $v; command = $step.cmd; ok = $ok; rollback = $step.rollback } | ConvertTo-Json -Compress
    New-Item -ItemType Directory -Force -Path $FkHome | Out-Null
    [IO.File]::AppendAllText($Ledger, $line + "`n")
  }
  function Write-Status($rows) {
    $tools = [ordered]@{}
    foreach ($r in $rows) { $tools[$r.id] = [ordered]@{ level = $r.level; reason = $r.reason; version = $r.version; min = $Min[$r.id]; note = $r.note } }
    $doc = [ordered]@{ ts = (Get-Date).ToUniversalTime().ToString('o'); checked_by = 'install.ps1'; lock_checked = $LockChecked; tools = $tools } | ConvertTo-Json -Depth 5
    New-Item -ItemType Directory -Force -Path $FkHome | Out-Null
    [IO.File]::WriteAllText($StatusFile, $doc)
  }

  Write-Host ''
  Write-Host 'Founder Kit setup' -ForegroundColor Cyan
  Write-Host "Checking what is already on this computer ($([Environment]::OSVersion.VersionString))..."
  Update-SessionPath
  $rows = Get-State
  Show-Table $rows
  $todo = @($rows | Where-Object { $_.steps.Count -gt 0 })

  if ($todo.Count -eq 0) {
    if (-not $DryRun) { Write-Status $rows }
    Write-Host ''; Write-Host 'Everything is already in place.' -ForegroundColor Green
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
    Write-Host '  Nothing is uninstalled or downgraded. Every change is logged with an undo hint in ~/.fk/install-ledger.jsonl.'
    Write-Host '  Windows may ask for permission to install (a blue or yellow prompt). Say yes.'
    if ($DryRun) { Write-Host ''; Write-Host 'Dry run: nothing was changed.'; return }
    $go = $Yes
    if (-not $go) { $a = Read-Host 'Install and set up these now? [Y/n]'; $go = -not ($a -match '^\s*n') }
    if (-not $go) { Write-Status $rows; Write-Host 'Nothing was installed. Run this again whenever you are ready.'; return }

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

Install-FounderKit -Yes:($Yes -or $env:FK_YES -eq '1') -DryRun:($DryRun -or $env:FK_DRY_RUN -eq '1') -WithGh:($WithGh -or $env:FK_WITH_GH -eq '1')
