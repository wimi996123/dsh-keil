# Architecture

`dsh-keil` is one npm package with two DSH halves that share a single, dependency-free core:

```text
 browser (web GUI)                       DSH host process                  Windows filesystem / Keil
┌────────────────────────┐   POST /keil/api   ┌───────────────────────┐   ┌───────────────────────┐
│ client/index.js        │ ─────────────────▶ │ lib/index.js          │   │ .uvprojx registration │
│  Keil sidebar tab      │                    │  keil model tool      │──▶│ uvprojx parser/editor │
│  (only with            │ ◀───────────────── │  /keil HTTP route     │   │ backups/, logs/       │
│  dsh-better-sidebar)   │      JSON          │                       │   │ UV4.exe (build/flash) │
└────────────────────────┘                    │        invokeAction() │   └───────────────────────┘
                                              │              │        │
 model (agent runtime) ──── tool call ───────▶ │              ▼        │
                                              │        lib/core.mjs   │
 CLI (`dsh-keil`) ──────── exec ─────────────▶ │  selection · parser · │
                                              │  build manager · UV4  │
                                              └───────────────────────┘
```

`lib/core.mjs` imports no DSH package — only `node:fs`, `node:os`, `node:path`, `node:crypto` and
`node:child_process`. That is deliberate: the tests and the CLI run it as plain Node, and the host half is a thin
adapter over it.

## Package layout and DSH declaration

`package.json` is both an npm manifest and the DSH bundle declaration:

| Field | Value | Meaning |
| --- | --- | --- |
| `exports["."]` | `./lib/index.js` | Host half (node module) |
| `exports["./client"]` | `./client/index.js` | Client half (browser bundle) |
| `exports["./cli"]`, `bin.dsh-keil` | `./bin/keil.mjs` | JSON CLI |
| `dsh.bundle.patch` | `./cordis.patch.yml` | Patch overlay that mounts the plugin |
| `dsh.client` | `{ platform: "web", immediately: true }` | The client half is a web client bundle that boots with the GUI |
| `engines.node` | `>=20` | ESM, modern `node:test` |

`cordis.patch.yml` contains one insert row:

```yaml
- insert:
    - id: keil
      name: dsh-keil
      config: {}
```

Installing the package through `dsh plugin … add` puts the package in `<profile>/node_modules` and appends it to
`dsh.profile.bundles`; at boot the profile composes bundle patch layers, which adds this row to the loader tree and
loads `lib/index.js`. Nothing in the repository edits a profile manifest by hand. A `file:` spec installs a snapshot
(re-install after `git pull`), while `link:` points the profile at the live checkout.

## Host half (`lib/index.js`)

- `export const inject = ['tools']` — the model tool is the only hard requirement.
- `apply(ctx)` registers the `keil` tool inside `ctx.effect(...)`, so disposal follows the plugin lifecycle.
- A nested `ctx.inject(['webServer'], …)` registers the HTTP route. Profiles without a web server (headless, TUI)
  therefore keep the tool and the CLI and simply have no route and no panel.
- The route is registered as `{ kind: 'prefix', path: '/keil', handler }`: the host web server matches `/keil` and
  `/keil/...` and hands the request to the handler, which only answers `/keil/api`.
- Before touching a request, the handler asks `ctx.get('connection')` for the host's request guard, so the API
  inherits the GUI's origin/auth policy instead of inventing one.

The tool schema is deliberately narrow: `action` plus the fields `project/group/file/path/name/query/mode/
allowMissing/allowMultiple`. `execute()` derives the working directory from `exec.agent.session.header.cwd`, maps
the tool's `path` parameter to the core's `includePath`, and forwards everything to `invokeAction`.

## Client half (`client/index.js`)

The file is a self-registering client bundle: `window.__ModuleLoader__.load({ id: 'dsh-keil', factory(require) })`,
where `require('react')` comes from the GUI's module registry. It exports `inject: []` — **nothing is required**:

- `ctx.inject(['locale'], …)` registers `zh`/`en` dictionaries for the panel strings. Without the locale service the
  panel falls back to its built-in dictionaries.
- `ctx.inject(['betterSidebar'], …)` registers the **Keil** tab (`id: 'keil'`, `order: 35`, `single: true`) with the
  panel component. Without `dsh-better-sidebar` this callback never runs: the bundle loads, no tab appears, no error.

The panel never calls the host directly; `callApi()` builds the URL with
`ctx.betterSidebar.hostRouteUrl('/keil/api')` and falls back to the relative `/keil/api`, then unwraps
`{ ok, data, error }`. All panel state (selection, tree, include paths, build job) comes from that same route, so the
UI has no private code path.

