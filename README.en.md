# WorkBuddy Dream Skin

An unofficial external theme studio for the **WorkBuddy** desktop app.
Local loopback CDP injection — it does **not** modify the official `.app` /
`app.asar` or its code signature, and never touches your API keys or model config.

## Install with AI (recommended)

Send this repository's GitHub URL to any AI assistant (WorkBuddy / CodeBuddy /
Claude / Cursor, etc.) along with:

> Use this open-source project to change my WorkBuddy theme

The AI clones the repo, reads the [`SKILL.md`](SKILL.md), and automatically
completes **platform detection → install → start skin → verify**. You only need
to save your current WorkBuddy task in the dialog. Daily switching afterwards
happens in the menu bar / system tray / CLI.

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
