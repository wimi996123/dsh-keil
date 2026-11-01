#!/usr/bin/env node
/**
 * dsh-keil installer / porter.
 *
 * WHY THIS SCRIPT EXISTS — DSH has TWO kinds of profiles, and they are managed
 * by different CLIs:
 *
 *   1. Ordinary profiles (`web`, `tui`, `headless`, any custom name):
 *      the `dsh` CLI on PATH manages them.
 *        dsh plugin --profile <name> add <spec>
 *      forwards <spec> to pnpm inside <DSH_HOME>/profiles/<name>, then registers
 *      the installed package in that profile's `dsh.profile.bundles` itself.
 *
 *   2. The Desktop application's RESERVED profile, named `desktop`:
 *      the ordinary CLI REFUSES it with
 *        error: profile "desktop" is managed exclusively by the Electron application
 *      Only the CLI shipped inside the app can manage it:
 *        <app>/resources/runtime/cli/bin/dsh.cmd   (Windows)
 *        <app>/resources/cli/bin/dsh               (macOS/Linux)
 *      That carrier CLI runs the app's OWN bundled pnpm, so pnpm does not have
 *      to be on PATH (the ordinary CLI does need it: it exits 127 otherwise).
 *
 * Everything else in this file follows from the install protocol:
 *   - the profile package.json is NEVER hand-edited here: bundle registration
 *     belongs to the CLI (`reconcile` in @deepseek-ai/dsh-plugin-manager), and
 *     `--check` only READS that file;
 *   - the spec is always an ABSOLUTE `file:` path. A relative spec is resolved
 *     against the invoking directory, not the profile, and silently fails;
 *   - idempotent: re-running adds the same absolute path again, which pnpm
 *     handles as "Already up to date";
 *   - zero dependencies, Node >= 20, Windows/macOS/Linux.
 *
 * Usage: node scripts/install.mjs [--profile <name>] [--home <dir>] [--repo <dir>]
 *                                 [--no-ui] [--dry-run] [--check] [--json] [--help]
 * Exit codes: 0 ok, 1 operation failed, 2 usage error.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MIN_NODE_MAJOR = 20
const PKG_NAME = 'dsh-keil'
/** Optional UI half: context service `betterSidebar` + the Keil sidebar tab. */
const SIDEBAR_SPEC = 'dsh-better-sidebar@0.28.2'
const IS_WINDOWS = process.platform === 'win32'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_APP_NAME = 'DeepSeek Harness'

const USAGE = `dsh-keil installer

Usage:
  node scripts/install.mjs [options]

Options:
  --profile <name>  DSH profile to install into
                    default: $DSH_PROFILE, else "desktop" when <home>/profiles/desktop
                    exists, else "web"
  --home <dir>      DSH home directory (default: $DSH_HOME, else ~/.dsh)
  --repo <dir>      dsh-keil checkout to install (default: this script's parent)
  --no-ui           do not install the optional dsh-better-sidebar dependency
  --dry-run         resolve everything, print the exact commands, write nothing
  --check           report-only health check (DSH home, profile, CLIs, UV4, repo);
                    writes nothing and exits 0 whenever it can produce the report
  --json            print only the final summary object (implies captured output)
  --help, -h        show this help

Environment overrides:
  DSH_HOME, DSH_PROFILE, DSH_PROFILE_DIR  profile/home resolution
  DSH_CLI                                 path to the dsh CLI (or carrier CLI) to use

Examples:
  node scripts/install.mjs --check
  node scripts/install.mjs --dry-run
  node scripts/install.mjs                       # desktop profile, with sidebar
  node scripts/install.mjs --profile web --no-ui
`

/* ------------------------------------------------------------------ *
 * Output
 * ------------------------------------------------------------------ */

const io = { json: false }

function say(text = '') {
  if (!io.json) process.stdout.write(`${text}\n`)
}

function warn(text) {
  if (!io.json) process.stderr.write(`warning: ${text}\n`)
}

class CliError extends Error {
  constructor(message, nextSteps = []) {
    super(message)
    this.nextSteps = nextSteps
  }
}

/* ------------------------------------------------------------------ *
 * Small filesystem helpers (no dependencies)
 * ------------------------------------------------------------------ */

function statOf(target) {
  try { return fs.statSync(target) } catch { return undefined }
}

function isFile(target) {
  return statOf(target)?.isFile() === true
}

function isDir(target) {
  return statOf(target)?.isDirectory() === true
}

function isLinkOrFile(target) {
  try { return fs.lstatSync(target).isFile() || fs.lstatSync(target).isSymbolicLink() } catch { return false }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return undefined }
}

function expandPath(input) {
  let value = String(input).trim().replace(/^"(.*)"$/, '$1')
  if (value === '~' || value.startsWith('~/') || value.startsWith('~\\')) {
    value = path.join(os.homedir(), value.slice(1))
  }
  if (IS_WINDOWS) {
    value = value.replace(/%([^%]+)%/g, (match, name) => process.env[name] ?? match)
  }
  return path.resolve(value)
}