## HTTP API contract

| Request | Response |
| --- | --- |
| `GET /keil/api` | `200 {"ok":true,"data":{"version","build","uv4"}}` |
| `POST /keil/api` body `{action, ...params, cwd?}` | `200 {"ok":true,"data":…}` |
| `POST /keil/api` failing action | `200 {"ok":false,"error":{"code","message","details"?}}` |
| any other `/keil/...` path | `404 {"ok":false,"error":{"code":"NOT_FOUND",…}}` |
| non-GET/POST on `/keil/api` | `405` |

Bodies are read through a 1 MiB stream limit (`BODY_TOO_LARGE`) and parsed as JSON (`BAD_JSON`). Domain failures are
reported in the body rather than as HTTP status codes, so the panel and any HTTP client see the same error codes as
the tool and the CLI.

## Shared action facade

`invokeAction(action, params)` in `lib/core.mjs` is the single dispatch table:

- cases: `status`, `candidates`, `select`, `clear_selection`, `doctor`, `tree`, `files`, `create_group`,
  `delete_group`, `add_file`, `remove_file`, `add_include`, `remove_include`, `build`, `rebuild`, `clean`,
  `download`, `build_start`, `build_status`, `build_stop`.
- every case resolves the project through `resolveProjectPath(cwd, params.project)`, so an explicit `project`
  argument wins and otherwise the stored user selection is used — a scan never selects anything.
- the model tool exposes an 18-action subset (no `select`/`clear_selection`): choosing a project belongs to the user.
- the CLI maps commands onto these helpers directly (`getRuntimeStatus`, `setUv4Path`, `readConfig`, `buildManager`)
  so it can implement `show-config`, `build-status` and `build-stop` without a round trip.

## uvprojx editing design

The project file is treated as text plus node spans, never as an object graph to re-serialize:

1. `parseXml` tokenizes tags/comments/CDATA/processing instructions, records `start`, `openEnd`, `closeStart` and
   `end` offsets and parents, and throws `BAD_PROJECT_XML` on a mismatched or unclosed tag (strict, no recovery).
2. `readProjectInternal` reads the first `<Target>` and extracts target name, device, `<IncludePath>`, `<Groups>` →
   `<Group>` → `<Files>` → `<File>` with each element's span.
3. Edits are string splices over the original text: `insertBeforeCloseTag` (keeps the existing indentation and EOL
   style), `replaceNodeText` (include path list) and `removeElement` (removes a line when it is otherwise blank).
4. Text values are XML-escaped/unescaped; BOM at the start of the file is ordinary text and survives.
5. Before writing, `backupProject` copies the file to `~/.dsh/keil/backups/<base>/<timestamp>.uvprojx` (50 newest
   kept). `writeProjectAtomic` writes `<project>.<pid>.<ms>.tmp` beside it and renames, so a crash cannot truncate
   the project.

Path handling mirrors the earlier Python tool: candidate paths are built from the caller's workspace first and from
the `.uvprojx` directory second, the first existing candidate wins, and the value stored in `<FilePath>`/
`<IncludePath>` is relative to the `.uvprojx` directory. `FileType` is derived from the extension
(`.c`=1, `.s`/`.asm`=2, `.lib`/`.a`=4, `.cpp`/`.cc`/`.cxx`=8, everything else 5).

## State, config, backups, logs

`KEIL_HOME` is the directory of the state file, so all machine-local data lives in one place:

| File | Schema | Notes |
| --- | --- | --- |
| `state.json` | `{version:1, workspaces:{<normalized cwd>:{project, updatedAt, source}}}` | `DSH_KEIL_STATE` relocates it; the key is `resolve()`, posix slashes, lower case |
| `config.json` | `{version:1, uv4:"C:\\…\\UV4.exe"}` | `DSH_KEIL_CONFIG` relocates it; written by `set-uv4` |
| `backups/<base>/*.uvprojx` | project copies | pruned to 50 |
| `logs/<base>/<timestamp>-<mode>.log` | UV4 `-o` output | one file per build/download |

Machine settings are intentionally per-machine, not per-profile: every profile and every CLI invocation on the box
reads the same `config.json`, which is why `set-uv4` is the supported way to point the plugin at a Keil install.

## Build manager lifecycle

`BuildManager` serializes UV4 runs:

1. `start({project, mode})` rejects a second concurrent job with `BUILD_BUSY`, resolves `UV4.exe`
   (`UV4_NOT_FOUND` carries the attempt list and fix hint), validates `mode`, creates the log file and spawns
   `UV4.exe <flag> <project> -j0 -o <logfile>` in the project directory (`-b`, `-r`, `-c`, `-f` for
   build/rebuild/clean/download).
