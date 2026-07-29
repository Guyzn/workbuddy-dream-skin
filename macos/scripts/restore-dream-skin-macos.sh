#!/bin/bash
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"
RESTART_WORKBUDDY="false"; RESTORE_BASE="false"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --restart-workbuddy) RESTART_WORKBUDDY="true"; shift ;;
    --restore-base-theme) RESTORE_BASE="true"; shift ;;
    --port) PORT="${2:-}"; shift 2 ;;
    *) fail "Unknown restore argument: $1" ;;
  esac
done
PORT="${PORT:-9341}"

discover_workbuddy_app 2>/dev/null || true
require_macos_runtime 2>/dev/null || true
ensure_state_root

# Stop the injector daemon.
stop_recorded_injector 2>/dev/null || true

# Ask the live renderer to tear down the skin (returns WorkBuddy to stock UI).
if verified_cdp_endpoint "$PORT" 2>/dev/null; then
  "$NODE" "$INJECTOR" --restore --port "$PORT" --theme-dir "$THEME_DIR" >/dev/null 2>&1 || true
fi

# Preserve a backup of what was applied (so the user can re-apply later).
if [ -f "$THEME_DIR/theme.json" ]; then
  /bin/mkdir -p "$(dirname "$THEME_BACKUP_PATH")"
  /bin/cp "$THEME_DIR/theme.json" "$THEME_BACKUP_PATH" 2>/dev/null || true
fi

mark_state_stale 2>/dev/null || true
clear_operation_state 2>/dev/null || true

if [ "$RESTART_WORKBUDDY" = "true" ]; then
  workbuddy_is_running && stop_workbuddy true
  /bin/sleep 0.5
  launch_workbuddy_normally
  printf 'WorkBuddy restarted without the skin debug port — original UI restored.\n'
else
  printf 'Skin removed. Relaunch WorkBuddy normally (no debug flag) for a fully stock UI, or run Restore which restarts it.\n'
fi
