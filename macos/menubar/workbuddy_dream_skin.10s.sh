#!/bin/bash
# WorkBuddy Dream Skin — SwiftBar plugin
# Place in SwiftBar's plugin folder (e.g. ~/Library/Application Support/SwiftBar)
# Shows 🎨 in the menu bar with Apply / Pause / Switch / Import.
set -euo pipefail

INSTALL_ROOT="$HOME/Library/Application Support/WorkBuddyDreamSkinStudio"
SCRIPT_DIR="$INSTALL_ROOT/scripts"
THEMES="$INSTALL_ROOT/state/themes"
PORT=9341

if [ ! -d "$SCRIPT_DIR" ]; then
  echo "🎨 Skin"
  echo "---"
  echo "WorkBuddy Dream Skin not installed"
  echo "Run the Install launcher first."
  exit 0
fi

echo "🎨 Skin"
echo "---"

# Status line
if [ -f "$INSTALL_ROOT/state/state.json" ]; then
  SESSION="$(/usr/bin/plutil -extract session raw -o - "$INSTALL_ROOT/state/operation-state.plist" 2>/dev/null || true)"
  case "$SESSION" in
    applying) echo "状态: 应用中…" ;;
    success|active) echo "状态: 已启用 ✅" ;;
    paused) echo "状态: 已暂停 ⏸" ;;
    *) echo "状态: 未知" ;;
  esac
else
  echo "状态: 未安装"
fi
echo "---"

echo "应用 / 恢复 | bash=$SCRIPT_DIR/start-dream-skin-macos.sh param1=--prompt-restart terminal=false"
echo "暂停 | bash=$SCRIPT_DIR/pause-dream-skin-macos.sh terminal=false"
echo "校验 | bash=$SCRIPT_DIR/verify-dream-skin-macos.sh terminal=false"
echo "还原 (重启 WorkBuddy) | bash=$SCRIPT_DIR/restore-dream-skin-macos.sh param1=--restart-workbuddy terminal=false"
echo "---"

# Preset switcher
echo "切换预设 ▶"
if [ -d "$THEMES" ]; then
  for p in "$THEMES"/preset-*/; do
    [ -d "$p" ] || continue
    id="$(/usr/bin/basename "$p")"
    name="$(/usr/bin/defaults read "$p/theme.json" name 2>/dev/null || echo "$id")"
    echo "  $name | bash=$SCRIPT_DIR/switch-theme-macos.sh param1=--id param2=$id terminal=false"
  done
fi
echo "---"
echo "导入自己的背景图 | bash=$SCRIPT_DIR/customize-theme-macos.sh terminal=false refresh=true"
echo "诊断 | bash=$SCRIPT_DIR/doctor-macos.sh terminal=true"
