<#
.SYNOPSIS
  WorkBuddy Dream Skin - 探测 WorkBuddy.exe / Node.js / CDP 状态
.DESCRIPTION
  打印自动探测到的 WorkBuddy.exe、node 路径和 CDP 端口状态，用于排查
  start-dream-skin.ps1 找不到应用或 CDP 无法就绪的问题。
.EXAMPLE
  .\find-workbuddy.ps1
  .\find-workbuddy.ps1 -Port 9341
#>
param(
  [int]$Port = 9341
)
$ErrorActionPreference = 'Continue'
# Dot-source the shared helpers. common-windows.ps1 sets Stop internally;
# wrap calls in try/catch so diagnostics never hard-crash this script.
. "$PSScriptRoot\common-windows.ps1"

function Test-EnvHint {
  if ($env:WORKBUDDY_EXE) {
    Write-Host "  env WORKBUDDY_EXE = $env:WORKBUDDY_EXE $(if (Test-Path -LiteralPath $env:WORKBUDDY_EXE) { '[OK]' } else { '[MISSING]' })"
  } else {
    Write-Host "  env WORKBUDDY_EXE = (not set)"
  }
}

Write-Host "=== WorkBuddy Dream Skin 探测结果 ==="
Write-Host ""
Write-Host "[1] WorkBuddy.exe"
Test-EnvHint
$exe = $null
try { $exe = Find-WorkBuddy } catch { $exe = $null }
Write-Host "  resolved: $(if ($exe) { $exe } else { '未找到' })"
if (-not $exe) {
  Write-Host ""
  Write-Host "  未找到 WorkBuddy.exe，请用以下方式之一指定："
  Write-Host "    1. 设置环境变量：`$env:WORKBUDDY_EXE = 'C:\path\to\WorkBuddy.exe'"
  Write-Host "    2. 先安装 WorkBuddy 桌面端（本工具只作用于桌面端，不是网页版）"
}

Write-Host ""
Write-Host "[2] Node.js"
$node = $null
try { $node = Find-Node } catch { $node = $null }
Write-Host "  resolved: $(if ($node) { $node } else { '未找到' })"
if ($node) {
  try { $v = & $node --version; Write-Host "  version:  $v" } catch { Write-Host "  version:  (unable to run)" }
} else {
  Write-Host "  未找到 node。请安装 Node >= 20，或确认 WorkBuddy 自带 node 存在。"
}

Write-Host ""
Write-Host "[3] CDP 端口 $Port"
if (Port-BelongsToWorkBuddy $Port) {
  Write-Host "  status: OK — WorkBuddy renderer (renderer/index.html) 已在该端口暴露 CDP"
} else {
  $http = $false
  try { $r = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 1; $http = $true } catch { $http = $false }
  if ($http) {
    Write-Host "  status: 端口有响应，但未匹配 WorkBuddy renderer（可能是其他程序占用）"
  } else {
    Write-Host "  status: 无响应 — WorkBuddy 当前未以 debug 端口运行"
    Write-Host "  提示：运行 start-dream-skin.ps1 会以该端口重启 WorkBuddy 并自动注入。"
  }
}

Write-Host ""
Write-Host "=== 完成 ==="
