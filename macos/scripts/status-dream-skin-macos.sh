#!/bin/bash
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"
discover_workbuddy_app 2>/dev/null || true; require_macos_runtime 2>/dev/null || true; ensure_state_root
if [ ! -f "$STATE_PATH" ]; then printf 'No WorkBuddy Dream Skin state. Not installed or never started.\n'; exit 0; fi
"$NODE" -e '
  const fs=require("node:fs");
  const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  const cdp = (()=>{ try { return require("node:child_process").execSync(`curl --noproxy "*" --silent --fail --max-time 1 http://127.0.0.1:${s.port}/json/version`).toString().trim().length>0; } catch { return false; } })();
  console.log("session      :", s.session);
  console.log("skinVersion  :", s.skinVersion);
  console.log("port         :", s.port, cdp?"(CDP open)":"(CDP closed)");
  console.log("appliedTheme :", s.appliedThemeName||s.appliedThemeId||"(none)");
  console.log("injectorPid  :", s.injectorPid);
  console.log("workbuddy    :", s.workbuddyVersion||"?");
' "$STATE_PATH"
