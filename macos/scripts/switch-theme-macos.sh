#!/bin/bash
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"
ID=""; FILE=""; NO_APPLY="false"; PORT="${PORT:-9341}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --id) ID="${2:-}"; shift 2 ;;
    --file) FILE="${2:-}"; shift 2 ;;
    --no-apply) NO_APPLY="true"; shift ;;
    --port) PORT="${2:-}"; shift 2 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done
discover_workbuddy_app; require_macos_runtime; ensure_state_root

SRC=""
if [ -n "$ID" ]; then
  SRC="$STATE_ROOT/themes/$ID"
  [ -d "$SRC" ] && [ -f "$SRC/theme.json" ] || fail "Preset not found: $ID"
elif [ -n "$FILE" ]; then
  SRC="$(cd "$(dirname "$FILE")" && pwd -P)"
  [ -f "$SRC/theme.json" ] || fail "theme.json not found next to: $FILE"
else
  fail "Pass --id <preset-id> or --file <path/to/theme.json>"
fi

# Backup the previously active theme so it can be restored.
[ -f "$THEME_DIR/theme.json" ] && /bin/cp "$THEME_DIR/theme.json" "$THEME_BACKUP_PATH" 2>/dev/null || true

/bin/mkdir -p "$THEME_DIR"
/bin/cp "$SRC/theme.json" "$THEME_DIR/theme.json"
# Copy any background asset that travels with the preset.
for ext in jpg jpeg png webp; do
  if [ -f "$SRC/background.$ext" ]; then /bin/cp "$SRC/background.$ext" "$THEME_DIR/background.$ext" 2>/dev/null || true; fi
done

NAME="$(/usr/bin/basename "$SRC")"
printf 'Switched active theme to: %s\n' "$NAME"

if [ "$NO_APPLY" = "true" ]; then
  printf 'Skin set; it will apply on next start (or run the Start launcher).\n'; exit 0
fi

if verified_cdp_endpoint "$PORT" 2>/dev/null; then
  if "$NODE" "$INJECTOR" --once --port "$PORT" --theme-dir "$THEME_DIR" --timeout-ms 20000 >/dev/null 2>&1; then
    printf 'Theme applied live.\n'; exit 0
  fi
fi
printf 'WorkBuddy CDP not open yet — theme set and will apply on next start.\n'
