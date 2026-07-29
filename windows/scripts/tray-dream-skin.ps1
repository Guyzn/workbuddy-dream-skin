# WorkBuddy Dream Skin — Windows system tray
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
. "$PSScriptRoot\common-windows.ps1"

$port = 9341
$node = Find-Node

$iconBmp = New-Object System.Drawing.Bitmap 16,16
$g = [System.Drawing.Graphics]::FromImage($iconBmp)
$g.Clear([System.Drawing.Color]::FromArgb(63,214,166))
$g.FillEllipse([System.Drawing.Brushes]::White, 4,4,8,8)
$g.Dispose()

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = [System.Drawing.Icon]::FromHandle($iconBmp.GetHicon())
$tray.Text = "WorkBuddy Dream Skin"
$tray.Visible = $true

function Run-Script($script, $extra="") {
  Start-Process -FilePath "powershell.exe" -ArgumentList "-ExecutionPolicy Bypass -File `"$PSScriptRoot\$script`" $extra" -NoNewWindow -Wait
}

$menu = New-Object System.Windows.Forms.ContextMenuStrip
function Add-Item($text, $action) {
  $it = $menu.Items.Add($text)
  $it.add_Click($action)
  return $it
}

Add-Item "应用 / 恢复" { Run-Script "start-dream-skin.ps1" "--no-prompt" }
Add-Item "暂停" { Run-Script "pause-dream-skin.ps1" }
Add-Item "校验" { Run-Script "verify-dream-skin.ps1" }
Add-Item "还原 (重启 WorkBuddy)" { Run-Script "restore-dream-skin.ps1" "--restart-workbuddy" }
$menu.Items.Add("-") | Out-Null
$switchParent = $menu.Items.Add("切换预设")
if (Test-Path $ThemesRoot) {
  foreach ($d in Get-ChildItem $ThemesRoot -Directory | Where-Object { $_.Name -like "preset-*" }) {
    $sub = $switchParent.DropDownItems.Add($d.Name)
    $id = $d.Name
    $sub.add_Click({ Run-Script "switch-theme-windows.ps1" "--id $id" })
  }
}
$menu.Items.Add("-") | Out-Null
Add-Item "退出托盘" { $tray.Visible = $false; [System.Windows.Forms.Application]::Exit() } | Out-Null

$tray.add_MouseDown({
  if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Left) { $menu.Show([System.Windows.Forms.Control]::MousePosition) }
})

Write-Host "WorkBuddy Dream Skin tray running. Right-click the tray icon for the menu."
[System.Windows.Forms.Application]::Run()
