# WorkBuddy Dream Skin

An unofficial external theme studio for the **WorkBuddy** desktop app.
Local loopback CDP injection — it does **not** modify the official `.app` /
`app.asar` or its code signature, and never touches your API keys or model config.

## Features
- Real, interactive theming: native sidebar / chat / input controls stay live.
- Full-window continuous background with route-aware scrims.
- Image-derived adaptive palette (rewrites `--vscode-*` accents) + frosted panels.
- Multi-preset library, import your own pure background, save/switch themes.
- Menu bar (macOS / SwiftBar) and system tray (Windows).
- In-renderer operation overlay (loading / success / error).
- One-click restore to the stock UI.

## Quick start (macOS)
```bash
cd macos
./scripts/install-dream-skin-macos.sh --no-launch
./scripts/start-dream-skin-macos.sh --prompt-restart
```
## Quick start (Windows)
```powershell
cd windows\scripts
powershell -ExecutionPolicy Bypass -File .\install-dream-skin.ps1
powershell -ExecutionPolicy Bypass -File .\start-dream-skin.ps1
powershell -ExecutionPolicy Bypass -File .\tray-dream-skin.ps1
```

See `README.md` (Chinese) for full details, knobs, and troubleshooting.
License: MIT (see `LICENSE`). Trademark & asset rights: see `NOTICE.md`.