function envValue(name) {
  const value = process.env[name]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/* ------------------------------------------------------------------ *
 * Argument parsing
 * ------------------------------------------------------------------ */

const VALUE_FLAGS = new Set(['profile', 'home', 'repo'])

function parseArgv(tokens) {
  const options = {
    profile: undefined,
    home: undefined,
    repo: undefined,
    ui: true,
    dryRun: false,
    check: false,
    json: false,
    help: false,
  }
  const problems = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === '-h' || token === '--help') { options.help = true; continue }
    if (!token.startsWith('-')) { problems.push(`unexpected argument: ${token}`); continue }
    const eq = token.indexOf('=')
    const name = eq === -1 ? token.slice(2) : token.slice(2, eq)
    const inline = eq === -1 ? undefined : token.slice(eq + 1)
    if (name === 'no-ui') { options.ui = false; continue }
    if (name === 'dry-run') { options.dryRun = true; continue }
    if (name === 'check') { options.check = true; continue }
    if (name === 'json') { options.json = true; continue }
    if (VALUE_FLAGS.has(name)) {
      const value = inline ?? tokens[index + 1]
      if (value === undefined || value.startsWith('-')) {
        problems.push(`--${name} needs a value`)
        continue
      }
      if (inline === undefined) index += 1
      options[name] = value
      continue
    }
    problems.push(`unknown option: ${token}`)
  }
  return { options, problems }
}

/* ------------------------------------------------------------------ *
 * Resolution: DSH home, profile, repo, CLI
 * ------------------------------------------------------------------ */

function resolveHome(explicit) {
  if (explicit !== undefined) return expandPath(explicit)
  return expandPath(envValue('DSH_HOME') ?? path.join(os.homedir(), '.dsh'))
}

/**
 * Default profile = $DSH_PROFILE, else `desktop` when the Desktop app has
 * already initialized its profile on this machine, else `web` (the shipped
 * non-Electron web template).
 */
function defaultProfileName(home) {
  return envValue('DSH_PROFILE') ?? (isDir(path.join(home, 'profiles', 'desktop')) ? 'desktop' : 'web')
}

function resolveProfile(explicitProfile, home) {
  if (explicitProfile !== undefined) {
    const name = explicitProfile.toLowerCase() === 'desktop' ? 'desktop' : explicitProfile
    return {
      name,
      dir: path.join(home, 'profiles', name),
      source: '--profile',
      note: envValue('DSH_PROFILE_DIR') === undefined
        ? undefined
        : 'ignoring DSH_PROFILE_DIR because --profile was given',
    }
  }
  const dirOverride = envValue('DSH_PROFILE_DIR')
  if (dirOverride !== undefined) {
    const dir = expandPath(dirOverride)
    const name = envValue('DSH_PROFILE') ?? path.basename(dir)
    const note = path.resolve(dir) === path.resolve(home, 'profiles', name)
      ? undefined
      : 'DSH_PROFILE_DIR is not <home>/profiles/<name>; `dsh plugin` always resolves <home>/profiles/<name>, so this value is only used for reporting'
    return { name, dir, source: 'env:DSH_PROFILE_DIR', note }
  }
  const name = defaultProfileName(home)
  return {
    name,
    dir: path.join(home, 'profiles', name),
    source: envValue('DSH_PROFILE') !== undefined ? 'env:DSH_PROFILE' : 'default',
  }
}

/**
 * The repo must be a dsh-keil checkout: package name, bundle patch and both
 * halves present. This catches "ran from the wrong directory" and a partial
 * copy before anything is installed.
 */
function resolveRepo(explicit) {
  const dir = path.resolve(explicit === undefined ? path.join(HERE, '..') : expandPath(explicit))
  const manifestFile = path.join(dir, 'package.json')
  const manifest = readJson(manifestFile)
  if (manifest === undefined) throw new CliError(`not a dsh-keil checkout (no readable package.json): ${dir}`)
  if (manifest.name !== PKG_NAME) {
    throw new CliError(`not a ${PKG_NAME} checkout: ${manifestFile} declares "${manifest.name}"`, [
      `pass the checkout explicitly: node scripts/install.mjs --repo "<abs path to ${PKG_NAME}>"`,
    ])
  }
  const required = [
    path.join(dir, 'lib', 'index.js'),
    path.join(dir, 'lib', 'core.mjs'),
    path.join(dir, 'client', 'index.js'),
    path.join(dir, 'bin', 'keil.mjs'),
    path.join(dir, 'cordis.patch.yml'),
  ]
  const missing = required.filter((file) => !isFile(file))
  if (missing.length > 0) {
    throw new CliError(`incomplete ${PKG_NAME} checkout (${dir}); missing: ${missing.map((f) => path.relative(dir, f)).join(', ')}`)
  }
  return { dir, manifest, version: String(manifest.version ?? '0.0.0') }
}

