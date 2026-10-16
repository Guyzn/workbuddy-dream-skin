# WorkBuddy Dream Skin

An unofficial theme studio for the **WorkBuddy** desktop app. It has two modes.
The classic one skins the live UI through the local Chromium DevTools Protocol
(CDP) on the loopback address; the newer official-pipeline mode (wb-skin) hands
a compiled skin to the app's own theme cache instead. Both leave the official
`.app`, `app.asar`, code signature, API keys and model config exactly as they
were.

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
- An official-pipeline mode (wb-skin) that renders your wallpaper through
  WorkBuddy's own theme engine, no CDP involved.
- Menu bar (macOS via SwiftBar) and system tray (Windows).
- In-renderer overlay for apply / pause / switch status.
- One-click restore to the stock UI.

## Official pipeline mode (wb-skin)

Recent WorkBuddy builds ship an official theme center (Settings → Appearance).
Downloaded themes are cached on disk, and on every switch the app reads that
local cache first. `wb-skin` rides this path: it compiles a wallpaper and its
palette into an official-format skin and places it inside the cache of one
official theme you already downloaded (your "carrier"). No CDP port, no daemon,
and the official theme list keeps working.

```bash
cd macos/scripts
node wb-skin.mjs list                            # official themes available as carriers
node wb-skin.mjs build --name "My Skin" --image ~/Pictures/wall.jpg
node wb-skin.mjs install <slug> --carrier <theme-key>
node wb-skin.mjs restore --carrier <theme-key>   # back to stock, byte-exact
node wb-skin.mjs resync                          # re-apply after a theme update
```

Artwork specs. Landscape, long edge 2560 or more (2560x1440 and 2560x1600 fit
best). JPG for photos, PNG for flat art and sharp edges, within 16MB. HEIC,
WebP and TIFF are converted to JPG automatically at build time. Keep UI
screenshots, text and watermarks out of the image, and leave some calm space
for the interface that sits on top. The full write-up is in the Chinese
`README.md`.

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

## Acknowledgements

This project did not appear out of thin air. While building it we studied
[workbuddy-skin-studio](https://github.com/cdredfox/workbuddy-skin-studio), a
kindred project by cdredfox. A few ideas came straight from it

- the in-app theme menu (instant switching, custom image import, local saving)
- CDP client hardening (loopback whitelist, connect timeouts, typed errors)
- locating WorkBuddy through the Windows Uninstall registry
- schema validation for theme.json plus path-escape protection

We kept our own machinery (MutationObserver keep-alive, canvas-derived adaptive
palette, layered scrims and blur, the state-machine daemon) and grew a fuller
skin experience on top. That is how open source works, you study someone
else's road and then keep walking your own.
