# Contributing to WorkBuddy Dream Skin

Thanks for your interest! This project themes the WorkBuddy desktop app through
local loopback CDP injection. Please read this before contributing.

## Ground rules

- **Never modify** `WorkBuddy.app`, `app.asar`, or the Windows install
  directory — this project only injects into the live renderer.
- **No secrets in public repos.** No real PATs, tokens, keys, or customer data.
  The repo is public and zero-secret by design.
- Keep the injector **zero third-party dependency** (`injector.mjs` uses Node
  stdlib only). `gen_presets.py` may use Pillow (declared in `requirements.txt`).
- Platform parity: `macos/` and `windows/` must stay in sync. When you touch
  `macos/scripts/injector.mjs`, `macos/assets/dream-skin.css`, or
  `macos/assets/renderer-inject.js`, copy the change to the `windows/` mirror.

## Getting started

```bash
git clone https://github.com/Guyzn/workbuddy-dream-skin.git
cd workbuddy-dream-skin
# macOS: install + start (see README)
cd macos && ./scripts/install-dream-skin-macos.sh --no-launch
./scripts/start-dream-skin-macos.sh --prompt-restart
```

Requires Node.js >= 20 (the launcher auto-discovers it) and, for presets
regeneration, Python 3.11+ with Pillow.

## What kind of contributions are welcome

- Bug reports with the output of `./scripts/doctor-macos.sh`
- New theme presets (programmatic backgrounds only — no copyrighted assets)
- Improvements to the injector (error handling, keep-alive, palette math)
- Documentation fixes

## Definition of done

- `node --check` passes on both `macos/scripts/injector.mjs` and
  `windows/scripts/injector.mjs`
- `bash -n` passes on every `.sh`; `python -m py_compile` on `.py`
- Windows mirror files are in sync with macOS
- No new secrets; commit message is Conventional Commits
  (`feat:` / `fix:` / `docs:` / `build:` / `chore:`)

## Communication

Open an issue for questions. For security issues, do **not** open a public
issue — see `SECURITY.md`.
