#!/bin/bash
# WorkBuddyDreamSkinStudio launcher
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
exec "$SCRIPT_DIR/scripts/restore-dream-skin-macos.sh" --restart-workbuddy
