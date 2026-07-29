# WorkBuddy Dream Skin — Windows installer
. "$PSScriptRoot\common-windows.ps1"

$port = 9341
$createShortcut = $true
$launchTray = $false
for ($i=0; $i -lt $args.Count; $i++) {
  if ($args[$i] -eq "--port") { $port = [int]$args[++$i] }
  if ($args[$i] -eq "--no-shortcut") { $createShortcut = $false }
  if ($args[$i] -eq "--tray") { $launchTray = $true }
}

$exe = Find-WorkBuddy
$node = Find-Node
Ensure-StateRoot
Seed-Presets

# Default active theme = first preset.
if (-not (Test-Path (Join-Path $ThemeDir "theme.json"))) {
  $first = Get-ChildItem $ThemesRoot -Directory | Where-Object { $_.Name -like "preset-*" } | Select-Object -First 1
  if ($first) {
    Copy-Item (Join-Path $first.FullName "theme.json") $ThemeDir
    foreach ($ext in @("jpg","jpeg","png","webp")) {
      $bg = Join-Path $first.FullName "background.$ext"
      if (Test-Path $bg) { Copy-Item $bg $ThemeDir }
    }
  }
}

if ($createShortcut) {
  $ws = New-Object -ComObject WScript.Shell
  $desktop = [Environment]::GetFolderPath("Desktop")
  $lnk = $ws.CreateShortcut("$desktop\WorkBuddy Dream Skin.lnk")
  $lnk.TargetPath = "powershell.exe"
  $lnk.Arguments = "-ExecutionPolicy Bypass -File `"$PSScriptRoot\start-dream-skin.ps1`""
  $lnk.WorkingDirectory = $PSScriptRoot
  $lnk.Save()
}

Write-Host "WorkBuddy Dream Skin $SKIN_VERSION installed. WorkBuddy: $exe"
Write-Host "Presets ready in $ThemesRoot — use the system tray to switch, or run start-dream-skin.ps1"

if ($launchTray) { & "$PSScriptRoot\tray-dream-skin.ps1" }