/** The app's `resources` directories, most likely first. */
function desktopResourcesDirs() {
  if (IS_WINDOWS) {
    const roots = [
      envValue('LOCALAPPDATA') === undefined ? undefined : path.join(process.env.LOCALAPPDATA, 'Programs', DEFAULT_APP_NAME),
      envValue('ProgramFiles') === undefined ? undefined : path.join(process.env.ProgramFiles, DEFAULT_APP_NAME),
      envValue('ProgramFiles(x86)') === undefined ? undefined : path.join(process.env['ProgramFiles(x86)'], DEFAULT_APP_NAME),
      envValue('LOCALAPPDATA') === undefined ? undefined : path.join(process.env.LOCALAPPDATA, DEFAULT_APP_NAME),
    ]
    return roots.filter((root) => root !== undefined).map((root) => path.join(root, 'resources'))
  }
  if (process.platform === 'darwin') {
    return [path.join('/Applications', `${DEFAULT_APP_NAME}.app`, 'Contents', 'Resources')]
  }
  return [
    path.join('/opt', DEFAULT_APP_NAME, 'resources'),
    path.join(os.homedir(), '.local', 'share', DEFAULT_APP_NAME, 'resources'),
  ]
}

/**
 * The carrier CLI the Desktop app ships. It is the only CLI allowed to manage
 * the reserved `desktop` profile, and it ignores PATH pnpm (uses its own).
 */
function carrierCliCandidates() {
  const exe = IS_WINDOWS ? 'dsh.cmd' : 'dsh'
  const found = []
  for (const resources of desktopResourcesDirs()) {
    for (const parts of [['runtime', 'cli', 'bin', exe], ['cli', 'bin', exe]]) {
      const candidate = path.join(resources, ...parts)
      if (isFile(candidate)) found.push(candidate)
    }
  }
  return found
}

function pathDirs() {
  const value = process.env.PATH ?? process.env.Path ?? ''
  return value.split(path.delimiter).filter((entry) => entry !== '')
}

/** Minimal `which`: prefer the .cmd npm shim on Windows over the POSIX shim. */
function findOnPath(names) {
  for (const name of names) {
    for (const dir of pathDirs()) {
      const candidate = path.join(dir, name)
      if (isFile(candidate)) return candidate
    }
  }
  return undefined
}

function dshOnPath() {
  return IS_WINDOWS ? findOnPath(['dsh.cmd', 'dsh.exe', 'dsh.ps1', 'dsh']) : findOnPath(['dsh'])
}

/**
 * Pick the CLI to drive.
 *   - $DSH_CLI wins when set (escape hatch for unusual installs);
 *   - the `desktop` profile REQUIRES the carrier CLI (plain dsh refuses it);
 *   - otherwise PATH `dsh` is preferred, with the carrier CLI as fallback.
 */
function resolveCli(profile, { tolerant = false } = {}) {
  /** --check reports a missing CLI; install/dry-run refuse to guess. */
  const notFound = (message, nextSteps, candidates = []) => {
    if (tolerant) return { path: undefined, kind: 'not-found', candidates, reason: message }
    throw new CliError(message, nextSteps)
  }
  const override = envValue('DSH_CLI')
  if (override !== undefined) {
    const candidate = expandPath(override)
    if (!isFile(candidate)) {
      return notFound(`$DSH_CLI does not point at a file: ${candidate}`, [
        'unset DSH_CLI, or set it to the dsh CLI (Windows: dsh.cmd)',
      ])
    }
    return { path: candidate, kind: 'env:DSH_CLI', candidates: [candidate] }
  }
  const carrier = carrierCliCandidates()
  if (profile.name === 'desktop') {
    if (carrier.length === 0) {
      return notFound('the desktop profile needs the CLI shipped with the DeepSeek Harness Desktop app, and it was not found', [
        `expected it at: <app>/resources/runtime/cli/bin/${IS_WINDOWS ? 'dsh.cmd' : 'dsh'}`,
        'install the Desktop app, or install into another profile: node scripts/install.mjs --profile web',
        'you can also install from the app GUI: Settings -> Plugins -> install bundle from absolute local directory',
        'or point the script at a known CLI: set DSH_CLI=<path to dsh.cmd>',
      ])
    }
    return { path: carrier[0], kind: 'desktop-carrier', candidates: carrier }
  }
  const plain = dshOnPath()
  if (plain !== undefined) return { path: plain, kind: 'path:dsh', candidates: [plain, ...carrier] }
  if (carrier.length > 0) return { path: carrier[0], kind: 'desktop-carrier', candidates: carrier }
  return notFound('no dsh CLI found (neither `dsh` on PATH nor the Desktop app carrier CLI)', [
    'install DSH, or add it to PATH, or set DSH_CLI=<path to dsh/dsh.cmd>',
    'you can also install from the app GUI: Settings -> Plugins -> install bundle from absolute local directory',
  ])
}

/* ------------------------------------------------------------------ *
 * Running child processes
 * ------------------------------------------------------------------ */

