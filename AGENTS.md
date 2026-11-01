# AGENTS.md

Purpose: install, verify and repair the **dsh-keil** DSH bundle fast, with no prior
knowledge of the DSH profile layout. Humans should read [README.md](README.md) instead.

`dsh-keil` adds the model tool `keil`, the `dsh-keil` CLI, and an optional sidebar tab
(only when `dsh-better-sidebar` is mounted). Builds need Windows + Keil MDK (`UV4.exe`);
the plugin itself installs and loads on any OS.

## Prerequisites

- [ ] Node.js >= 20 (`node --version`) — the installer needs it.
- [ ] DSH installed: the Desktop app, or a `dsh` CLI on `PATH`.
- [ ] `pnpm` on `PATH` **only** when driving the ordinary `dsh` CLI; the Desktop app's
      carrier CLI bundles its own pnpm.
- [ ] Absolute path to this checkout. Relative `file:` specs resolve against your
      shell's cwd, not the profile, and fail to resolve.
- [ ] Windows + Keil MDK (`UV4.exe`) to build/download firmware.

## Install

### One command (preferred)

```powershell
node scripts/install.mjs            # resolves profile + CLI, installs, verifies
node scripts/install.mjs --check    # report-only, writes nothing; exits 0
node scripts/install.mjs --dry-run  # print the exact commands, run none
node scripts/install.mjs --profile web --no-ui
```

Profile resolution: `--profile`, else `$DSH_PROFILE`, else `desktop` when
`<home>/profiles/desktop` exists, else `web`. DSH home: `--home`, else `$DSH_HOME`,
else `~/.dsh`. CLI: `$DSH_CLI`, else the Desktop carrier CLI for the `desktop`
profile, else `dsh` on `PATH`. Exit codes: `0` ok, `1` failed, `2` usage error.
The script never edits a profile `package.json`; it only shells out to the DSH CLI
and then reads the profile back to verify.

`file:<abs path>` installs a snapshot: pnpm hard-links the package into the profile,
so **rerun the installer after `git pull`**. For live development against the
checkout, install `link:<abs path>` instead (a symlink; edits apply on DSH restart).

### Manual: Desktop profile (`desktop`)

The ordinary `dsh` CLI refuses this profile. Use the CLI shipped inside the app
(carrier CLI), which runs the app's bundled pnpm:

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" `
  plugin --profile desktop add "file:<absolute-repo-path>"
```

Other possible app roots: `%ProgramFiles%\DeepSeek Harness`; on macOS/Linux the
carrier CLI is `<app>/resources/runtime/cli/bin/dsh` (also try `resources/cli/bin/`).
Equivalent GUI path: **Settings -> Plugins -> install bundle from absolute local
directory** and pick the checkout directory. If your session exposes the
`plugin_manager` tool, `install_bundle <absolute-repo-path>` is the same operation.

### Manual: ordinary profile (`web`, `tui`, custom)

```powershell
dsh plugin --profile <profile> add "file:<absolute-repo-path>"
```

This initializes a missing profile on first use and needs `pnpm` on `PATH`.
On success the CLI itself appends `dsh-keil` to the profile's
`dsh.profile.bundles` — never do that by hand.

## Verify

```powershell
# 1. the installed CLI reports status JSON (path is profile-specific)
& "<profile-dir>\node_modules\.bin\dsh-keil.cmd" status --cwd <cwd> --compact
```

Expect `{"ok":true, "data":{ ... "uv4":{"found":true,...}, "selection":null, ...}}`.
`selection: null` is correct until the user picks a project.

```powershell
# 2. environment detail, every UV4 path attempt, config and state locations
& "<profile-dir>\node_modules\.bin\dsh-keil.cmd" doctor
& "<profile-dir>\node_modules\.bin\dsh-keil.cmd" show-config
```

- Restart DSH (quit and relaunch the app for `desktop`) so the new bundle loads.
- In a **new** session the tool `keil` must appear; call `keil` with `action: "status"`.
- The `Keil` sidebar tab appears only when `dsh-better-sidebar` is mounted. No tab is
  a supported state: the tool, CLI and HTTP API still work and report no error.

## Configure UV4 (Keil)

Resolution order (first hit wins):

1. environment `DSH_KEIL_UV4` or `KEIL_UV4`
2. machine config `%USERPROFILE%\.dsh\keil\config.json` — `{"uv4": "C:\\Keil_v5\\UV4\\UV4.exe"}`
   (`DSH_KEIL_CONFIG` relocates that file; `DSH_KEIL_STATE` relocates state/backups/logs)
3. Windows registry `Keil\Products\MDK` -> common install dirs (`%LOCALAPPDATA%\Keil_v5`, `C:`..`F:\Keil_v5`)
4. `where UV4.exe`

When a tool call or `status` reports `uv4.found=false` / `UV4_NOT_FOUND`:

```powershell
& "<profile-dir>\node_modules\.bin\dsh-keil.cmd" doctor          # see every attempted path first
& "<profile-dir>\node_modules\.bin\dsh-keil.cmd" set-uv4 --path "C:\Keil_v5\UV4\UV4.exe"
# --path accepts UV4.exe, its UV4 directory, or the Keil root (C:\Keil_v5)
$env:DSH_KEIL_UV4 = "C:\Keil_v5\UV4\UV4.exe"                      # per-session alternative
```

`set-uv4` writes the machine config, so every profile and CLI call on the machine
uses it. Do not commit machine paths into this repo.

## Optional sidebar (dsh-better-sidebar)

```powershell
# add (UI only; version verified with this plugin)
& "<carrier-cli>" plugin --profile <profile> add dsh-better-sidebar@0.28.2
# or: dsh plugin --profile <profile> add dsh-better-sidebar@0.28.2

