<#
.SYNOPSIS
  One-stop installer for claude-sessions on Windows (PowerShell).

.DESCRIPTION
  PowerShell mirror of install.sh. Run it two ways:
    - From a clone:   .\install.ps1
    - Piped from URL: irm https://<host>/install.ps1 | iex

  Piped (bootstrap) mode clones the repo to a stable directory and builds it
  there; from a clone it builds in place. Either way it then:
    1. Builds the claude-sessions CLI and puts its binary on your PATH (via a
       claude-sessions.cmd shim + a user-PATH entry).
    2. Installs the `claude-session` skill globally for Claude Code.
    3. Installs the global Claude Code hooks (SessionStart + UserPromptSubmit + Stop).

  After this runs you still need a server to talk to and a login:
    claude-sessions login --server <url>
    claude-sessions enable .

.PARAMETER Ref
  Git ref to clone/build in bootstrap mode (default: main, or $env:CLAUDE_SESSIONS_REF).

.PARAMETER Src
  Where to clone in bootstrap mode (default: %LOCALAPPDATA%\claude-sessions).

.PARAMETER BinDir
  Where to write the claude-sessions.cmd shim (default: %USERPROFILE%\.local\bin).

.PARAMETER NoBuild
  Skip `bun install` + build (use an existing dist/).

.PARAMETER SkipSkill
  Don't install the skill.

.PARAMETER SkipHooks
  Don't install the Claude Code hooks.
#>
[CmdletBinding()]
param(
  [string]$Ref,
  [string]$Src,
  [string]$BinDir,
  [switch]$NoBuild,
  [switch]$SkipSkill,
  [switch]$SkipHooks
)

$ErrorActionPreference = 'Stop'

# --- defaults (params > env > built-in) ---------------------------------------
if (-not $Ref)    { $Ref    = if ($env:CLAUDE_SESSIONS_REF) { $env:CLAUDE_SESSIONS_REF } else { 'main' } }
if (-not $Src)    { $Src    = if ($env:CLAUDE_SESSIONS_SRC) { $env:CLAUDE_SESSIONS_SRC } else { Join-Path $env:LOCALAPPDATA 'claude-sessions' } }
if (-not $BinDir) { $BinDir = Join-Path $env:USERPROFILE '.local\bin' }
$RepoUrl   = if ($env:CLAUDE_SESSIONS_REPO) { $env:CLAUDE_SESSIONS_REPO } else { 'https://github.com/vertexcover-io/claude-sessions.git' }
$ClaudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }

