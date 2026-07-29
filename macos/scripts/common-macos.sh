#!/bin/bash
# WorkBuddy Dream Skin — shared macOS helpers (WorkBuddy-adapted port)
set -euo pipefail

if [ -z "${HOME:-}" ]; then
  CURRENT_USER="$(/usr/bin/id -un)"
  HOME="$(/usr/bin/dscl . -read "/Users/$CURRENT_USER" NFSHomeDirectory 2>/dev/null | /usr/bin/awk '{print $2}')"
  [ -n "$HOME" ] || { printf 'WorkBuddy Dream Skin: could not resolve home.\n' >&2; exit 1; }
  export HOME
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
INJECTOR="$SCRIPT_DIR/injector.mjs"
INSTALL_ROOT="$HOME/Library/Application Support/WorkBuddyDreamSkinStudio"
STATE_ROOT="$INSTALL_ROOT/state"
STATE_PATH="$STATE_ROOT/state.json"
OPERATION_STATE_PATH="$STATE_ROOT/operation-state.plist"
OPERATION_ACK_PATH="$STATE_ROOT/operation-control-ack.json"
THEME_BACKUP_PATH="$STATE_ROOT/theme-backup.json"
THEME_DIR="$STATE_ROOT/theme"
INJECTOR_LOG="$STATE_ROOT/injector.log"
INJECTOR_ERROR_LOG="$STATE_ROOT/injector-error.log"
APP_LOG="$STATE_ROOT/workbuddy-launch.log"
APP_ERROR_LOG="$STATE_ROOT/workbuddy-launch-error.log"
START_ERROR_LOG="$STATE_ROOT/start-error.log"
APP_JOB_LABEL="com.workbuddy.workbuddy-dream-skin-studio.app"
INJECTOR_JOB_LABEL="com.workbuddy.workbuddy-dream-skin-studio.injector"
EXPECTED_BUNDLE_ID="com.workbuddy.workbuddy"
SKIN_VERSION="1.0.0"
DREAM_SKIN_VALIDATED_RUNTIME_PID=""
DREAM_SKIN_VALIDATED_RUNTIME_BUNDLE=""
DREAM_SKIN_VALIDATED_RUNTIME_EXE=""
DREAM_SKIN_VALIDATED_RUNTIME_NODE=""

fail() {
  local message="$*"
  if [ -n "${START_ERROR_LOG:-}" ] && [ -n "${STATE_ROOT:-}" ]; then
    /bin/mkdir -p "$STATE_ROOT" 2>/dev/null || true
    printf '%s %s\n' "$(/bin/date -u '+%Y-%m-%dT%H:%M:%SZ')" "$message" >> "$START_ERROR_LOG" 2>/dev/null || true
  fi
  printf 'WorkBuddy Dream Skin: %s\n' "$message" >&2
  exit 1
}

notify_user() {
  local message="$*"
  /usr/bin/osascript - "$message" <<'APPLESCRIPT' >/dev/null 2>&1 || true
on run argv
  display notification (item 1 of argv) with title "WorkBuddy Dream Skin"
end run
APPLESCRIPT
}

ensure_state_root() { /bin/mkdir -p "$STATE_ROOT"; /bin/chmod 700 "$STATE_ROOT"; }

new_operation_token() {
  local ts=""
  if [ -x /usr/bin/perl ]; then ts="$(LC_ALL=C /usr/bin/perl -MTime::HiRes=time -e 'printf "%.0f", time()*1000')"; else ts="$(/bin/date +%s)000"; fi
  /usr/bin/printf '%s:%s:%s\n' "$$" "$ts" "${RANDOM:-0}"
}

operation_token_is_valid() { LC_ALL=C /usr/bin/printf '%s' "$1" | LC_ALL=C /usr/bin/grep -Eq '^[0-9]{1,12}:[0-9]{13}:[0-9]{1,8}$'; }

