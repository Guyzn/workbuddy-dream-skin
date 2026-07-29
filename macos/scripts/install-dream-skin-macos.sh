#!/bin/bash
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

PORT=9341; CREATE_LAUNCHERS="true"; LAUNCH_AFTER_INSTALL="true"; IN_PLACE="false"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --port) PORT="${2:-}"; shift 2 ;;
    --no-launchers) CREATE_LAUNCHERS="false"; shift ;;
    --no-launch) LAUNCH_AFTER_INSTALL="false"; shift ;;
    --in-place) IN_PLACE="true"; shift ;;
    *) fail "Unknown installer argument: $1" ;;
  esac
done
case "$PORT" in ''|*[!0-9]*) fail "Invalid port: $PORT" ;; esac
[ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || fail "Port must be 1024–65535."

deploy_project() {
  local tmp="$INSTALL_ROOT.installing.$$" prev="$INSTALL_ROOT.previous.$$"
  /bin/rm -rf "$tmp"; /bin/mkdir -p "$tmp"
  /usr/bin/rsync -a --exclude '.git/' --exclude '.DS_Store' --exclude 'release/' "$PROJECT_ROOT/" "$tmp/"
  /bin/chmod 700 "$tmp"/*.command "$tmp"/scripts/*.sh 2>/dev/null || true
  [ -e "$INSTALL_ROOT" ] && /bin/mv "$INSTALL_ROOT" "$prev"
  if ! /bin/mv "$tmp" "$INSTALL_ROOT"; then [ -e "$prev" ] && /bin/mv "$prev" "$INSTALL_ROOT"; fail "Install failed at $INSTALL_ROOT"; fi
  /bin/rm -rf "$prev"
}

if [ "$IN_PLACE" = "false" ] && [ "$PROJECT_ROOT" != "$INSTALL_ROOT" ]; then
  /bin/mkdir -p "$(dirname "$INSTALL_ROOT")"; deploy_project
  install_args=(--in-place --port "$PORT")
  [ "$CREATE_LAUNCHERS" = "true" ] || install_args+=(--no-launchers)
  [ "$LAUNCH_AFTER_INSTALL" = "true" ] || install_args+=(--no-launch)
  exec "$INSTALL_ROOT/scripts/install-dream-skin-macos.sh" "${install_args[@]}"
fi

discover_workbuddy_app
require_macos_runtime
ensure_state_root
seed_bundled_presets
# Default active theme = first preset.
if [ ! -f "$THEME_DIR/theme.json" ]; then
  first="$(/bin/ls -1 "$STATE_ROOT/themes" 2>/dev/null | /usr/bin/grep -m1 '^preset-' || true)"
  [ -n "$first" ] && /bin/cp "$STATE_ROOT/themes/$first/theme.json" "$THEME_DIR/theme.json"
  [ -f "$STATE_ROOT/themes/$first/background.jpg" ] && /bin/cp "$STATE_ROOT/themes/$first/background.jpg" "$THEME_DIR/" 2>/dev/null || true
  [ -f "$STATE_ROOT/themes/$first/background.png" ] && /bin/cp "$STATE_ROOT/themes/$first/background.png" "$THEME_DIR/" 2>/dev/null || true
fi
[ -f "$THEME_DIR/theme.json" ] || fail "No theme.json after seeding presets."

shell_quote() { "$NODE" -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"; }
write_launcher() {
  local target="$1" command="$2"
  if [ -e "$target" ] && ! /usr/bin/grep -q '^# WorkBuddyDreamSkinStudio launcher$' "$target" 2>/dev/null; then fail "Refusing to overwrite unrelated Desktop file: $target"; fi
  /usr/bin/printf '%s\n' '#!/bin/bash' '# WorkBuddyDreamSkinStudio launcher' 'set -e' "$command" > "$target"; /bin/chmod 700 "$target"
}
if [ "$CREATE_LAUNCHERS" = "true" ]; then
  /bin/mkdir -p "$HOME/Desktop"
  start_s="$(shell_quote "$SCRIPT_DIR/start-dream-skin-macos.sh")"
  cust_s="$(shell_quote "$SCRIPT_DIR/customize-theme-macos.sh")"
  ver_s="$(shell_quote "$SCRIPT_DIR/verify-dream-skin-macos.sh")"
  rest_s="$(shell_quote "$SCRIPT_DIR/restore-dream-skin-macos.sh")"
  write_launcher "$HOME/Desktop/WorkBuddy Dream Skin.command" "exec $start_s --port $PORT --prompt-restart"
  write_launcher "$HOME/Desktop/WorkBuddy Dream Skin - Customize.command" "exec $cust_s"
  write_launcher "$HOME/Desktop/WorkBuddy Dream Skin - Verify.command" "exec $ver_s"
  write_launcher "$HOME/Desktop/WorkBuddy Dream Skin - Restore.command" "exec $rest_s --restart-workbuddy"
fi

printf 'WorkBuddy Dream Skin %s installed at %s (WorkBuddy %s, Node %s).\n' "$SKIN_VERSION" "$INSTALL_ROOT" "$WORKBUDDY_VERSION" "$NODE_VERSION"
printf 'Bundled presets ready in %s/themes — pick one from the menu bar or switch-theme.\n' "$STATE_ROOT"
[ "$LAUNCH_AFTER_INSTALL" = "true" ] && "$SCRIPT_DIR/start-dream-skin-macos.sh" --port "$PORT" --prompt-restart