# --- pretty logging -----------------------------------------------------------
function Step($m) { Write-Host "==> $m" -ForegroundColor White }
function Ok($m)   { Write-Host "  + $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  ! $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "error: $m" -ForegroundColor Red; exit 1 }
function Have($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }

# --- mode detection: in-repo vs bootstrap -------------------------------------
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { $null }
if ($ScriptDir -and (Test-Path (Join-Path $ScriptDir 'packages\cli\package.json'))) {
  $RepoRoot = $ScriptDir
} else {
  if (-not (Have 'git')) { Die "git is required to bootstrap. Install it (winget install Git.Git), then re-run." }
  if (-not (Have 'bun')) { Die "bun is required to build. Install it: powershell -c `"irm bun.sh/install.ps1 | iex`"" }
  if (Test-Path (Join-Path $Src '.git')) {
    Step "Updating existing clone at $Src ($Ref)"
    git -C $Src fetch --depth 1 origin $Ref
    if ($LASTEXITCODE -ne 0) { Die "git fetch failed" }
    git -C $Src reset --hard FETCH_HEAD
    if ($LASTEXITCODE -ne 0) { Die "git reset failed" }
  } else {
    Step "Cloning $RepoUrl ($Ref) into $Src"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Src) | Out-Null
    git clone --depth 1 --branch $Ref $RepoUrl $Src
    if ($LASTEXITCODE -ne 0) { Die "git clone failed" }
  }
  $RepoRoot = $Src
  if (-not (Test-Path (Join-Path $RepoRoot 'packages\cli\package.json'))) { Die "clone at $RepoRoot is missing packages\cli — wrong ref?" }
}

$CliEntry = Join-Path $RepoRoot 'packages\cli\dist\main.js'

# --- 1. build + shim the CLI --------------------------------------------------
if (-not $NoBuild) {
  if (-not (Have 'bun')) { Die "bun is required to build. Install it: powershell -c `"irm bun.sh/install.ps1 | iex`"" }
  Step "Installing workspace dependencies (bun install)"
  Push-Location $RepoRoot; try { bun install; if ($LASTEXITCODE -ne 0) { Die "bun install failed" } } finally { Pop-Location }
  Step "Building the CLI and its workspace dependencies"
  # turbo's ^build makes core + adapter-claude build before the CLI.
  Push-Location $RepoRoot; try { bun x turbo run build --filter=@claude-sessions/cli; if ($LASTEXITCODE -ne 0) { Die "build failed" } } finally { Pop-Location }
  Ok "built packages\cli\dist\main.js"
} else {
  Step "Skipping build (-NoBuild)"
}

if (-not (Test-Path $CliEntry)) { Die "CLI not built: $CliEntry missing. Run without -NoBuild." }
if (-not (Have 'node')) { Warn "node not found on PATH — the CLI needs Node 22+ at runtime." }

Step "Writing the claude-sessions shim into $BinDir"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$shim = Join-Path $BinDir 'claude-sessions.cmd'
# %* forwards all args; node runs the built entry point.
Set-Content -Path $shim -Encoding ASCII -Value "@node `"$CliEntry`" %*"
Ok "$shim -> node $CliEntry"

# Ensure $BinDir is on the user PATH for future shells.
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$onPath = $userPath -and (($userPath -split ';') -contains $BinDir)
if (-not $onPath) {
  $newPath = if ([string]::IsNullOrEmpty($userPath)) { $BinDir } else { "$($userPath.TrimEnd(';'));$BinDir" }
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
  Warn "$BinDir was added to your user PATH. Open a new terminal for it to take effect."
} else {
  Ok "$BinDir is on your PATH"
}
# Make the shim usable in this session too.
$env:Path = "$env:Path;$BinDir"
$CS = $shim

# --- 2. install the skill globally --------------------------------------------
if (-not $SkipSkill) {
  $skillSrc = Join-Path $RepoRoot 'skills\claude-session'
  $skillDst = Join-Path $ClaudeDir 'skills\claude-session'
  if (-not (Test-Path $skillSrc)) { Die "skill source missing: $skillSrc" }
  Step "Installing the claude-session skill into $skillDst"
  New-Item -ItemType Directory -Force -Path (Join-Path $ClaudeDir 'skills') | Out-Null
  if (Test-Path $skillDst) { Remove-Item -Recurse -Force $skillDst }
  Copy-Item -Recurse -Force $skillSrc $skillDst
  Ok "skill installed"
} else {
  Step "Skipping skill install (-SkipSkill)"
}

# --- 3. install the global hooks ----------------------------------------------
if (-not $SkipHooks) {
  Step "Installing the global Claude Code hooks"
  & node $CliEntry install-hooks
  if ($LASTEXITCODE -ne 0) { Die "install-hooks failed" }
} else {
  Step "Skipping hook install (-SkipHooks)"
}

# --- done ---------------------------------------------------------------------
Write-Host ""
Write-Host "claude-sessions is installed." -ForegroundColor White -NoNewline
Write-Host " Next steps:"
Write-Host "  1. Point the CLI at a running server and log in:"
Write-Host "       claude-sessions login --server <url>" -ForegroundColor DarkGray
Write-Host "  2. Enable capture for a repo (run inside it):"
Write-Host "       claude-sessions enable ." -ForegroundColor DarkGray
Write-Host "  3. Check it:"
Write-Host "       claude-sessions status" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Note: the CLI does not run the server. Start one separately" -ForegroundColor Yellow
Write-Host "       (see README 'Quickstart - server') or point --server at a deployment."
