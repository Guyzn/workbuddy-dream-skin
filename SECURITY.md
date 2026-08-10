# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | ✅ |

## Reporting a vulnerability

**Do not open a public GitHub issue for security problems.**

Email the maintainer at `sales10@songshunsteel.com` with:

- A description of the issue
- Steps to reproduce (or a minimal PoC)
- Impact assessment if known

You should receive a response within **48 hours**. If the issue is confirmed,
a fix will be released as soon as possible and you will be credited (unless you
prefer to stay anonymous).

## Security-relevant design notes

- **CDP loopback only**: WorkBuddy is relaunched with
  `--remote-debugging-address=127.0.0.1`, so the debugger is never exposed to
  the network. Do not run untrusted local software while a skin is active —
  Chromium CDP on loopback has no same-user authentication.
- **No official files touched**: the tool never edits `WorkBuddy.app`,
  `app.asar`, or the Windows install directory.
- **Path escape guard**: `theme.json` art paths are resolved with `realpath`
  and must stay inside the theme directory.
- **No secrets**: the repo is public and designed to contain zero secrets.
