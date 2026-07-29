#!/bin/bash
set -Eeuo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"
OPERATION_TOKEN=""; OPERATION_FINISHED="false"; VERIFY_OUTPUT=""
record_start_exit() {
  local code="$1"
  [ "$code" -ne 0 ] || return 0; [ "$OPERATION_FINISHED" != "true" ] || return 0; [ -n "${OPERATION_TOKEN:-}" ] || return 0
  ensure_state_root 2>/dev/null || true
  if [ -f "$STATE_PATH" ] && [ -n "${NODE:-}" ]; then
    local cs; cs="$(state_field session 2>/dev/null || true)"; [ "$cs" != "applying" ] || mark_state_stale 2>/dev/null || true
  fi
  printf '%s exit=%s\n' "$(/bin/date -u '+%Y-%m-%dT%H:%M:%SZ')" "$code" >> "$START_ERROR_LOG" 2>/dev/null || true
  printf 'WorkBuddy Dream Skin: start failed (exit %s). See %s\n' "$code" "$START_ERROR_LOG" >&2
}
trap 'code=$?; record_start_exit "$code"' EXIT

PORT=9341; RESTART_EXISTING="false"; PROMPT_RESTART="false"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --port) PORT="${2:-}"; shift 2 ;;
    --restart-existing) RESTART_EXISTING="true"; shift ;;
    --prompt-restart) PROMPT_RESTART="true"; shift ;;
    *) fail "Unknown start argument: $1" ;;
  esac
done
case "$PORT" in ''|*[!0-9]*) fail "Invalid port: $PORT" ;; esac
[ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || fail "Port must be 1024–65535."

ensure_state_root
discover_workbuddy_app
require_macos_runtime

if [ -f "$STATE_PATH" ]; then saved_port="$(state_field port 2>/dev/null || true)"; [ -n "$saved_port" ] && PORT="$saved_port"; fi
DEBUG_READY="false"; verified_cdp_endpoint "$PORT" && DEBUG_READY="true"

if [ "$DEBUG_READY" = "true" ]; then
  # Hot path: CDP is already open on the running WorkBuddy. Just re-apply.
  OPERATION_TOKEN="$(new_operation_token)"; write_operation_state applying "正在应用皮肤" "$OPERATION_TOKEN" || true
  if "$NODE" "$INJECTOR" --once --port "$PORT" --theme-dir "$THEME_DIR" --timeout-ms 20000 >/dev/null 2>&1; then
    INJECTOR_PID="$(launch_injector_daemon "$PORT")"
    CODE_PID="$(workbuddy_main_pids | /usr/bin/head -n 1)"
    write_state "$PORT" "$INJECTOR_PID" "$(process_started_at "$INJECTOR_PID")" "${CODE_PID:-0}" active
    write_operation_state success "皮肤已应用" "$OPERATION_TOKEN" || true; OPERATION_FINISHED="true"
    printf 'WorkBuddy Dream Skin %s is active on existing port %s.\n' "$SKIN_VERSION" "$PORT"; exit 0
  fi
fi

if workbuddy_is_running; then
  if [ "$PROMPT_RESTART" = "true" ] && [ "$RESTART_EXISTING" = "false" ]; then
    if ! /usr/bin/osascript -e 'display dialog "WorkBuddy 需要重启一次才能启用皮肤（约 10–30 秒）。" buttons {"取消","重启并应用"} default button "重启并应用" with title "WorkBuddy Dream Skin"' >/dev/null; then
      write_operation_state cancelled "操作已取消" "$OPERATION_TOKEN" 2>/dev/null || true; OPERATION_FINISHED="true"; exit 0
    fi
    RESTART_EXISTING="true"
  fi
  [ "$RESTART_EXISTING" = "true" ] || fail "WorkBuddy is running without the skin debug port. Close it first or pass --restart-existing."
  stop_workbuddy true
fi

[ -f "$STATE_PATH" ] && stop_recorded_injector
PORT="$(select_available_port "$PORT")"
printf 'Launching WorkBuddy with skin debug port %s…\n' "$PORT" >&2
launch_workbuddy_with_cdp "$PORT"
if [ "$DEBUG_READY" = "false" ]; then
  INJECTOR_PID="$(launch_injector_daemon "$PORT")"
  /usr/bin/open -na "$WORKBUDDY_BUNDLE" --args --remote-debugging-address=127.0.0.1 --remote-debugging-port="$PORT" >/dev/null 2>&1 || true
  wait_for_cdp "$PORT" || { [ -n "$INJECTOR_PID" ] && /bin/kill -TERM "$INJECTOR_PID" 2>/dev/null || true; fail "WorkBuddy did not expose a loopback CDP endpoint on $PORT within 45s."; }
fi

INJECTOR_PID="$(launch_injector_daemon "$PORT")"
/bin/sleep 0.15; /bin/kill -0 "$INJECTOR_PID" 2>/dev/null || fail "The injector exited during startup. See $INJECTOR_ERROR_LOG"
CODE_PID="$(workbuddy_main_pids | /usr/bin/head -n 1)"
write_state "$PORT" "$INJECTOR_PID" "$(process_started_at "$INJECTOR_PID")" "${CODE_PID:-0}" active

VERIFY_OUTPUT="$(/usr/bin/mktemp "${TMPDIR:-/tmp}/dream-skin-verify.XXXXXX")"; /bin/chmod 600 "$VERIFY_OUTPUT"
cleanup_verify() { [ -z "${VERIFY_OUTPUT:-}" ] || /bin/rm -f "$VERIFY_OUTPUT"; VERIFY_OUTPUT=""; }
if "$NODE" "$INJECTOR" --verify --port "$PORT" --theme-dir "$THEME_DIR" --timeout-ms 20000 >"$VERIFY_OUTPUT" 2>/dev/null; then verify_code=0; else verify_code=$?; fi
if [ "$verify_code" -ne 0 ]; then
  "$NODE" "$INJECTOR" --once --port "$PORT" --theme-dir "$THEME_DIR" --timeout-ms 15000 >/dev/null 2>&1 || true
  "$NODE" "$INJECTOR" --verify --port "$PORT" --theme-dir "$THEME_DIR" --timeout-ms 12000 >"$VERIFY_OUTPUT" 2>/dev/null && verify_code=0 || verify_code=$?
fi
cleanup_verify
[ "$verify_code" -ne 0 ] && { stop_recorded_injector 2>/dev/null || true; mark_state_stale 2>/dev/null || true; fail "Injection verification failed."; }
mark_state_active || fail "Could not commit active skin state."
write_operation_state success "皮肤已应用" "$OPERATION_TOKEN" 2>/dev/null || true; OPERATION_FINISHED="true"
printf 'WorkBuddy Dream Skin %s is active on loopback port %s.\n' "$SKIN_VERSION" "$PORT"
