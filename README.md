# dsh-keil

Keil MDK/uVision workbench for DeepSeek Harness (DSH). The model can inspect, build and flash an embedded project
through one tool, a JSON CLI and a small HTTP API — with an optional sidebar panel for the human.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) · English | [简体中文](README.zh-CN.md)

## The problem

Embedded firmware is built by a vendor IDE, not by an agent: the build recipe lives in a Keil `.uvprojx` project, the
compiler is whichever MDK is installed, and flashing needs the IDE's debugger configuration. An AI agent can read the
C sources but cannot run the loop that matters — compile, read errors, fix, download — so a human relays every iteration.

`dsh-keil` exposes that loop as data: the agent asks for a build and gets JSON back — exit code, error/warning counts,
program size, log path and the generated HEX. Panel, CLI and HTTP route share one core, so they cannot drift apart.

## What it does

- **User-selected project only.** Candidates are scanned and listed, never auto-picked; selection is an explicit user
  action stored per workspace.
- **Build and flash through UV4.** `-b` build, `-r` rebuild, `-c` clean, `-f` download; one job at a time, UV4 log
  captured to a file.
- **Project tree and include paths.** Groups, registered files (missing ones flagged) and the semicolon-separated
  `<IncludePath>` list, editable from panel, tool and CLI.
- **Registration edits only.** Source files, `.uvoptx` and build output on disk are never touched; every mutation is
  backed up first and written through a temp file plus rename.
- **Byte-preserving XML edits.** A strict span-preserving parser splices string ranges instead of re-serializing:
  add-then-remove restores the file byte for byte, and BOM/CRLF/comments survive.
- **JSON-only CLI** (`dsh-keil`, exit `0`/`1`/`2`) and an **optional "Keil" sidebar tab**.

## Requirements

| Requirement | Notes |
| --- | --- |
| Windows 10/11 | Build and download run `UV4.exe`, so they need Windows. Read-only inspection works wherever Node runs. |
| Keil MDK with uVision 5 (`UV4.exe`) | Compiler, device packs and debugger setup come from your MDK install and the project. |
| DSH `0.2.1-rc.1` or newer | Desktop app, or a CLI-managed profile (`web`, `tui`, …). The package is a normal DSH bundle. |
| Node.js 20 or newer | The desktop app ships its own runtime; a standalone install needs Node 20+ (`engines`). |
| `dsh-better-sidebar` `0.28.0`+ | **Optional.** Only for the sidebar tab; tool, CLI and HTTP API do not depend on it. |

## Installation

Install the bundle from this directory and always pass an **absolute spec** (`file:` plus a forward-slash absolute
path). A relative spec resolves against whatever directory the package manager runs in, not against the checkout, so
it silently fails to find the plugin.

### 1. CLI-managed DSH profile (fastest)

```powershell
dsh plugin --profile web add "file:C:/src/dsh-keil"
dsh plugin --profile web add dsh-better-sidebar@0.28.2   # optional UI
```

The plain `dsh` CLI needs `pnpm` on `PATH` (the desktop carrier CLI bundles its own). The command installs the package
and appends it to the profile's `dsh.profile.bundles` because `package.json` declares a bundle patch. Restart the
profile afterwards. The reserved `desktop` profile is refused by this CLI (`profile "desktop" is managed exclusively
by the Electron application`) — use the desktop app path below for it.

A `file:` install pins a snapshot of this checkout, so re-run the install after a `git pull`; for live development
against the checkout, install `link:C:/src/dsh-keil` instead — edits then apply on the next DSH restart.

### 2. Desktop app

Use **Settings → Plugins** to install a bundle from the absolute checkout directory, or run the bundled installer,
which locates the DSH home, the profile and the CLI allowed to write it (the app's carrier CLI for `desktop`, plain
`dsh` otherwise; see [AGENTS.md](AGENTS.md) for the manual carrier-CLI commands):

```powershell
node scripts/install.mjs --check                 # report only: profile, CLIs, UV4, repo
node scripts/install.mjs --dry-run               # print the exact commands, write nothing
node scripts/install.mjs                         # install into the resolved profile
node scripts/install.mjs --profile web --no-ui   # another profile, no sidebar
```

