#!/bin/bash
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"
PLUGIN_SRC="$PROJECT_ROOT/menubar/workbuddy_dream_skin.10s.sh"
SWIFTBAR_PLUGINS="$HOME/Library/Application Support/SwiftBar"
if [ ! -d "$SWIFTBAR_PLUGINS" ]; then
  printf 'SwiftBar not found at %s.\n' "$SWIFTBAR_PLUGINS"
  printf 'Install SwiftBar (https://swiftbar.app) then re-run this installer, or skip the menu bar — the Desktop launchers work without it.\n'
  exit 0
fi
/bin/mkdir -p "$SWIFTBAR_PLUGINS"
/bin/cp "$PLUGIN_SRC" "$SWIFTBAR_PLUGINS/"
/bin/chmod 700 "$SWIFTBAR_PLUGINS/workbuddy_dream_skin.10s.sh"
printf 'Menu bar plugin installed into SwiftBar. Look for 🎨 in the top-right menu bar.\n'