write_operation_state() {
  local status="$1" message="${2:-}" operation_token="${3:-}" terminal_policy="${4:-match}"
  local token_guarded="false" result=0 temporary="" updated_at="" lock_path="" attempts=0 now=""
  case "$status" in applying|pausing|success|paused|cancelled|failed) ;; *) return 1 ;; esac
  case "$terminal_policy" in match|idle) ;; *) return 1 ;; esac
  case "$message" in *$'\n'*|*$'\r'*) return 1 ;; esac
  [ "${#message}" -le 240 ] || return 1
  [ -n "$operation_token" ] && token_guarded="true" || operation_token="$(new_operation_token)"
  operation_token_is_valid "$operation_token" || return 1
  ensure_state_root
  lock_path="$STATE_ROOT/.operation-state.lock"
  while ! /bin/mkdir "$lock_path" 2>/dev/null; do
    attempts=$((attempts+1)); [ "$attempts" -ge 50 ] && return 1
    local lm; lm="$(/usr/bin/stat -f '%m' "$lock_path" 2>/dev/null || true)"
    case "$lm" in ''|*[!0-9]*) ;; *) now="$(/bin/date +%s)"; [ $((now-lm)) -le 5 ] || /bin/rm -rf "$lock_path" ;; esac
    /bin/sleep 0.02
  done
  if [ "$result" -eq 0 ]; then
    temporary="$OPERATION_STATE_PATH.$$.tmp"; updated_at="$(/bin/date +%s)"; /bin/rm -f "$temporary"
    if ! /usr/bin/plutil -create xml1 "$temporary" >/dev/null 2>&1 \
      || ! /usr/bin/plutil -insert status -string "$status" "$temporary" >/dev/null 2>&1 \
      || ! /usr/bin/plutil -insert message -string "$message" "$temporary" >/dev/null 2>&1 \
      || ! /usr/bin/plutil -insert operationToken -string "$operation_token" "$temporary" >/dev/null 2>&1 \
      || ! /usr/bin/plutil -insert updatedAt -integer "$updated_at" "$temporary" >/dev/null 2>&1; then
      /bin/rm -f "$temporary"; result=1
    else
      /bin/chmod 600 "$temporary"; /bin/mv -f "$temporary" "$OPERATION_STATE_PATH" || result=1
    fi
  fi
  /bin/rm -rf "$lock_path"; return "$result"
}
clear_operation_state() { /bin/rm -f "$OPERATION_STATE_PATH"; }

