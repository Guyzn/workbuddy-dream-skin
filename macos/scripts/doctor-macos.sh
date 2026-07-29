#!/bin/bash
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"
PORT="${PORT:-9341}"
while [ "$#" -gt 0 ]; do case "$1" in --port) PORT="${2:-}"; shift 2 ;; *) shift ;; esac; done
echo "== WorkBuddy Dream Skin doctor =="
discover_workbuddy_app 2>/dev/null && echo "WorkBuddy     : $WORKBUDDY_BUNDLE ($WORKBUDDY_VERSION)" || echo "WorkBuddy     : NOT FOUND"
resolve_node_runtime 2>/dev/null && echo "Node runtime  : $NODE ($NODE_VERSION)" || echo "Node runtime  : NOT FOUND"
echo "State root    : $STATE_ROOT"
[ -f "$STATE_PATH" ] && echo "State         : present ($(state_field session 2>/dev/null || echo '?'))" || echo "State         : none"
if verified_cdp_endpoint "$PORT" 2>/dev/null; then
  echo "CDP endpoint  : OPEN on $PORT"
  echo "== Live renderer diagnostics =="
  "$NODE" "$INJECTOR" --inspect --port "$PORT" --theme-dir "$THEME_DIR" 2>/dev/null || echo "(inspect failed)"
else
  echo "CDP endpoint  : closed (start the skin to open it)"
  echo "Tip: run the Start launcher, then 'doctor' again to dump live DOM selectors for tuning."
fi
