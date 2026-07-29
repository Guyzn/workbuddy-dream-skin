#!/bin/bash
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"
PORT="${PORT:-9341}"
while [ "$#" -gt 0 ]; do case "$1" in --port) PORT="${2:-}"; shift 2 ;; *) shift ;; esac; done
discover_workbuddy_app; require_macos_runtime; ensure_state_root
stop_recorded_injector 2>/dev/null || true
if verified_cdp_endpoint "$PORT" 2>/dev/null; then
  "$NODE" "$INJECTOR" --restore --port "$PORT" --theme-dir "$THEME_DIR" >/dev/null 2>&1 || true
fi
"$NODE" -e 'const fs=require("node:fs");const f=process.argv[1];if(fs.existsSync(f)){const s=JSON.parse(fs.readFileSync(f,"utf8"));s.session="paused";s.pausedAt=new Date().toISOString();const t=`${f}.${process.pid}.tmp`;fs.writeFileSync(t,JSON.stringify(s,null,2));fs.renameSync(t,f);}' "$STATE_PATH" 2>/dev/null || true
printf 'WorkBuddy Dream Skin paused. Run the Start launcher to resume.\n'