2. A 15-minute timer kills the child on timeout; `stdout`/`stderr` are captured as a fallback for UV4 versions that
   write less to the log file.
3. `finish()` maps exit code `0`/`1` to `success` (Keil reports a warning-only build as `1`), anything else — spawn
   error, timeout, stop — to `failed`, reads the log file, trims the text to `MAX_LOG_CHARS` (240k characters),
   parses the summary (`Program Size`, `N Error(s), M Warning(s)`, target, elapsed time, erase/program/verify
   markers) and, for a successful build/rebuild, locates the newest `.hex` under the project directory.
4. `wait(id)` returns the finished job or registers a waiter, which is how the blocking tool/CLI actions
   (`build`, `rebuild`, `clean`, `download`) work without polling.
5. `current()`/`publicJob()` report the live job (refreshing the log tail from disk); `stop()` kills the child and
   finishes the job as failed. The panel polls `build_status` every 0.9 s and displays log, exit code, summary, HEX
   and log path.

## UV4 discovery

`describeUv4()` resolves in this order and caches the result for 2 seconds (`resetUv4Cache()` for tests and after a
config write):

1. environment `DSH_KEIL_UV4`, then `KEIL_UV4`;
2. `<KEIL_HOME>/config.json` (`uv4` or legacy `uv4Path`);
3. Windows registry `Keil\Products\MDK` `Path` under `HKLM\WOW6432Node`, `HKLM`, `HKCU`; the value and up to three
   parent directories are probed for `UV4\UV4.exe` and `UV4.exe`;
4. common folders (`%LOCALAPPDATA%`, `Program Files`, `Program Files (x86)`, `ProgramW6432`, `C:`–`F:\Keil_v5`);
5. `where UV4.exe` on `PATH`.

Each accepted input may name the executable, its `UV4` folder or the Keil root (`resolveUv4Input`). The result object
(`path`, `found`, `source`, `configFile`, `envKeys`, `attempts`, `hint`) is what `doctor`, `status`, the HTTP status
route and `UV4_NOT_FOUND` all expose, so a human or the model can see exactly what was tried.

## Testing strategy

`test/core.test.mjs` is hermetic and self-contained: it sets `DSH_KEIL_STATE`/`DSH_KEIL_CONFIG` into a temp
directory, clears `DSH_KEIL_UV4`/`KEIL_UV4`, builds fixture projects on disk and imports `lib/core.mjs` directly.
14 tests cover:

- project view parsing (target, device, groups, files, include paths, missing-file flag);
- add/remove file and group/include round-trips, including the **byte-identical** assertion after add+remove;
- duplicate registration rejection (`FILE_EXISTS`, `INCLUDE_EXISTS`, `GROUP_EXISTS`);
- per-workspace selection, and that a candidate scan never selects (`NO_PROJECT_SELECTED`);
- relative-path resolution from the workspace first;
- `FileType` mapping (`.inc` stays 5);
- strict parser rejection of mismatched XML;
- edge cases: BOM, CRLF, comments containing fake tags, `>` inside attribute values, self-closing `<Files/>`;
- UV4 input acceptance (exe / `UV4` dir / Keil root), env-over-config priority, `set-uv4` persistence and rejection of
  junk paths, and the `status`/`doctor` reports exposing the source and config paths.

For a new operation, add a fixture-based test that (a) asserts the resulting view and (b) asserts the reverse
operation restores the original bytes. That pair is what protects the "registration edits only" guarantee.

## Extension points

- **New actions**: add a case to `invokeAction`, a CLI command in `bin/keil.mjs`, and — if the model should use it —
  an entry in `lib/index.js` `ACTIONS` plus schema fields. One implementation in `core.mjs` keeps all three surfaces
  consistent.
- **Other toolchains (IAR, CMake/Make, arm-none-eabi)**: the build manager only needs a toolchain resolver
  (like `describeUv4`) and an argument builder (like the `-b/-r/-c/-f` mapping); the registration editor is specific
  to `.uvprojx` and would need a sibling model behind the same view shape.
- **Debug/attach**: a new `mode` for `BuildManager` plus a UI action would reuse the job/log/summary pipeline; the
  download path already relies on the project's own debugger and flash-algorithm configuration.
- **Multi-target projects**: `readProjectInternal` already records every `<Target>` name; editing other targets means
  parameterizing the target selection and the `<Groups>` lookup.
- **UI**: the panel receives everything through `/keil/api`; additional views (memory usage, map file, download
  history) need no new host surface beyond extra actions.