seed_bundled_presets() {
  local presets_root="$PROJECT_ROOT/presets"; [ -d "$presets_root" ] || return 0
  local themes_root="$STATE_ROOT/themes"; /bin/mkdir -p "$themes_root"
  local src id dest entry
  for src in "$presets_root"/preset-*/; do
    [ -d "$src" ] || continue; [ -f "${src}theme.json" ] || continue
    id="$(/usr/bin/basename "$src")"; dest="$themes_root/$id"
    /bin/rm -rf "$dest"; /bin/mkdir -p "$dest"; /bin/chmod 700 "$dest"
    for entry in "$src"*; do [ -f "$entry" ] || continue; /bin/cp "$entry" "$dest/"; done
    /bin/chmod 600 "$dest"/* 2>/dev/null || true
  done
}

discover_workbuddy_app() {
  local candidate="" identifier="" exe_name="" configured="${WORKBUDDY_APP_BUNDLE:-}"
  WORKBUDDY_BUNDLE=""
  for candidate in "$configured" "/Applications/WorkBuddy.app" "$HOME/Applications/WorkBuddy.app"; do
    [ -n "$candidate" ] || continue; [ -f "$candidate/Contents/Info.plist" ] || continue
    identifier="$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$candidate/Contents/Info.plist" 2>/dev/null || true)"
    if [ "$identifier" = "$EXPECTED_BUNDLE_ID" ]; then WORKBUDDY_BUNDLE="$candidate"; break; fi
  done
  if [ -z "${WORKBUDDY_BUNDLE:-}" ]; then
    candidate="$(/usr/bin/mdfind "kMDItemCFBundleIdentifier == \"$EXPECTED_BUNDLE_ID\"" | /usr/bin/head -n 1)"
    [ -n "$candidate" ] && [ -f "$candidate/Contents/Info.plist" ] && WORKBUDDY_BUNDLE="$candidate"
  fi
  [ -n "${WORKBUDDY_BUNDLE:-}" ] || fail "Could not find WorkBuddy (com.workbuddy.workbuddy)."
  exe_name="$(/usr/bin/plutil -extract CFBundleExecutable raw -o - "$WORKBUDDY_BUNDLE/Contents/Info.plist")"
  WORKBUDDY_EXE="$WORKBUDDY_BUNDLE/Contents/MacOS/$exe_name"
  WORKBUDDY_VERSION="$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$WORKBUDDY_BUNDLE/Contents/Info.plist")"
  [ -x "$WORKBUDDY_EXE" ] || fail "WorkBuddy executable missing: $WORKBUDDY_EXE"
  export WORKBUDDY_BUNDLE WORKBUDDY_EXE WORKBUDDY_VERSION
}

codesign_team_id() { /usr/bin/codesign -dv --verbose=4 "$1" 2>&1 | /usr/bin/awk -F= '/^TeamIdentifier=/{print $2; exit}'; }

resolve_node_runtime() {
  # Prefer WorkBuddy's bundled Node, then managed, then system.
  local candidates=()
  candidates+=("$WORKBUDDY_BUNDLE/Contents/Resources/cli/vendor/node/"*"/bin/node")
  candidates+=("/Users/songshunsteel/.workbuddy/binaries/node/versions/22.22.2/bin/node")
  candidates+=("/usr/local/bin/node" "/usr/bin/node")
  local c path ver major
  for c in "${candidates[@]}"; do
    for path in $c; do
      [ -x "$path" ] || continue
      ver="$("$path" --version 2>/dev/null || true)"; [ -n "$ver" ] || continue
      major="${ver#v}"; major="${major%%.*}"; case "$major" in ''|*[!0-9]*) continue ;; esac
      [ "$major" -ge 20 ] || continue
      NODE="$path"; NODE_VERSION="$ver"; export NODE NODE_VERSION; return 0
    done
  done
  fail "No Node.js >= 20 found for the injector."
}

require_macos_runtime() {
  discover_workbuddy_app
  resolve_node_runtime
  /usr/bin/codesign --verify --strict "$WORKBUDDY_BUNDLE" >/dev/null 2>&1 \
    || printf 'WorkBuddy Dream Skin: warning — app signature could not be verified; proceeding.\n' >&2
}

workbuddy_main_pids() {
  local pid cl
  while read -r pid cl; do
    [ -n "$pid" ] || continue
    case "$cl" in "$WORKBUDDY_EXE"*) printf '%s\n' "$pid" ;; esac
  done < <(/bin/ps -axo pid=,command=)
}
workbuddy_is_running() { [ -n "$(workbuddy_main_pids)" ]; }

process_started_at() { /bin/ps -p "$1" -o lstart= 2>/dev/null | /usr/bin/awk '{$1=$1; print}'; }

stop_workbuddy() {
  local allow_force="${1:-false}" deadline pid
  release_launchd_job
  workbuddy_is_running || return 0
  /usr/bin/osascript -e 'tell application id "com.workbuddy.workbuddy" to quit' >/dev/null 2>&1 || true
  deadline=$((SECONDS+15))
  while workbuddy_is_running && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.25; done
  workbuddy_is_running || return 0
  [ "$allow_force" = "true" ] || fail "WorkBuddy did not close within 15s; re-run or force-quit."
  while IFS= read -r pid; do [ -n "$pid" ] && /bin/kill -TERM "$pid" 2>/dev/null || true; done < <(workbuddy_main_pids)
  deadline=$((SECONDS+5)); while workbuddy_is_running && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.25; done
  if workbuddy_is_running; then while IFS= read -r pid; do [ -n "$pid" ] && /bin/kill -KILL "$pid" 2>/dev/null || true; done < <(workbuddy_main_pids); fi
  /bin/sleep 0.5; workbuddy_is_running && fail "WorkBuddy could not be stopped safely."; return 0
}

listener_pids() { /usr/sbin/lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | /usr/bin/sort -u || true; }
port_is_available() { [ -z "$(listener_pids "$1")" ]; }
process_executable_path() { /usr/sbin/lsof -a -p "$1" -d txt -Fn 2>/dev/null | /usr/bin/awk '/^n/{sub(/^n/,""); print; exit}'; }
canonical_existing_path() { local input="$1" d b; [ -e "$input" ] || return 1; d="$(cd "$(dirname "$input")" 2>/dev/null && pwd -P)" || return 1; b="$(basename "$input")"; printf '%s/%s\n' "$d" "$b"; }
pid_is_workbuddy_executable() {
  local actual="$(process_executable_path "$1")" ac="$(canonical_existing_path "$actual" 2>/dev/null || true)" ec="$(canonical_existing_path "$WORKBUDDY_EXE" 2>/dev/null || true)"
  [ -n "$ac" ] && [ "$ac" = "$ec" ]
}
pid_is_workbuddy_descendant() {
  local current="$1" cl parent depth=0
  while [ "$current" -gt 1 ] 2>/dev/null && [ "$depth" -lt 32 ]; do
    cl="$(/bin/ps -p "$current" -o command= 2>/dev/null || true)"
    case "$cl" in "$WORKBUDDY_EXE"*) pid_is_workbuddy_executable "$current" && return 0 ;; esac
    parent="$(/bin/ps -p "$current" -o ppid= 2>/dev/null | /usr/bin/awk '{$1=$1; print}')"
    case "$parent" in ''|*[!0-9]*) return 1 ;; esac
    [ "$parent" -ne "$current" ] || return 1; current="$parent"; depth=$((depth+1))
  done; return 1
}
port_belongs_to_workbuddy() {
  local port="$1" found="false" pid
  while IFS= read -r pid; do [ -n "$pid" ] || continue; found="true"; pid_is_workbuddy_descendant "$pid" || return 1; done < <(listener_pids "$port")
  [ "$found" = "true" ]
}
cdp_http_ready() { /usr/bin/curl --noproxy '*' --silent --fail --max-time 1 "http://127.0.0.1:${1}/json/version" >/dev/null 2>&1; }
verified_cdp_endpoint() { local port="$1"; port_belongs_to_workbuddy "$port" || return 1; cdp_http_ready "$port"; }
select_available_port() {
  local preferred="$1" candidate="$preferred" last=$((preferred+100)); [ "$last" -le 65535 ] || last=65535
  while [ "$candidate" -le "$last" ]; do port_is_available "$candidate" && { printf '%s\n' "$candidate"; return 0; }; candidate=$((candidate+1)); done
  fail "No free loopback port between $preferred and $last."
}
wait_for_cdp() {
  local port="$1" deadline=$((SECONDS+45)) last_note=0
  while [ "$SECONDS" -lt "$deadline" ]; do verified_cdp_endpoint "$port" && return 0
    if [ $((SECONDS-last_note)) -ge 8 ]; then last_note=$SECONDS; printf 'Waiting for WorkBuddy debug port %s…\n' "$port" >&2; fi
    /bin/sleep 0.35
  done; return 1
}
state_field() {
  ensure_node_runtime
  "$NODE" -e 'const fs=require("node:fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))[process.argv[2]];if(v!==undefined&&v!==null)process.stdout.write(String(v));' "$STATE_PATH" "$1"
}
ensure_node_runtime() {
  if [ "$DREAM_SKIN_VALIDATED_RUNTIME_PID" = "$$" ] && [ -n "$DREAM_SKIN_VALIDATED_RUNTIME_NODE" ] && [ "${NODE:-}" = "$DREAM_SKIN_VALIDATED_RUNTIME_NODE" ] && [ "${WORKBUDDY_BUNDLE:-}" = "$DREAM_SKIN_VALIDATED_RUNTIME_BUNDLE" ] && [ "${WORKBUDDY_EXE:-}" = "$DREAM_SKIN_VALIDATED_RUNTIME_EXE" ]; then return 0; fi
  discover_workbuddy_app; resolve_node_runtime
  DREAM_SKIN_VALIDATED_RUNTIME_PID="$$"; DREAM_SKIN_VALIDATED_RUNTIME_BUNDLE="$WORKBUDDY_BUNDLE"; DREAM_SKIN_VALIDATED_RUNTIME_EXE="$WORKBUDDY_EXE"; DREAM_SKIN_VALIDATED_RUNTIME_NODE="$NODE"
}
write_state() {
  local port="$1" inj_pid="$2" inj_start="$3" wb_pid="$4" session="${5:-applying}" nv="${NODE_VERSION:-unknown}" bundle="${WORKBUDDY_BUNDLE:-}" exe="${WORKBUDDY_EXE:-}" av="${WORKBUDDY_VERSION:-}" team=""
  team="$(codesign_team_id "$WORKBUDDY_BUNDLE" 2>/dev/null || true)"
  "$NODE" -e '
    const fs=require("node:fs");
    const [file,version,port,pid,startedAt,injector,node,nodeVersion,bundle,exe,appVersion,teamId,root,themeDir,wbPid,arch,session]=process.argv.slice(1);
    const state={schemaVersion:4,platform:`darwin-${arch}`,skinVersion:version,protocol:3,port:Number(port),injectorPid:Number(pid),injectorStartedAt:startedAt,injectorPath:injector,nodePath:node,nodeVersion,workbuddyBundle:bundle,workbuddyExe:exe,workbuddyVersion:appVersion,workbuddyTeamId:teamId,workbuddyPid:Number(wbPid||0),projectRoot:root,themeDir,session,injectorMode:"full",createdAt:new Date().toISOString()};
    if(session==="active"){try{const t=JSON.parse(fs.readFileSync(`${themeDir}/theme.json`,"utf8"));state.appliedThemeId=String(t.id||"");state.appliedThemeName=String(t.name||t.id||"");state.verifiedAt=new Date().toISOString();}catch{}}
    const tmp=`${file}.${process.pid}.tmp`;fs.writeFileSync(tmp,`${JSON.stringify(state,null,2)}\n`,{mode:0o600});fs.renameSync(tmp,file);
  ' "$STATE_PATH" "$SKIN_VERSION" "$port" "$inj_pid" "$inj_start" "$INJECTOR" "$NODE" "$nv" "$bundle" "$exe" "$av" "$team" "$PROJECT_ROOT" "$THEME_DIR" "$wb_pid" "$(/usr/bin/uname -m)" "$session"
}
mark_state_active() {
  [ -f "$STATE_PATH" ] || return 1
  "$NODE" -e 'const fs=require("node:fs");const[file,themeDir]=process.argv.slice(1);const s=JSON.parse(fs.readFileSync(file,"utf8"));const t=JSON.parse(fs.readFileSync(`${themeDir}/theme.json`,"utf8"));s.session="active";s.appliedThemeId=String(t.id||"");s.appliedThemeName=String(t.name||t.id||"");s.injectorMode="full";delete s.pausedAt;s.verifiedAt=new Date().toISOString();s.updatedAt=s.verifiedAt;const tmp=`${file}.${process.pid}.tmp`;fs.writeFileSync(tmp,`${JSON.stringify(s,null,2)}\n`,{mode:0o600});fs.renameSync(tmp,file);' "$STATE_PATH" "$THEME_DIR"
}
mark_state_stale() { [ -f "$STATE_PATH" ] || return 0; "$NODE" -e 'const fs=require("node:fs");const f=process.argv[1];const s=JSON.parse(fs.readFileSync(f,"utf8"));s.session="stale";s.updatedAt=new Date().toISOString();const tmp=`${f}.${process.pid}.tmp`;fs.writeFileSync(tmp,`${JSON.stringify(s,null,2)}\n`,{mode:0o600});fs.renameSync(tmp,f);' "$STATE_PATH"; }
stop_recorded_injector() {
  [ -f "$STATE_PATH" ] || return 0
  local pid saved_port saved_start saved_node saved_injector
  pid="$(state_field injectorPid 2>/dev/null || true)"; [ -n "${pid:-}" ] || { /bin/launchctl remove "$INJECTOR_JOB_LABEL" >/dev/null 2>&1 || true; return 0; }
  [ "$pid" = "0" ] && { /bin/launchctl remove "$INJECTOR_JOB_LABEL" >/dev/null 2>&1 || true; return 0; }
  case "$pid" in *[!0-9]*|??????????*) return 1 ;; esac
  saved_port="$(state_field port 2>/dev/null || true)"; saved_start="$(state_field injectorStartedAt 2>/dev/null || true)"; saved_node="$(state_field nodePath 2>/dev/null || true)"; saved_injector="$(state_field injectorPath 2>/dev/null || true)"
  case "$saved_port" in ''|*[!0-9]*) return 1 ;; esac
  [ "$saved_port" -ge 1024 ] && [ "$saved_port" -le 65535 ] || return 1
  [ -n "$saved_start" ] && [ -n "$saved_node" ] && [ -n "$saved_injector" ] || return 1
  /bin/kill -0 "$pid" 2>/dev/null || { /bin/launchctl remove "$INJECTOR_JOB_LABEL" >/dev/null 2>&1 || true; return 0; }
  /bin/launchctl remove "$INJECTOR_JOB_LABEL" >/dev/null 2>&1 || true
  /bin/kill -TERM "$pid" 2>/dev/null || true
  local deadline=$((SECONDS+6)); while /bin/kill -0 "$pid" 2>/dev/null && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.2; done
  /bin/kill -0 "$pid" 2>/dev/null && /bin/kill -KILL "$pid" 2>/dev/null || true
  return 0
}
launch_injector_daemon() {
  local port="$1" pid="" deadline=$((SECONDS+10))
  : > "$INJECTOR_LOG"; : > "$INJECTOR_ERROR_LOG"
  /bin/launchctl remove "$INJECTOR_JOB_LABEL" >/dev/null 2>&1 || true
  if /bin/launchctl submit -l "$INJECTOR_JOB_LABEL" -o "$INJECTOR_LOG" -e "$INJECTOR_ERROR_LOG" -- "$NODE" "$INJECTOR" --watch --port "$port" --theme-dir "$THEME_DIR" >/dev/null 2>&1; then
    while [ "$SECONDS" -lt "$deadline" ]; do
      pid="$(/bin/launchctl print "gui/$(/usr/bin/id -u)/$INJECTOR_JOB_LABEL" 2>/dev/null | /usr/bin/awk '/^[[:space:]]*pid = [0-9]+/{print $3; exit}')"
      [ -n "$pid" ] && /bin/kill -0 "$pid" 2>/dev/null && { printf '%s\n' "$pid"; return 0; }
      /bin/sleep 0.2
    done
    /bin/launchctl remove "$INJECTOR_JOB_LABEL" >/dev/null 2>&1 || true
  fi
  /usr/bin/nohup "$NODE" "$INJECTOR" --watch --port "$port" --theme-dir "$THEME_DIR" >>"$INJECTOR_LOG" 2>>"$INJECTOR_ERROR_LOG" &
  pid="$!"; /bin/sleep 0.15; [ -n "$pid" ] && /bin/kill -0 "$pid" 2>/dev/null && { printf '%s\n' "$pid"; return 0; }
  fail "The injector did not start."
}
release_launchd_job() { /bin/launchctl remove "gui/$(/usr/bin/id -u)/$APP_JOB_LABEL" >/dev/null 2>&1 || true; /bin/launchctl remove "$APP_JOB_LABEL" >/dev/null 2>&1 || true; }
launch_workbuddy_with_cdp() {
  local port="$1"; : > "$APP_LOG"; : > "$APP_ERROR_LOG"; release_launchd_job
  /usr/bin/open -na "$WORKBUDDY_BUNDLE" --args --remote-debugging-address=127.0.0.1 --remote-debugging-port="$port" >>"$APP_LOG" 2>>"$APP_ERROR_LOG" || true
  if ! workbuddy_is_running; then /usr/bin/nohup "$WORKBUDDY_EXE" --remote-debugging-address=127.0.0.1 --remote-debugging-port="$port" >>"$APP_LOG" 2>>"$APP_ERROR_LOG" & fi
}
launch_workbuddy_normally() { release_launchd_job; /usr/bin/open -na "$WORKBUDDY_BUNDLE"; }
