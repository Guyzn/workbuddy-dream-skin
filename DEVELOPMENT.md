# Development

How to run this project on your local machine.

## Requirements

- **WorkBuddy desktop** installed (macOS or Windows; Linux unsupported)
- **Node.js >= 20** (launcher auto-discovers: WorkBuddy bundled Node → managed
  binaries → system node)
- macOS menu bar extras need [SwiftBar](https://swiftbar.app)
- Regenerating presets needs **Python 3.11+** with `Pillow`
  (`pip install -r requirements.txt`)

## Run (macOS)

```bash
cd macos
./scripts/install-dream-skin-macos.sh --no-launch   # install + seed presets
./scripts/start-dream-skin-macos.sh --prompt-restart # apply (restarts WorkBuddy once)
./scripts/switch-theme-macos.sh --id preset-aurora-dusk
./scripts/doctor-macos.sh                            # diagnostics
./scripts/restore-dream-skin-macos.sh                # back to native
```

## Run (Windows)

```powershell
cd windows\scripts
powershell -ExecutionPolicy Bypass -File .\install-dream-skin.ps1
powershell -ExecutionPolicy Bypass -File .\start-dream-skin.ps1
powershell -ExecutionPolicy Bypass -File .\tray-dream-skin.ps1
```

## Layout

- `macos/scripts/injector.mjs` — CLI orchestrator (apply / verify / restore / inspect / watch / check-payload)
- `macos/scripts/cdp-client.mjs` — CDP transport (loopback validation, timeouts, typed errors, request queue)
- `macos/scripts/theme-schema.mjs` — runtime theme.json schema validation
- `schemas/theme.schema.json` — the theme schema (for editors / CI linters)
- `macos/assets/dream-skin.css` — injected stylesheet
- `macos/assets/renderer-inject.js` — in-renderer engine (palette, keep-alive)
- `macos/presets/` — bundled presets (`theme.json` + `background.jpg`)
- `macos/scripts/gen_presets.py` — programmatic preset background generator
- `scripts/check-theme-schemas.mjs` — validates every bundled theme against the schema
- `windows/` — PowerShell mirror of the macOS scripts

## Testing

No test framework yet; run the built-in checks (or `npm run check`):

```bash
npm run check:syntax    # node --check + bash -n + py_compile
npm run check:mirror    # macOS/Windows mirrors identical
npm run check:schema    # all bundled theme.json valid
npm run check:payload   # injector --check-payload on every preset
```

CI runs these on every push (see `.github/workflows/ci.yml`).

## Keep macOS / Windows mirrors in sync

When you edit `injector.mjs`, `dream-skin.css`, or `renderer-inject.js` under
`macos/`, copy the file to the matching path under `windows/`:
`cp macos/scripts/injector.mjs windows/scripts/injector.mjs`.
