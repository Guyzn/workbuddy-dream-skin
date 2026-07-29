# WorkBuddy Dream Skin — Windows start / apply
. "$PSScriptRoot\common-windows.ps1"

$port = 9341
$promptRestart = $true
for ($i=0; $i -lt $args.Count; $i++) {
  if ($args[$i] -eq "--port") { $port = [int]$args[++$i] }
  if ($args[$i] -eq "--no-prompt") { $promptRestart = $false }
}

$exe = Find-WorkBuddy
$node = Find-Node
Ensure-StateRoot

$debugReady = Port-BelongsToWorkBuddy $port

if ($debugReady) {
  # Hot apply on the already-open debug port.
  & $node $Injector --once --port $port --theme-dir $ThemeDir --timeout-ms 20000
  $inj = Start-Process -FilePath $node -ArgumentList "$Injector --watch --port $port --theme-dir $ThemeDir" -NoNewWindow -PassThru
  Write-State $port $inj.Id (Get-Process -Name "WorkBuddy" -ErrorAction SilentlyContinue | Select-Object -First 1).Id "active"
  Mark-StateActive
  Write-Host "WorkBuddy Dream Skin active on existing port $port."
  exit 0
}

if (WorkBuddy-Running) {
  if ($promptRestart) {
    $ans = Read-Host "WorkBuddy is running. Restart it once to enable the skin? (y/N)"
    if ($ans -notmatch '^[yY]') { Write-Host "Aborted. Close WorkBuddy and re-run, or pass --no-prompt."; exit 0 }
  }
  Stop-WorkBuddy
}

Start-WorkBuddyWithCDP $exe $port
if (-not (Wait-For-CDP $port)) { Fail "WorkBuddy did not expose a loopback CDP endpoint on $port within 45s." }

$inj = Start-Process -FilePath $node -ArgumentList "$Injector --watch --port $port --theme-dir $ThemeDir" -NoNewWindow -PassThru
Start-Sleep -Seconds 2
if ($inj.HasExited) { Fail "The injector exited during startup." }

& $node $Injector --verify --port $port --theme-dir $ThemeDir --timeout-ms 20000
Write-State $port $inj.Id (Get-Process -Name "WorkBuddy" -ErrorAction SilentlyContinue | Select-Object -First 1).Id "active"
Mark-StateActive
Write-Host "WorkBuddy Dream Skin $SKIN_VERSION active on loopback port $port."