# remove
& "<carrier-cli>" plugin --profile <profile> remove dsh-better-sidebar
```

Absent is supported: no sidebar tab, no startup error, `keil`/CLI unaffected. Never
"fix" a missing tab by hard-failing the plugin on the dependency.

## Known failures

| Symptom | Cause | Fix |
| --- | --- | --- |
| `error: profile "desktop" is managed exclusively by the Electron application` | plain `dsh` used for the reserved profile | use the carrier CLI (`<app>/resources/runtime/cli/bin/dsh.cmd`) or the GUI plugin installer |
| install fails resolving the package / 404 for a `file:` spec | relative path was passed | pass `file:<absolute-repo-path>` (quoted) |
| `dsh: pnpm was not found; install pnpm and make it available on PATH.` (exit 127) | ordinary `dsh` CLI needs pnpm | install pnpm and reopen the shell, or use the Desktop carrier CLI |
| package on disk but no `keil` tool / no tab after restart | `dsh-keil` missing from `dsh.profile.bundles` | reinstall through the CLI/GUI (the CLI registers it); never hand-edit bundles; then restart |
| `UV4_NOT_FOUND` | UV4 not discoverable | `dsh-keil doctor`, then `set-uv4 --path ...` or set `DSH_KEIL_UV4` |
| `NO_PROJECT_SELECTED` | no project chosen for this cwd | the **user** picks a `.uvprojx` in the Keil panel, or supplies `project`; the agent must not auto-select |
| `BUILD_BUSY` | only one build at a time | wait for `build_status`/`build-status`, or stop it with `build_stop`/`build-stop` |
| profile install errors with another pnpm/install operation running | DSH profile write lock | let the running install finish (or quit the app), then rerun `node scripts/install.mjs` |
| `--check` picks an unexpected profile | `$DSH_PROFILE` / `$DSH_PROFILE_DIR` set in the shell | pass `--profile <name>` explicitly |

## Do not

- Never hand-edit `dsh.profile.bundles` (or a profile `package.json`/lockfile) — the
  DSH CLI owns registration; a wrong edit breaks startup.
- Never commit machine-specific paths (UV4/Keil paths, absolute checkout paths) to
  the repo; keep them in the machine config or environment.
- Never auto-select a `.uvprojx`. `status` may list candidates; selection belongs to
  the user, otherwise the tool answers `NO_PROJECT_SELECTED`.
- Never delete `keil-tool/` contents. It is a local historical fixture (the old Python
  tool plus generated build logs/history), not tracked or published; treat it as
  read-only and never add it to the package `files` list.
- Do not run two builds concurrently; builds are serialized by design.
- Do not install into the `desktop` profile with the plain `dsh` CLI, and do not
  reuse the `desktop` profile name for tests. Use a throwaway `--profile` name and
  delete it afterwards.

## Layout facts

- DSH profiles: `<DSH_HOME>/profiles/<name>`, `DSH_HOME` defaults to `~/.dsh`
  (`%USERPROFILE%\.dsh`); env overrides `DSH_HOME`, `DSH_PROFILE`, `DSH_PROFILE_DIR`.
- Machine runtime files: `~/.dsh/keil/{state.json,config.json,backups,logs}`.
- Plugin manifest: `package.json` (`dsh.bundle.patch` -> `cordis.patch.yml`;
  `bin.dsh-keil` -> `bin/keil.mjs`; `exports` -> `lib/index.js`, `client/index.js`).
- Commands: `status`, `doctor`, `set-uv4`, `show-config`, `candidates`, `select`,
  `clear-selection`, `tree`, `files`, `build`, `rebuild`, `clean`, `download`,
  `build-start`, `build-status`, `build-stop`, `add-file`, `remove-file`,
  `add-include`, `remove-include`, `create-group`, `delete-group`. All output is
  JSON; exit codes `0` ok, `1` operation failed, `2` usage error.
- Tests: `node --test test/core.test.mjs`; syntax: `node --check lib/core.mjs`.

Humans: [README.md](README.md). Deeper design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
