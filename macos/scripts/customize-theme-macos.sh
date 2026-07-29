#!/bin/bash
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"
IMAGE=""; NAME=""; ACCENT=""; SECONDARY=""; HIGHLIGHT=""; APPEARANCE=""; BLUR=""; SCRIM=""; RESET="false"; PORT="${PORT:-9341}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --image) IMAGE="${2:-}"; shift 2 ;;
    --name) NAME="${2:-}"; shift 2 ;;
    --accent) ACCENT="${2:-}"; shift 2 ;;
    --secondary) SECONDARY="${2:-}"; shift 2 ;;
    --highlight) HIGHLIGHT="${2:-}"; shift 2 ;;
    --appearance) APPEARANCE="${2:-}"; shift 2 ;;
    --blur) BLUR="${2:-}"; shift 2 ;;
    --scrim) SCRIM="${2:-}"; shift 2 ;;
    --reset-demo) RESET="true"; shift ;;
    --port) PORT="${2:-}"; shift 2 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done
discover_workbuddy_app; require_macos_runtime; ensure_state_root
/bin/mkdir -p "$THEME_DIR"

if [ "$RESET" = "true" ]; then
  first="$(/bin/ls -1 "$STATE_ROOT/themes" 2>/dev/null | /usr/bin/grep -m1 '^preset-' || true)"
  [ -n "$first" ] || fail "No bundled preset to reset to."
  /bin/cp "$STATE_ROOT/themes/$first/theme.json" "$THEME_DIR/theme.json"
  for ext in jpg jpeg png webp; do [ -f "$STATE_ROOT/themes/$first/background.$ext" ] && /bin/cp "$STATE_ROOT/themes/$first/background.$ext" "$THEME_DIR/background.$ext"; done
  printf 'Reset to bundled demo theme: %s\n' "$first"
  verified_cdp_endpoint "$PORT" 2>/dev/null && "$NODE" "$INJECTOR" --once --port "$PORT" --theme-dir "$THEME_DIR" --timeout-ms 20000 >/dev/null 2>&1 && printf 'Applied live.\n'
  exit 0
fi

[ -n "$IMAGE" ] || fail "Pass --image /path/to/your-background.jpg (pure background, no UI)."
[ -f "$IMAGE" ] || fail "Image not found: $IMAGE"
EXT="$(printf '%s' "$IMAGE" | /usr/bin/awk -F. '{print tolower($NF)}')"
case "$EXT" in jpg|jpeg|png|webp) ;; *) fail "Supported: jpg/jpeg/png/webp" ;; esac

# Validate size/limits.
SIZE_OK="$("$NODE" -e 'const fs=require("node:fs");const s=fs.statSync(process.argv[1]);process.exit(s.size<=16*1024*1024?0:1);' "$IMAGE" 2>/dev/null && echo yes || echo no)"
[ "$SIZE_OK" = "yes" ] || fail "Image exceeds 16MB limit."

DEST="$THEME_DIR/custom-background.$EXT"
/bin/cp "$IMAGE" "$DEST"

# Build a custom theme.json (id custom-<timestamp>).
STAMP="$(/bin/date +%Y%m%d%H%M%S)"
THEME_JSON="$("$NODE" -e '
  const fs=require("node:fs");
  let base={};
  const backup=process.argv[1];
  if(fs.existsSync(backup)){ try{base=JSON.parse(fs.readFileSync(backup,"utf8"));}catch{} }
  const t=Object.assign({}, base, {
    id:"custom-"+(process.argv[2]),
    name: process.argv[3]||base.name||"Custom Skin",
    art:{ file:"custom-background.'"$EXT"'", focusX: base.art&&base.art.focusX, focusY: base.art&&base.art.focusY, safeArea:"auto", taskMode:"auto" },
    appearance: process.argv[4]||base.appearance||"auto",
    colors: Object.assign({}, base.colors||{}),
    surfaceAlpha: base.surfaceAlpha, blur: base.blur, scrim: base.scrim, homeScrim: base.homeScrim
  });
  const acc=process.argv[5], sec=process.argv[6], hi=process.argv[7], blur=process.argv[8], scrim=process.argv[9];
  if(acc){ t.colors.accent=acc; t.explicitColorKeys=["accent"]; }
  if(sec) t.colors.secondary=sec;
  if(hi) t.colors.highlight=hi;
  if(blur) t.blur=Number(blur);
  if(scrim) t.scrim=Number(scrim);
  fs.writeFileSync(process.argv[10], JSON.stringify(t,null,2)+"\n");
' "$THEME_BACKUP_PATH" "$STAMP" "$NAME" "$APPEARANCE" "$ACCENT" "$SECONDARY" "$HIGHLIGHT" "$BLUR" "$SCRIM" "$THEME_DIR/theme.json")"
printf 'Custom theme written: %s\n' "$THEME_DIR/theme.json"

if verified_cdp_endpoint "$PORT" 2>/dev/null; then
  "$NODE" "$INJECTOR" --once --port "$PORT" --theme-dir "$THEME_DIR" --timeout-ms 20000 >/dev/null 2>&1 && printf 'Applied live.\n' || printf 'Set; will apply on next start.\n'
else
  printf 'CDP not open — theme set; it will apply on next start.\n'
fi
