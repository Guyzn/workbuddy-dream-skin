# Changelog

All notable changes to WorkBuddy Dream Skin are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `SKILL.md` — AI one-click install workflow (platform detection, install,
  start, verify, restore).
- README "用 AI 一键安装（推荐）" section.
- Community health files: `CONTRIBUTING.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, `DEVELOPMENT.md`, `.gitattributes`,
  issue/PR templates, `CODEOWNERS`.
- GitHub Actions CI (`syntax-check` matrix: Node 20/22 + Python 3.11–3.13).
- `requirements.txt` declaring Pillow for `gen_presets.py`.

### Changed

- **Hybrid theming layer** (`renderer-inject.js` + `dream-skin.css`): the stable
  `--vscode-*` base is kept, with a WorkBuddy-specific `--cb-*` increment added
  (titlebar, dark buttons, scrollbars, strokes, team cards) mapped onto the
  dream-skin palette; `dream-skin.css` gains a `[data-view-id]` precision anchor
  layer (sidebar / main-content / detail-panel) that takes precedence, while the
  heuristic class matchers stay as a degradation fallback. Fixed stale
  `--ds-*-rgb` cleanup names (accent→green, etc.) so native restore is complete.
- **Windows discovery hardened** (`common-windows.ps1`): WorkBuddy.exe now
  resolves via explicit env override → known install paths → Windows Uninstall
  registry (HKCU/HKLM/WOW6432Node); Node.js resolves via PATH → WorkBuddy-bundled
  → managed `~/.workbuddy/binaries/node/versions` (newest first). CDP liveness
  check now requires a `renderer/index.html` page target instead of any HTTP
  response, so a random CDP process on the port no longer false-positives.
- New `find-workbuddy.ps1` diagnostic: prints resolved WorkBuddy.exe / Node /
  CDP status with actionable hints.
- **Hardened CDP client** (`injector.mjs`): loopback URL validation, port
  validation, connect/command timeouts, pending-request cleanup on terminate,
  typed errors (`CdpProtocolError` / `CdpEvaluationError`), defensive
  WebSocket-readyState checks. Backwards-compatible API.
- **Path-escape guard**: `theme.json` art files are now resolved with
  `realpath` and must remain inside the theme directory (absolute paths and
  `../` escapes are rejected).
- Launcher now discovers Node via `$HOME/.workbuddy/binaries/node/versions/*`
  instead of a machine-specific hardcoded path.

### Fixed

- Committed git author metadata no longer exposes a machine-specific identity.
- Plaintext PAT removed from the `origin` remote URL (credentials now read only
  from the local `~/.github_pat` during push).

## [1.0.0] - 2026-07-29

### Added

- Initial release: full-window background art, Canvas-derived adaptive palette,
  focus-point positioning, safe-area detection, per-route scrim, frosted-glass
  panels, `--watch` keep-alive daemon, macOS menu bar + Windows tray,
  `state.json` state machine, doctor/verify diagnostics.
