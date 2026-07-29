# WorkBuddy Dream Skin — Windows verify
. "$PSScriptRoot\common-windows.ps1"
$port = 9341
for ($i=0; $i -lt $args.Count; $i++) { if ($args[$i] -eq "--port") { $port = [int]$args[++$i] } }
$node = Find-Node
Ensure-StateRoot
if (-not (Port-BelongsToWorkBuddy $port)) { Write-Error "No verified WorkBuddy CDP endpoint on port $port."; exit 1 }
& $node $Injector --verify --port $port --theme-dir $ThemeDir --timeout-ms 20000
if ($LASTEXITCODE -eq 0) { Write-Host "WorkBuddy Dream Skin: verify OK" } else { Write-Error "WorkBuddy Dream Skin: verify FAILED"; exit 1 }