Flags: `--profile <name>` (default: `$DSH_PROFILE`, else `desktop` when it exists, else `web`), `--home <dir>`
(`$DSH_HOME`, else `~/.dsh`), `--repo <dir>` (checkout to install), `--no-ui` (skip `dsh-better-sidebar`), `--dry-run`
(print commands, write nothing), `--check` (report-only health check, writes nothing) and `--json` (summary only).
`node scripts/install.mjs --help` is authoritative. Quit the app only if pnpm reports the profile as locked.

### 3. Agent-assisted install

Point an AI agent at [AGENTS.md](AGENTS.md): it holds the install, verify and repair runbook, so the agent does not
have to rediscover DSH profile behaviour.

### Verification

`node bin/keil.mjs --help`, `node bin/keil.mjs doctor --compact`, `node bin/keil.mjs show-config` and
`node --test test/core.test.mjs` all run from a plain checkout. Once installed, the same CLI is exposed as `dsh-keil`
in the profile's `node_modules/.bin`.

## Optional dependency behaviour

`dsh-better-sidebar` is the only optional dependency and a UI concern only: the client half registers its tab inside
`ctx.inject(['betterSidebar'], …)`, so without that service the registration never runs, the bundle still loads, and
no error is raised.

| Without `dsh-better-sidebar` | With `dsh-better-sidebar` |
| --- | --- |
| Tool, CLI and `/keil/api` all work | Tool, CLI and `/keil/api` all work |
| No sidebar tab, no warning | A **Keil** tab: picker, build buttons, tree, include paths, log |

The host half requires only the `tools` service; `webServer` is optional too, so a headless or TUI profile keeps the
tool and the CLI but has no panel and no HTTP route.

## Configuring UV4

`UV4.exe` is looked up once per machine, first hit wins:

| Order | Source | Details |
| --- | --- | --- |
| 1 | Environment | `DSH_KEIL_UV4`, then `KEIL_UV4`; the value may be the exe, the `UV4` folder or the Keil root |
| 2 | Config file | `%USERPROFILE%\.dsh\keil\config.json` → `{"uv4": "C:\\Keil_v5\\UV4\\UV4.exe"}` |
| 3 | Registry | `HKLM\SOFTWARE\WOW6432Node\Keil\Products\MDK`, `HKLM\SOFTWARE\Keil\Products\MDK`, `HKCU\SOFTWARE\Keil\Products\MDK` — the `Path` value and its parents |
| 4 | Common folders | `%LOCALAPPDATA%\Keil_v5`, `%ProgramFiles%\Keil_v5`, `%ProgramFiles(x86)%\Keil_v5`, `C:`–`F:\Keil_v5` |
| 5 | `PATH` | `where UV4.exe` |

Record the path once instead of trusting discovery:

```powershell
dsh-keil set-uv4 --path "C:\Keil_v5\UV4\UV4.exe"
dsh-keil set-uv4 --path "C:\Keil_v5"          # UV4 directory or Keil root also accepted
dsh-keil doctor                               # every attempted path, plus the exact fix
node bin/keil.mjs show-config                 # config file in effect and the env keys
```

`set-uv4` validates the input, resolves it to `UV4.exe` and writes the machine config file. Humans and agents should
use it (or the environment variable) when a build reports `UV4_NOT_FOUND`; never commit a machine path.

## Usage

### Sidebar panel

Open the **Keil** tab. The first visit shows the project picker: scan the workspace for candidates (depth-limited,
`truncated` past the cap) or paste an absolute `.uvprojx` path; the choice is stored per workspace.

- **Build / Rebuild / Download / Clean** buttons, plus **Stop** while a job runs.
- **Build log** tab: status, exit code, Program Size, error/warning counts, HEX path and log file (0.9 s polling).
- **Project tree** tab: groups, files, missing entries flagged; add file / new group / remove / delete group.
- **Include paths** tab edits the `<IncludePath>` list. UI strings are localized zh/en.

### Model tool `keil`

`action` is required; optional parameters are `project`, `group`, `file`, `path`, `name`, `query`, `mode`,
`allowMissing`, `allowMultiple`.

