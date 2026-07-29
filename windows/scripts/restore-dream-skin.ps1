# WorkBuddy Dream Skin — Windows restore (return to stock UI)
. "$PSScriptRoot\common-windows.ps1"

$port = 9341
$restart = $false
for ($i=0; $i -lt $args.Count; $i++) { if ($args[$i] -eq "--port") { $port = [int]$args[++$i] }; if ($args[$i] -eq "--restart-workbuddy") { $restart = $true } }

$exe = Find-WorkBuddy
$node = Find-Node
Ensure-StateRoot

# Stop injector daemon.
$injPid = $null
if (Test-Path $StatePath) { $injPid = (Get-Content $StatePath | ConvertFrom-Json).injectorPid }
if ($injPid) { Stop-Process -Id $injPid -Force -ErrorAction SilentlyContinue }

# Tear down skin in the live renderer.
if (Port-BelongsToWorkBuddy $port) { & $node $Injector --restore --port $port --theme-dir $ThemeDir 2>$null }

# Backup what was applied.
if (Test-Path (Join-Path $ThemeDir "theme.json")) { Copy-Item (Join-Path $ThemeDir "theme.json") $ThemeBackup -Force }

if ($restart) {
  Stop-WorkBuddy
  Start-Sleep -Seconds 1
  Start-WorkBuddyNormally $exe
  Write-Host "WorkBuddy restarted without the skin debug port — original UI restored."
} else {
  Write-Host "Skin removed. Relaunch WorkBuddy normally for a fully stock UI, or run Restore which restarts it."
}
