# WorkBuddy Dream Skin — shared Windows helpers (dot-sourced by the .ps1 scripts)
$ErrorActionPreference = "Stop"

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectRoot = Split-Path -Parent $ScriptDir
$Injector    = Join-Path $ScriptDir "injector.mjs"
$InstallRoot = Join-Path $env:LOCALAPPDATA "WorkBuddyDreamSkinStudio"
$StateRoot   = Join-Path $InstallRoot "state"
$StatePath   = Join-Path $StateRoot "state.json"
$ThemeBackup = Join-Path $StateRoot "theme-backup.json"
$ThemeDir    = Join-Path $StateRoot "theme"
$ThemesRoot  = Join-Path $StateRoot "themes"
$SKIN_VERSION = "1.0.0"

function Fail($msg) { Write-Error "WorkBuddy Dream Skin: $msg"; exit 1 }

function Ensure-StateRoot { if (-not (Test-Path $StateRoot)) { New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null } }

function Find-WorkBuddy {
  $candidates = @(
    "$env:LOCALAPPDATA\Programs\WorkBuddy\WorkBuddy.exe",
    "$env:ProgramFiles\WorkBuddy\WorkBuddy.exe",
    "${env:ProgramFiles(x86)}\WorkBuddy\WorkBuddy.exe",
    "$env:LOCALAPPDATA\WorkBuddy\WorkBuddy.exe"
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  # Fallback: search Start Menu / Program Files for WorkBuddy.exe
  $found = Get-ChildItem -Path $env:ProgramFiles, $env:LOCALAPPDATA -Recurse -Filter WorkBuddy.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { return $found.FullName }
  Fail "Could not find WorkBuddy.exe. Set `$env:WORKBUDDY_EXE or pass the path."
}

function Find-Node {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\WorkBuddy\resources\cli\vendor\node\*.\bin\node.exe"),
    "$env:LOCALAPPDATA\Programs\WorkBuddy\resources\cli\vendor\node\node.exe"
  )
  foreach ($c in $candidates) { $m = Get-ChildItem -Path $c -ErrorAction SilentlyContinue | Select-Object -First 1; if ($m -and (Test-Path $m.FullName)) { return $m.FullName } }
  $inPath = Get-Command node -ErrorAction SilentlyContinue
  if ($inPath) { return $inPath.Source }
  Fail "No Node.js found for the injector."
}

function Port-BelongsToWorkBuddy($port) {
  try { $r = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/version" -TimeoutSec 1; return $true } catch { return $false }
}

function Wait-For-CDP($port, $timeoutSec = 45) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Port-BelongsToWorkBuddy $port) { return $true }
    Start-Sleep -Milliseconds 350
  }
  return $false
}

function WorkBuddy-Running { $exe = Find-WorkBuddy; return [bool](Get-Process -Name "WorkBuddy" -ErrorAction SilentlyContinue) }

function Stop-WorkBuddy {
  $p = Get-Process -Name "WorkBuddy" -ErrorAction SilentlyContinue
  if (-not $p) { return }
  $p | ForEach-Object { $_.CloseMainWindow() | Out-Null }
  Start-Sleep -Seconds 2
  $p = Get-Process -Name "WorkBuddy" -ErrorAction SilentlyContinue
  if ($p) { $p | Stop-Process -Force }
  Start-Sleep -Seconds 1
}

function Start-WorkBuddyWithCDP($exe, $port) {
  Stop-WorkBuddy
  Start-Process -FilePath $exe -ArgumentList "--remote-debugging-address=127.0.0.1","--remote-debugging-port=$port" -PassThru | Out-Null
}

function Start-WorkBuddyNormally($exe) { Start-Process -FilePath $exe }

function Seed-Presets {
  $src = Join-Path $ProjectRoot "presets"
  if (-not (Test-Path $src)) { return }
  if (-not (Test-Path $ThemesRoot)) { New-Item -ItemType Directory -Path $ThemesRoot -Force | Out-Null }
  foreach ($d in Get-ChildItem $src -Directory) {
    if (Test-Path (Join-Path $d.FullName "theme.json")) {
      $dest = Join-Path $ThemesRoot $d.Name
      Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
      Copy-Item $d.FullName $dest -Recurse
    }
  }
}

function Write-State($port, $injectorPid, $wbPid, $session) {
  $state = [ordered]@{
    schemaVersion=4; platform="win32"; skinVersion=$SKIN_VERSION; protocol=3; port=[int]$port;
    injectorPid=[int]$injectorPid; workbuddyPid=[int]$wbPid; projectRoot=$ProjectRoot;
    themeDir=$ThemeDir; session=$session; injectorMode="full"; createdAt=(Get-Date).ToUniversalTime().ToString("o")
  }
  $state | ConvertTo-Json | Set-Content -Path $StatePath -Encoding utf8
}

function Mark-StateActive {
  if (-not (Test-Path $StatePath)) { return }
  $s = Get-Content $StatePath | ConvertFrom-Json
  $s.session = "active"; $s.updatedAt = (Get-Date).ToUniversalTime().ToString("o")
  $s | ConvertTo-Json | Set-Content -Path $StatePath -Encoding utf8
}