| Kind | Actions |
| --- | --- |
| Read-only | `status`, `doctor`, `candidates`, `tree`, `files` |
| Build | `build`, `rebuild`, `clean`, `download` (wait for UV4, up to 15 min), `build_start`, `build_status`, `build_stop` |
| Registration edits | `add_file`, `remove_file`, `add_include`, `remove_include`, `create_group`, `delete_group` |

The tool deliberately has **no `select` action**: choosing the project belongs to the user. Without a `project`
argument the stored user selection for the session's working directory is used; without one the call fails with
`NO_PROJECT_SELECTED`.

### CLI `dsh-keil`

One JSON object per command. Exit codes: `0` success, `1` operation failed, `2` usage error. Global options:
`--cwd <dir>` (default: current directory), `--project <file>` (explicit project, overrides the stored selection),
`--compact` (one-line JSON), `--json` (accepted for compatibility; output is always JSON).

| Command | Purpose |
| --- | --- |
| `status` / `doctor` / `show-config` | Selection, project summary, UV4 and build state; environment diagnosis; config in effect |
| `set-uv4 --path <p>` | Validate and store `UV4.exe` / UV4 dir / Keil root |
| `candidates` | List `.uvprojx` files under `--cwd` (never selects one) |
| `select --project <file>` / `clear-selection` | Store or remove the user's choice for `--cwd` |
| `tree` / `files [--query <text>]` | Groups, files, include paths; source-file search |
| `build` / `rebuild` / `clean` / `download` | Run UV4 and wait; returns status, summary, log, HEX |
| `build-start --mode <m>` / `build-status` / `build-stop` | Non-blocking build control |
| `add-file --group <g> --file <p> [--allow-missing]` | Register a file in a group |
| `remove-file --group <g> --file <name> [--allow-multiple]` | Unregister a file |
| `add-include --path <dir> [--allow-missing]` / `remove-include --path <dir>` | Edit include search paths |
| `create-group --name <g>` / `delete-group --name <g>` | Add or remove a project group |

```powershell
dsh-keil select --cwd C:\work\fw --project C:\work\fw\MDK-ARM\app.uvprojx
dsh-keil tree --cwd C:\work\fw --compact
dsh-keil build --cwd C:\work\fw
dsh-keil download --project C:\work\fw\MDK-ARM\app.uvprojx
dsh-keil add-file --cwd C:\work\fw --group App --file Core\Src\timer.c
dsh-keil add-include --cwd C:\work\fw --path ../Core/Inc2 --allow-missing
```

Relative paths given to `add-file` / `add-include` / `remove-include` resolve from the workspace first, then from the
`.uvprojx` directory; the stored value is relative to the `.uvprojx` directory. `FileType` follows Keil's numbering:
`.c`→1, `.s`/`.asm`→2, `.lib`/`.a`→4, `.cpp`/`.cc`/`.cxx`→8, everything else (including `.h`, `.inc`)→5.

### HTTP API

The host half serves the panel's same-origin API at `/keil/api` (route prefix `/keil`, matched by the host web
server); it needs a mounted `webServer`, i.e. the Web or desktop composition.

```text
GET  /keil/api   → { "ok": true, "data": { "version", "build", "uv4" } }
POST /keil/api   body: { "action": "status", "cwd": "C:\\work\\fw" }
                 → { "ok": true, "data": … } | { "ok": false, "error": { "code", "message", "details"? } }
```

`action` is any action of the shared core (`status`, `tree`, `build_start`, `select`, …). Bodies are limited to 1 MiB;
failures come back as JSON rather than HTTP status codes, except an unknown `/keil/...` path (404) and an unsupported
method on the API path (405). The panel resolves the URL through the sidebar's host route helper, so it works when
the GUI is not on `/`.

### Data and state locations

