# WorkBuddy Dream Skin — Windows pause
. "$PSScriptRoot\common-windows.ps1"
$port = 9341
for ($i=0; $i -lt $args.Count; $i++) { if ($args[$i] -eq "--port") { $port = [int]$args[++$i] } }
$node = Find-Node; Ensure-StateRoot
$injPid = $null
if (Test-Path $StatePath) { $injPid = (Get-Content $StatePath | ConvertFrom-Json).injectorPid }
if ($injPid) { Stop-Process -Id $injPid -Force -ErrorAction SilentlyContinue }
if (Port-BelongsToWorkBuddy $port) { & $node $Injector --restore --port $port --theme-dir $ThemeDir 2>$null }
if (Test-Path $StatePath) { $s = Get-Content $StatePath | ConvertFrom-Json; $s.session = "paused"; $s | ConvertTo-Json | Set-Content -Path $StatePath -Encoding utf8 }
Write-Host "WorkBuddy Dream Skin paused. Run start-dream-skin.ps1 to resume."
