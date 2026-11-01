# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-01

First public, portable release.

### Added

- `dsh-keil doctor` (CLI) and the `doctor` action on the `keil` model tool:
  reports Node/OS, state and config paths, every UV4 location that was tried,
  and the exact fix when UV4 cannot be found.
- `dsh-keil set-uv4 --path <UV4.exe | UV4 folder | Keil root>` and
  `dsh-keil show-config` to record this machine's Keil installation in
  `~/.dsh/keil/config.json` instead of hard-coding it.
- Machine config file `<DSH_HOME>/keil/config.json` (`{"uv4": "..."}`), the
  `DSH_KEIL_CONFIG` relocation variable, and the `DSH_KEIL_UV4` / `KEIL_UV4`
  environment overrides.
- Broader UV4 discovery: `HKCU` and `HKLM` Keil product keys (32/64-bit),
  `Program Files`, `%LOCALAPPDATA%`, drive roots and `PATH`, on top of the
  previous common-folder scan.
- `scripts/install.mjs`: zero-dependency installer that finds the DSH home,
  the profile and the right DSH CLI (including the Desktop app carrier CLI that
  is allowed to manage the reserved `desktop` profile), installs the bundle and
  — unless `--no-ui` — the optional `dsh-better-sidebar`, then verifies the
  installed CLI.
- `AGENTS.md`: a short install/verify/fix runbook so an AI agent can port the
  plugin without rediscovering DSH profile behaviour.
- English `README.md`, Chinese `README.zh-CN.md`, `docs/ARCHITECTURE.md`,
  `LICENSE` (MIT) and `.gitignore`.

### Changed

- **`dsh-better-sidebar` is now optional.** The plugin always loads: without
  the sidebar bundle you get the `keil` tool, the `dsh-keil` CLI and the
  `POST /keil/api` route, and no sidebar tab is registered (previously the
  Client half required that service). When it is mounted, the `Keil` tab
  appears exactly as before.
- The Host half only requires the `tools` service; `webServer` is optional, so
  the tool and CLI work in profiles without a web server.
- `VERSION` is read from `package.json` instead of being duplicated in code.
- `status` and the HTTP status route now report `uv4.source`, the config file
  and configuration values, so the model can explain a missing Keil install.
- `package.json` is publishable: real description/keywords/author/engines,
  `private` removed, `MIT`, `LICENSE` and both READMEs shipped.

### Fixed

- Installing by a relative path is no longer a trap in the docs and scripts:
  the installers always pass an absolute path, because pnpm resolves
  `file:../...` against the invoking directory rather than the profile.
- `UV4_NOT_FOUND` now carries the attempted locations and the exact
  `set-uv4`/environment fix instead of a bare message.

## [0.1.x] - previous iterations

Internal development versions. The project started as a rewrite of an earlier
Python `keil-tool` (strict uvprojx editing, same CLI semantics) and grew into a
DSH bundle with a Host tool, an HTTP route, a JSON CLI and an optional sidebar
panel. The Python tool is intentionally not part of this repository.