| Path | Contents | Override |
| --- | --- | --- |
| `%USERPROFILE%\.dsh\keil\state.json` | User's project selection per workspace | `DSH_KEIL_STATE` |
| `%USERPROFILE%\.dsh\keil\config.json` | Machine UV4 path | `DSH_KEIL_CONFIG` |
| `%USERPROFILE%\.dsh\keil\backups\<project>\<timestamp>.uvprojx` | Pre-edit backups, 50 newest kept | follows the state directory |
| `%USERPROFILE%\.dsh\keil\logs\<project>\<timestamp>-<mode>.log` | UV4 build/download logs | follows the state directory |

## Safety model

- Only the `.uvprojx` **registration** is edited; source files, `.uvoptx`, object files and build output are never
  created or deleted (cleaning is left to `UV4 -c`).
- A backup is taken before every mutation, and new content is written to a temp file beside the project and renamed
  over it, so an interrupted run cannot leave a half-written project.
- Edits are string-range splices over the original text, covered by round-trip tests: add-then-remove restores the
  file byte for byte, preserving BOM, CRLF, comments and quoting; malformed XML is rejected, not guessed at.
- One build at a time; a second request fails with `BUILD_BUSY`, so two UV4 processes never write the same project.
- The plugin never guesses a project from a scan; an unselected workspace fails loudly.

## Troubleshooting

| Symptom / code | Cause | Fix |
| --- | --- | --- |
| `UV4_NOT_FOUND` | Discovery found no `UV4.exe` | `dsh-keil doctor`, then `set-uv4 --path …` or set `DSH_KEIL_UV4` |
| `NO_PROJECT_SELECTED` | No stored selection for that directory | Select in the panel, run `dsh-keil select`, or pass `--project` / `project` |
| `BUILD_BUSY` | A build or download is already running | `dsh-keil build-status`; wait or `build-stop` |
| `PROJECT_MISSING` | The selected `.uvprojx` moved or was deleted | Select it again; `clear-selection` also clears the stale entry |
| Installed, but no Keil tab | `dsh-better-sidebar` missing or not mounted | Install `dsh-better-sidebar@0.28.2`, restart; tool and CLI already work |
| Plugin not visible after install | Profile plugin list is read at boot | Restart the app / relaunch the profile, then check Settings → Plugins |
| `BAD_PROJECT_XML` / `FILE_MISSING` | Malformed project file, or a path not on disk | Re-save in uVision; fix the path or use `--allow-missing` |

## Development

```powershell
node --test test/core.test.mjs   # 14 tests: parser, round-trip, selection, UV4 resolution
npm run check                    # node --check on every entry point
npm run doctor                   # UV4 / discovery report
```

```text
dsh-keil/
  package.json          DSH bundle manifest, bin, client declaration, engines
  cordis.patch.yml      bundle patch row that mounts this plugin in a profile
  lib/core.mjs          discovery, selection, uvprojx parser/edits, build manager, state
  lib/index.js          host half: `keil` tool + /keil HTTP route
  client/index.js       client half: optional locale dictionaries + optional sidebar tab
  bin/keil.mjs          JSON CLI (`dsh-keil`)
  test/core.test.mjs    self-contained tests (temp dirs, real user state untouched)
  locale/{zh,en}.json   plugin-manager title/description
  scripts/install.mjs   zero-dependency installer/verifier
  docs/ARCHITECTURE.md  how the two halves and the core fit together
  AGENTS.md             install/verify/repair runbook for AI agents
```

## License and lineage

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 wimi996123.

The operation set (group/file registration, include paths, UV4 build and download, strict uvprojx editing) is a
Node.js rewrite of an earlier Python `keil-tool` whose behaviour it reproduces: same relative-path resolution, same
`FileType` mapping, same backup-then-atomic-write discipline. That Python tool is intentionally **not** tracked in
this repository; nothing here imports it.

## Scope and roadmap

- Only the **first target** of a multi-target project is read and edited; other target names are listed read-only.
- Building and flashing are **Windows-only**; project inspection is platform-neutral.
- No debugger integration: `download` runs `UV4 -f` and relies on the debugger/flash setup in the project.
- Registration edits only — no source-file creation, no MDK pack management, no compiler option editing. In the panel,
  RTE groups (names starting with `::`) have no delete button; the CLI has no such guard.
- Next steps: other toolchains behind the same tool surface, debug/attach actions, multi-target editing.
