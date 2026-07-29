#!/bin/bash
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"
PORT="${PORT:-9341}"
while [ "$#" -gt 0 ]; do case "$1" in --port) PORT="${2:-}"; shift 2 ;; *) shift ;; esac; done
discover_workbuddy_app; require_macos_runtime; ensure_state_root
verified_cdp_endpoint "$PORT" || fail "No verified WorkBuddy CDP endpoint on port $PORT."
"$NODE" "$INJECTOR" --verify --port "$PORT" --theme-dir "$THEME_DIR" --timeout-ms 20000 \
  && { printf 'WorkBuddy Dream Skin: verify OK\n'; exit 0; } \
  || { printf 'WorkBuddy Dream Skin: verify FAILED\n' >&2; exit 1; }
