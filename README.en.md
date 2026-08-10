# WorkBuddy Dream Skin

An unofficial theme studio for the **WorkBuddy** desktop app. It skins the live
UI through the local Chromium DevTools Protocol (CDP) on the loopback address,
so the official `.app`, `app.asar`, code signature, API keys and model config
stay exactly as they were.

## Install with AI (recommended)

Send this repository's GitHub URL to any AI assistant (WorkBuddy, CodeBuddy,
Claude, Cursor, etc.) with one line:

> Use this open-source project to change my WorkBuddy theme

The AI clones the repo, reads [`SKILL.md`](SKILL.md), and walks through platform
detection, install, skin start and verification on its own. You only save your
current WorkBuddy task when the dialog asks. After that, daily switching lives in
the menu bar, system tray or CLI.

## Features

- Real, interactive theming: the native sidebar, chat and input stay live.
- One continuous wallpaper across the whole window, with route-aware scrims
  that ease off once you are inside a task.
- Image-derived adaptive palette (rewrites `--vscode-*` accents) plus frosted
  panels.
- A small preset library, your own background import, save and switch.
- Menu bar (macOS via SwiftBar) and system tray (Windows).
- In-renderer overlay for apply / pause / switch status.
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

Full details, knobs and troubleshooting are in `README.md` (Chinese).
License: MIT (see `LICENSE`). Trademark and asset rights: see `NOTICE.md`.