const CMD_META = /[&|<>^%!()"`]/

/** Quote one argument for `cmd.exe`. Windows paths cannot contain '"'. */
function quoteForCmd(argument) {
  const text = String(argument)
  if (CMD_META.test(text)) {
    // cmd.exe still expands %VAR% and treats a few characters specially even
    // inside quotes; such paths are rare and we cannot escape them portably.
    warn(`argument contains cmd metacharacters and may not survive cmd.exe: ${text}`)
  }
  return `"${text}"`
}

/** Quote one argument for display only (the real quoting is quoteForCmd). */
function displayArg(argument) {
  const text = String(argument)
  return /[\s"]/.test(text) ? `"${text}"` : text
}

/**
 * Node cannot spawn a .cmd/.bat directly on Windows (EINVAL/ENOENT), so such a
 * CLI is run through cmd.exe with explicit quoting; everything else is spawned
 * as a plain executable with an argument vector (no shell, no quoting issues).
 */
function executorFor(cli, args) {
  if (IS_WINDOWS && /\.(cmd|bat)$/i.test(cli)) {
    const comspec = process.env.ComSpec ?? 'cmd.exe'
    const inner = [cli, ...args].map(quoteForCmd).join(' ')
    return {
      file: comspec,
      argv: ['/d', '/s', '/c', `"${inner}"`],
      verbatim: true,
      // Show the CLI call itself; the cmd.exe wrapper is an implementation detail.
      display: [cli, ...args].map(displayArg).join(' '),
    }
  }
  if (IS_WINDOWS && /\.ps1$/i.test(cli)) {
    const pwsh = process.env.SystemRoot === undefined
      ? 'powershell.exe'
      : path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    return { file: pwsh, argv: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', cli, ...args] }
  }
  return { file: cli, argv: args }
}

function formatCommand(executor) {
  if (typeof executor.display === 'string') return executor.display
  return [executor.file, ...executor.argv.map(displayArg)].join(' ')
}

function run(executor, { capture = false, timeout, cwd } = {}) {
  const result = spawnSync(executor.file, executor.argv, {
    cwd,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    timeout,
    windowsHide: false,
    windowsVerbatimArguments: executor.verbatim === true,
  })
  return {
    status: typeof result.status === 'number' ? result.status : null,
    signal: result.signal ?? null,
    error: result.error === undefined ? undefined : result.error.message,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  }
}

function tail(text, lines = 6) {
  const all = String(text ?? '').trim().split(/\r?\n/).filter((line) => line !== '')
  return all.slice(Math.max(0, all.length - lines))
}

function probeVersion(cli) {
  const result = run(executorFor(cli, ['--version']), { capture: true, timeout: 30_000 })
  const text = `${result.stdout}\n${result.stderr}`.trim()
  const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== '') ?? ''
  return {
    ok: result.status === 0,
    exitCode: result.status,
    version: /^\d+\.\d+\.\d+/.test(firstLine.trim()) ? firstLine.trim() : undefined,
    output: text === '' ? undefined : tail(text, 3).join(' | '),
  }
}

/* ------------------------------------------------------------------ *
 * UV4 detection (mirrors lib/core.mjs; the authoritative check is
 * `dsh-keil doctor`, which also lists every attempted path)
 * ------------------------------------------------------------------ */

async function detectUv4(repoDir) {
  const coreFile = path.join(repoDir, 'lib', 'core.mjs')
  if (!isFile(coreFile)) return { known: false, reason: `missing ${coreFile}` }
  try {
    const core = await import(pathToFileURL(coreFile).href)
    const described = core.describeUv4({ refresh: true })
    return {
      known: true,
      found: described.found === true,
      path: described.path ?? null,
      source: described.source ?? null,
      configFile: described.configFile,
      envKeys: described.envKeys,
      attempts: Array.isArray(described.attempts) ? described.attempts.length : undefined,
      platform: described.platform,
    }
  } catch (error) {
    return { known: false, reason: `could not load lib/core.mjs: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/* ------------------------------------------------------------------ *
 * Profile state (read-only!) and the install plan
 * ------------------------------------------------------------------ */

function readProfileState(profileDir) {
  const state = {
    packageJsonFile: path.join(profileDir, 'package.json'),
    packageJson: undefined,
    packageJsonError: undefined,
    dependency: undefined,
    sidebarDependency: undefined,
    bundles: [],
    installedVersion: undefined,
    bin: undefined,
  }
  if (isFile(state.packageJsonFile)) {
    const manifest = readJson(state.packageJsonFile)
    if (manifest === undefined) state.packageJsonError = 'package.json is not valid JSON'
    else {
      state.packageJson = manifest
      const dependencies = manifest.dependencies ?? {}
      state.dependency = typeof dependencies[PKG_NAME] === 'string' ? dependencies[PKG_NAME] : undefined
      state.sidebarDependency = typeof dependencies['dsh-better-sidebar'] === 'string'
        ? dependencies['dsh-better-sidebar']
        : undefined
      state.bundles = Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
    }
  }
  const installedManifest = readJson(path.join(profileDir, 'node_modules', PKG_NAME, 'package.json'))
  state.installedVersion = installedManifest === undefined ? undefined : String(installedManifest.version ?? '?')
  state.sidebarVersion = (() => {
    const sidebar = readJson(path.join(profileDir, 'node_modules', 'dsh-better-sidebar', 'package.json'))
    return sidebar === undefined ? undefined : String(sidebar.version ?? '?')
  })()
  const binName = IS_WINDOWS ? `${PKG_NAME}.cmd` : PKG_NAME
  const binPath = path.join(profileDir, 'node_modules', '.bin', binName)
  state.bin = isLinkOrFile(binPath) ? binPath : undefined
  return state
}

function toFileSpec(dir) {
  // pnpm records forward slashes for local paths; a relative spec would resolve
  // against the invoking directory instead of the profile and fail silently.
  return `file:${path.resolve(dir).replace(/\\/g, '/')}`
}

function planSteps({ profile, profileDir, repo, options }) {
  const spec = toFileSpec(repo.dir)
  const state = readProfileState(profileDir)
  const steps = [{
    label: `install ${PKG_NAME} ${repo.version} from the checkout`,
    argv: ['plugin', '--profile', profile.name, 'add', spec],
    critical: true,
  }]
  const ui = { status: 'install', spec: SIDEBAR_SPEC, argv: undefined }
  if (!options.ui) {
    ui.status = 'skipped'
    ui.reason = '--no-ui'
  } else if (state.sidebarDependency !== undefined) {
    ui.status = 'skipped'
    ui.reason = `already in the profile (${state.sidebarDependency})`
    ui.installedVersion = state.sidebarVersion
  } else {
    ui.argv = ['plugin', '--profile', profile.name, 'add', SIDEBAR_SPEC]
    steps.push({ label: 'install the optional sidebar UI dependency', argv: ui.argv, critical: false })
  }
  return { spec, state, steps, ui }
}

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */

function colourlessState(state) {
  return {
    packageJson: state.packageJson === undefined ? null : {
      exists: true,
      dependency: state.dependency ?? null,
      bundles: state.bundles,
      sidebar: state.sidebarDependency ?? null,
    },
    installedVersion: state.installedVersion ?? null,
    bin: state.bin ?? null,
  }
}

function printHeader({ profile, home, repo, cli, spec }) {
  say(`dsh-keil installer  (node ${process.version} on ${process.platform})`)
  say(`  repo        : ${repo.dir}  (${PKG_NAME} ${repo.version})`)
  say(`  DSH home    : ${home}`)
  say(`  profile     : ${profile.name}  (${profile.source})`)
  say(`  profile dir : ${profile.dir}${isDir(profile.dir) ? '' : '  [missing]'}`)
  say(`  spec        : ${spec}`)
  say(`  dsh CLI     : ${cli.path}  (${cli.kind})`)
  if (profile.note !== undefined) warn(profile.note)
}

async function printCheck({ profile, home, repo, cli, spec }) {
  const state = readProfileState(profile.dir)
  const uv4 = await detectUv4(repo.dir)
  const carrier = carrierCliCandidates()
  const plain = dshOnPath()
  const check = {
    ok: true,
    action: 'check',
    dshHome: home,
    dshHomeExists: isDir(home),
    profile: { name: profile.name, dir: profile.dir, source: profile.source, exists: isDir(profile.dir) },
    repo: { dir: repo.dir, version: repo.version },
    spec,
    node: { version: process.version, ok: Number(process.versions.node.split('.')[0]) >= MIN_NODE_MAJOR },
    clis: {
      selected: { path: cli.path ?? null, kind: cli.kind, reason: cli.reason },
      desktopCarrier: carrier.map((candidate) => ({ path: candidate, version: probeVersion(candidate) })),
      pathDsh: plain === undefined ? null : { path: plain, version: probeVersion(plain) },
      note: profile.name === 'desktop'
        ? 'the desktop profile is only manageable by the Desktop app carrier CLI; plain `dsh` refuses it'
        : 'ordinary profiles are managed by `dsh` on PATH (needs pnpm on PATH)',
    },
    pnpm: (() => {
      const found = findOnPath(IS_WINDOWS ? ['pnpm.cmd', 'pnpm.exe', 'pnpm'] : ['pnpm'])
      return found === undefined ? { found: false, note: 'only needed by the ordinary `dsh` CLI; the Desktop carrier CLI bundles its own pnpm' } : { found: true, path: found }
    })(),
    uv4,
    profileState: colourlessState(state),
  }

  say(`dsh-keil installer check  (node ${process.version} on ${process.platform})`)
  say('')
  say(`  repo             : ${repo.dir}  (${PKG_NAME} ${repo.version})`)
  say(`  DSH home         : ${home}${isDir(home) ? '' : '  [missing]'}`)
  say(`  profile          : ${profile.name}  (${profile.source}) -> ${profile.dir}${isDir(profile.dir) ? '' : '  [missing]'}`)
  if (profile.note !== undefined) warn(profile.note)
  say(`  node             : ${process.version} (need >= ${MIN_NODE_MAJOR}: ${check.node.ok ? 'ok' : 'NO'})`)
  say(`  spec             : ${spec}`)
  say('')
  say('  dsh CLIs:')
  if (carrier.length === 0) say('    desktop carrier : not found')
  for (const candidate of carrier) {
    const probed = check.clis.desktopCarrier.find((entry) => entry.path === candidate)
    say(`    desktop carrier : ${candidate}  ->  ${probed?.version.version ?? probed?.version.output ?? 'version unknown'}`)
  }
  if (plain === undefined) say('    dsh on PATH     : not found')
  else say(`    dsh on PATH     : ${plain}  ->  ${check.clis.pathDsh.version.version ?? check.clis.pathDsh.version.output ?? 'version unknown'}`)
  say(`    selected        : ${cli.path ?? '(none found)'}  (${cli.kind})`)
  if (cli.path === undefined && cli.reason !== undefined) {
    say(`      ${cli.reason}`)
    if (profile.name === 'desktop') {
      say('      install from the app GUI instead: Settings -> Plugins -> install bundle from absolute local directory')
    }
  }
  say(`  pnpm             : ${check.pnpm.found ? check.pnpm.path : 'not found (fine for the desktop carrier CLI)'}`)
  say('')
  say('  UV4 / Keil:')
  if (uv4.known !== true) say(`    unknown: ${uv4.reason}`)
  else if (uv4.found) say(`    found   : ${uv4.path}  (source: ${uv4.source})`)
  else {
    say(`    NOT found (searched ${uv4.attempts ?? '?'} paths; config file ${uv4.configFile})`)
    say(`    fix     : dsh-keil set-uv4 --path "<UV4.exe|UV4 dir|Keil root>"`)
    say(`              or set ${(uv4.envKeys ?? ['DSH_KEIL_UV4']).join(' / ')}`)
  }
  say('')
  say('  profile state (read-only):')
  say(`    package.json   : ${isFile(state.packageJsonFile) ? state.packageJsonFile : 'missing'}`)
  say(`    dependency     : ${state.dependency ?? '(none)'}`)
  say(`    in bundles     : ${state.bundles.includes(PKG_NAME) ? 'yes' : 'NO'}`)
  say(`    installed      : ${state.installedVersion ?? '(not installed)'}`)
  say(`    CLI shim       : ${state.bin ?? '(missing)'}`)
  say(`    sidebar dep    : ${state.sidebarDependency ?? '(none)'}`)
  say('')
  if (profile.name === 'desktop' && carrier.length > 0) {
    say('  note: the desktop profile is owned by the running app and `dsh plugin` takes a')
    say('        profile lock; if pnpm reports it is in use, quit the app, install, relaunch.')
  }
  say('  --check wrote nothing. Run `node scripts/install.mjs` to install.')
  return check
}

function printPlan({ profile, home, repo, cli, spec, state, steps, ui, uv4 }) {
  say(`dsh-keil installer dry-run  (node ${process.version} on ${process.platform})`)
  say(`  repo        : ${repo.dir}  (${PKG_NAME} ${repo.version})`)
  say(`  DSH home    : ${home}`)
  say(`  profile     : ${profile.name}  (${profile.source}) -> ${profile.dir}`)
  say(`  spec        : ${spec}`)
  say(`  dsh CLI     : ${cli.path}  (${cli.kind})`)
  if (profile.note !== undefined) warn(profile.note)
  say('')
  say('commands that would run (in order):')
  steps.forEach((step, index) => {
    say(`  ${index + 1}. ${formatCommand(executorFor(cli.path, step.argv))}`)
  })
  if (steps.length === 1 && ui.status === 'skipped') say(`  (no sidebar command: ${ui.reason})`)
  say('')
  say('  then verify with:')
  const binName = IS_WINDOWS ? `${PKG_NAME}.cmd` : PKG_NAME
  const bin = state.bin ?? path.join(profile.dir, 'node_modules', '.bin', binName)
  say(`     ${formatCommand(executorFor(bin, ['status', '--cwd', repo.dir, '--compact']))}`)
  say('')
  if (uv4?.known === true) {
    say(`  UV4 / Keil: ${uv4.found ? `found ${uv4.path}` : 'NOT found (configure it after installing: dsh-keil set-uv4 --path ...)'}`)
  }
  say(`  current profile state: dependency=${state.dependency ?? '(none)'} bundles=${state.bundles.includes(PKG_NAME) ? 'yes' : 'NO'} installed=${state.installedVersion ?? '(none)'}`)
  if (ui.status === 'skipped') say(`  sidebar: skipped (${ui.reason})`)
  say('')
  say('dry-run only: nothing was written and no pnpm/CLI command ran.')
  return {
    ok: true,
    action: 'dry-run',
    dshHome: home,
    profile: { name: profile.name, dir: profile.dir, source: profile.source },
    repo: { dir: repo.dir, version: repo.version },
    spec,
    cli: { path: cli.path, kind: cli.kind },
    commands: steps.map((step) => formatCommand(executorFor(cli.path, step.argv))),
    sidebar: ui.status === 'skipped' ? { status: 'skipped', reason: ui.reason } : { status: 'would-install', spec: SIDEBAR_SPEC },
    uv4,
  }
}

function uv4FixLines({ found, envKeys } = {}) {
  if (found === true) return []
  const keys = Array.isArray(envKeys) && envKeys.length > 0 ? envKeys : ['DSH_KEIL_UV4']
  return [
    'Keil UV4.exe was not found; the plugin is installed but builds/downloads fail until it is configured:',
    '  dsh-keil set-uv4 --path "C:\\Keil_v5\\UV4\\UV4.exe"    # UV4.exe, its UV4 dir, or the Keil root',
    `  or set ${keys[0]} to that path (${keys.slice(1).join(', ') || 'DSH_KEIL_UV4'} also accepted)`,
  ]
}

/* ------------------------------------------------------------------ *
 * Verify the installed plugin through its own CLI
 * ------------------------------------------------------------------ */

function verifyInstall({ profileDir, repoDir }) {
  const state = readProfileState(profileDir)
  const binName = IS_WINDOWS ? `${PKG_NAME}.cmd` : PKG_NAME
  const bin = state.bin ?? path.join(profileDir, 'node_modules', '.bin', binName)
  const argv = ['status', '--cwd', repoDir, '--compact']
  const command = formatCommand(executorFor(bin, argv))
  if (!isFile(bin) && !isLinkOrFile(bin)) {
    return { ok: false, command, reason: `installed CLI shim not found: ${bin}`, payload: undefined }
  }
  const result = run(executorFor(bin, argv), { capture: true, timeout: 120_000 })
  const raw = result.stdout.trim()
  let payload
  try {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    payload = start === -1 || end === -1 ? undefined : JSON.parse(raw.slice(start, end + 1))
  } catch { payload = undefined }
  return {
    ok: result.status === 0 && payload?.ok === true,
    command,
    exitCode: result.status,
    reason: result.status === 0 ? undefined : (tail(result.stderr, 3).join(' | ') || `exit ${result.status}`),
    raw: raw === '' ? undefined : raw,
    payload,
  }
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

async function main() {
  const { options, problems } = parseArgv(process.argv.slice(2))
  io.json = options.json === true
  if (options.help === true) {
    process.stdout.write(USAGE)
    return 0
  }
  if (problems.length > 0) {
    process.stderr.write(`${problems.map((problem) => `error: ${problem}`).join('\n')}\n\n${USAGE}`)
    return 2
  }

  const major = Number(process.versions.node.split('.')[0])
  if (major < MIN_NODE_MAJOR) {
    process.stderr.write(`error: Node >= ${MIN_NODE_MAJOR} is required, running ${process.version}\n`)
    return 1
  }

  const home = resolveHome(options.home)
  const profile = resolveProfile(options.profile, home)
  const repo = resolveRepo(options.repo)
  const cli = resolveCli(profile, { tolerant: options.check === true })
  const spec = toFileSpec(repo.dir)

  if (options.check === true) {
    const report = await printCheck({ profile, home, repo, cli, spec })
    if (io.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return 0
  }

  const uv4 = options.dryRun === true ? await detectUv4(repo.dir) : undefined
  if (options.dryRun === true) {
    const { state, steps, ui } = planSteps({ profile, profileDir: profile.dir, repo, options })
    const report = printPlan({ profile, home, repo, cli, spec, state, steps, ui, uv4 })
    if (io.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return 0
  }

  /* ---- real install ---- */
  const summary = {
    ok: false,
    action: 'install',
    dshHome: home,
    profile: { name: profile.name, dir: profile.dir, source: profile.source },
    repo: { dir: repo.dir, version: repo.version },
    spec,
    cli: { path: cli.path, kind: cli.kind },
    commands: [],
    install: { bundleRegistered: undefined, installedVersion: undefined, bin: undefined },
    sidebar: { status: 'pending' },
    verify: undefined,
    uv4: undefined,
    next: [],
    error: undefined,
  }
  const capture = options.json === true
  printHeader({ profile, home, repo, cli, spec })

  const before = readProfileState(profile.dir)
  if (profile.name === 'desktop' && before.packageJson === undefined) {
    throw new CliError('the desktop profile is not initialized (no profile package.json)', [
      'launch DeepSeek Harness Desktop once, quit it completely, then run this script again',
      'or install into another profile: node scripts/install.mjs --profile web',
    ])
  }
  const { steps, ui } = planSteps({ profile, profileDir: profile.dir, repo, options })
  summary.sidebar = ui.status === 'skipped' ? { status: 'skipped', reason: ui.reason } : { status: 'pending' }

  const total = steps.length + 1
  let index = 0
  for (const step of steps) {
    index += 1
    const command = formatCommand(executorFor(cli.path, step.argv))
    say('')
    say(`[${index}/${total}] ${step.label}`)
    say(`      ${command}`)
    const result = run(executorFor(cli.path, step.argv), { capture, timeout: 30 * 60 * 1000 })
    summary.commands.push({ step: step.label, command, exitCode: result.status })
    if (result.status !== 0) {
      const failure = result.status === null
        ? `did not run${result.error === undefined ? '' : ` (${result.error})`}`
        : `exit code ${result.status}`
      if (step.critical) {
        say('')
        say(`FAILED: ${failure}`)
        for (const line of tail(result.stderr, 8)) say(`  ${line}`)
        for (const line of recoveryHints(profile, repo, cli)) say(`  ${line}`)
        summary.error = {
          message: `plugin install command failed: ${failure}`,
          stderrTail: tail(result.stderr, 8),
        }
        printSummary(summary)
        return 1
      }
      warn(`optional step failed (${failure}); ${PKG_NAME} still works without the sidebar`)
      for (const line of tail(result.stderr, 4)) warn(line)
      summary.sidebar = { status: 'failed', spec: SIDEBAR_SPEC, exitCode: result.status }
    } else if (step.critical !== true) {
      summary.sidebar = { status: 'installed', spec: SIDEBAR_SPEC }
    }
  }

  /* ---- post-install verification (reads only) ---- */
  index += 1
  say('')
  say(`[${index}/${total}] verify the installed plugin`)
  const after = readProfileState(profile.dir)
  summary.install = {
    dependency: after.dependency ?? null,
    bundleRegistered: after.bundles.includes(PKG_NAME),
    installedVersion: after.installedVersion ?? null,
    bin: after.bin ?? null,
  }
  say(`      profile dependency : ${after.dependency ?? '(none)'}`)
  say(`      in dsh.profile.bundles : ${after.bundles.includes(PKG_NAME) ? 'yes' : 'NO'}`)
  say(`      installed version  : ${after.installedVersion ?? '(none)'}`)
  say(`      CLI shim           : ${after.bin ?? '(missing)'}`)

  let failed = false
  if (after.bundles.includes(PKG_NAME) !== true) {
    failed = true
    warn(`the CLI did not register ${PKG_NAME} in ${path.join(profile.dir, 'package.json')} -> dsh.profile.bundles`)
    warn('the package is on disk but DSH will not load it as a bundle')
    for (const line of [
      `retry with: ${formatCommand(executorFor(cli.path, ['plugin', '--profile', profile.name, 'add', spec]))}`,
      `or open the app GUI: Settings -> Plugins -> install bundle from absolute local directory, and pick ${repo.dir}`,
      'never hand-edit dsh.profile.bundles in the profile package.json: registration is the CLI\'s job',
    ]) warn(line)
  }

  const verified = verifyInstall({ profileDir: profile.dir, repoDir: repo.dir })
  if (verified.raw !== undefined) {
    say('      status:')
    say(`      ${verified.raw}`)
  }
  if (!verified.ok) warn(`status check failed: ${verified.reason ?? 'unknown reason'}`)
  summary.verify = {
    ok: verified.ok,
    command: verified.command,
    exitCode: verified.exitCode ?? null,
    uv4: verified.payload?.data?.uv4 ?? null,
    reason: verified.reason,
  }
  summary.uv4 = verified.payload?.data?.uv4 ?? (await detectUv4(repo.dir))

  const uv4Found = verified.payload?.data?.uv4?.found === true || summary.uv4?.found === true
  if (!uv4Found) {
    for (const line of uv4FixLines({ found: false, envKeys: summary.uv4?.envKeys })) say(`      ${line}`)
    if (process.platform !== 'win32') {
      say('      note: Keil MDK/uVision is Windows-only; the plugin loads here but builds/downloads need Windows + UV4.exe')
    }
  }

  summary.next = [
    `restart DSH (quit and relaunch the app for the desktop profile) so the bundle loads`,
    `then ask the model to use the keil tool, or run: ${verified.command}`,
    uv4Found
      ? 'UV4 is configured; a project must still be picked by the user in the Keil panel (never auto-selected)'
      : 'configure UV4 (see the commands above), then run `dsh-keil doctor`',
    summary.sidebar.status === 'skipped'
      ? 'the optional sidebar tab is absent; the keil tool and CLI still work'
      : 'the Keil tab appears in the sidebar when dsh-better-sidebar is mounted; otherwise the tool still works',
  ]
  summary.ok = failed !== true
  printSummary(summary)
  return summary.ok ? 0 : 1
}

function recoveryHints(profile, repo, cli) {
  return [
    'recovery hints:',
    `  - the repo path must exist and be absolute: ${repo.dir}`,
    `  - the profile must exist: ${profile.dir}`,
    profile.name === 'desktop'
      ? '  - the desktop profile is only manageable by the app carrier CLI; check the path above'
      : '  - the ordinary dsh CLI needs pnpm on PATH (it prints exit code 127 when pnpm is missing)',
    `  - DSH_CLI can point the script at the right CLI: set DSH_CLI=${cli.path}`,
    '  - GUI fallback: Settings -> Plugins -> install bundle from absolute local directory',
  ]
}

function printSummary(summary) {
  if (io.json === true) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
    return
  }
  say('')
  say('---- summary ----')
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  if (summary.ok === true && summary.action === 'install') {
    say('')
    say('installed. Next steps:')
    for (const line of summary.next ?? []) say(`  - ${line}`)
  }
}

main().then((code) => {
  process.exitCode = code
}).catch((error) => {
  const isCliError = error instanceof CliError
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
  for (const line of isCliError ? error.nextSteps ?? [] : []) process.stderr.write(`  ${line}\n`)
  if (!isCliError && error instanceof Error && error.stack !== undefined) {
    process.stderr.write(`${error.stack}\n`)
  }
  process.exitCode = 1
})
