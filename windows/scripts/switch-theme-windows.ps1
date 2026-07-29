# WorkBuddy Dream Skin — Windows switch theme
. "$PSScriptRoot\common-windows.ps1"
$port = 9341; $id = ""; $file = ""
for ($i=0; $i -lt $args.Count; $i++) {
  if ($args[$i] -eq "--id") { $id = $args[++$i] }
  if ($args[$i] -eq "--file") { $file = $args[++$i] }
  if ($args[$i] -eq "--port") { $port = [int]$args[++$i] }
}
$node = Find-Node; Ensure-StateRoot
if ($id) { $src = Join-Path $ThemesRoot $id } elseif ($file) { $src = Split-Path $file } else { Write-Error "Pass --id <preset-id> or --file <path>"; exit 1 }
if (-not (Test-Path (Join-Path $src "theme.json"))) { Fail "Theme not found: $src" }

if (Test-Path (Join-Path $ThemeDir "theme.json")) { Copy-Item (Join-Path $ThemeDir "theme.json") $ThemeBackup -Force }
New-Item -ItemType Directory -Path $ThemeDir -Force | Out-Null
Copy-Item (Join-Path $src "theme.json") $ThemeDir
foreach ($ext in @("jpg","jpeg","png","webp")) { $bg = Join-Path $src "background.$ext"; if (Test-Path $bg) { Copy-Item $bg $ThemeDir } }

Write-Host "Switched active theme to: $(Split-Path $src -Leaf)"
if (Port-BelongsToWorkBuddy $port) {
  & $node $Injector --once --port $port --theme-dir $ThemeDir --timeout-ms 20000
  Write-Host "Theme applied live."
} else {
  Write-Host "CDP not open — theme set; it will apply on next start."
}
