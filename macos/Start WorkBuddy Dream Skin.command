#!/bin/bash
# WorkBuddyDreamSkinStudio launcher
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
exec "$SCRIPT_DIR/scripts/start-dream-skin-macos.sh" --prompt-restart
