#!/usr/bin/env node
/**
 * dsh-keil model-facing CLI.
 *
 * Every command prints one JSON object to stdout and exits:
 *   0  ok
 *   1  operation failed (KeilError or unexpected error)
 *   2  usage error
 *
 * The project is NEVER discovered or chosen by this CLI. It uses either the
 * user's stored selection for --cwd (made in the DSH Keil panel) or an explicit
 * --project path the user supplied.
 */
import process from 'node:process'
import {
  KeilError,
  VERSION,
  invokeAction,
  findProjectCandidates,
  getRuntimeStatus,
  getSelection,
  buildManager,
  setUv4Path,
  readConfig,
  configFilePath,
  CONFIG_FILE,
  UV4_ENV_KEYS,
} from '../lib/core.mjs'

const HELP = `dsh-keil ${VERSION} - Keil uVision project CLI

Usage:
  dsh-keil <command> [options]

Commands:
  status                      Show user selection, project summary, UV4, build state
  doctor                      Diagnose the environment: UV4 discovery, config paths
  set-uv4 --path <p>          Remember this machine's UV4.exe / UV4 dir / Keil root
  candidates                  List .uvprojx files under --cwd (never auto-selected)
  select --project <file>     Store the USER's project choice for --cwd
  clear-selection            Remove the stored choice for --cwd
  tree                        Show groups, files and include paths
  files [--query <text>]      Search source files under --cwd
  build | rebuild | clean     Run UV4 and wait; prints exit code and log tail
  download                    Flash download through UV4 -f
  build-start --mode <mode>   Start a build and return immediately
  build-status                Poll the current build
  build-stop                  Stop the current build
  add-file --group <g> --file <path> [--allow-missing]
  remove-file --group <g> --file <name> [--allow-multiple]
  add-include --path <dir> [--allow-missing]
  remove-include --path <dir>
  create-group --name <g>
  delete-group --name <g>
  show-config                 Print the config file content and the UV4 env vars

Global options:
  --cwd <dir>        Workspace directory (default: current directory)
  --project <file>   Explicit .uvprojx (overrides the stored USER selection)
  --allow-missing    Register a file/include path that does not exist on disk yet
  --allow-multiple   remove-file: remove the first same-named registration
  --json             Accepted for compatibility; output is always JSON
  --compact          One-line JSON
  --help             Show this help

Machine configuration:
  UV4.exe is looked up in this order:
    1. environment: ${UV4_ENV_KEYS.join(' / ')}
    2. config file: ${CONFIG_FILE}   {"uv4": "C:\\Keil_v5\\UV4\\UV4.exe"}
    3. Windows registry (Keil\\Products\\MDK), then common install folders, then PATH
  Run 'dsh-keil doctor' to see every attempted path, or 'dsh-keil set-uv4 --path ...'.

Exit codes: 0 ok, 1 operation failed, 2 usage error.
`

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--') { positional.push(...argv.slice(i + 1)); break }
    if (token === '--help' || token === '-h') { flags.help = true; continue }
    if (token === '--json') { flags.json = true; continue }
    if (token === '--compact') { flags.compact = true; continue }
    if (token === '--allow-missing') { flags.allowMissing = true; continue }
    if (token === '--allow-multiple') { flags.allowMultiple = true; continue }
    if (token.startsWith('--')) {
      const eq = token.indexOf('=')
      if (eq > 0) {
        flags[token.slice(2, eq)] = token.slice(eq + 1)
        continue
      }
      const key = token.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true
      } else {
        flags[key] = next
        i += 1
      }
      continue
    }
    positional.push(token)
  }
  return { positional, flags }
}

function output(value, compact) {
  process.stdout.write(`${JSON.stringify(value, null, compact ? 0 : 2)}\n`)
}

function fail(error, code) {
  const payload = error instanceof KeilError
    ? { ok: false, error: { code: error.code, message: error.message, details: error.details } }
    : { ok: false, error: { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) } }
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
  process.exitCode = code
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2))
  if (flags.help === true || positional.length === 0) {
    process.stdout.write(HELP)
    if (positional.length === 0 && flags.help !== true) process.exitCode = 2
    return
  }
  const command = positional[0]
  const cwd = typeof flags.cwd === 'string' ? flags.cwd : process.cwd()
  const project = typeof flags.project === 'string' ? flags.project : undefined
  const base = { cwd, project }

  switch (command) {
    case 'status':
      output({ ok: true, data: getRuntimeStatus({ cwd, project, includeCandidates: true }) }, flags.compact)
      return
    case 'doctor':
      output({ ok: true, data: await invokeAction('doctor', { cwd }) }, flags.compact)
      return
    case 'set-uv4': {
      const input = typeof flags.path === 'string' ? flags.path : flags.uv4
      if (typeof input !== 'string') {
        throw new KeilError('BAD_ARGUMENT', 'set-uv4 需要 --path <UV4.exe|UV4 目录|Keil 根目录>')
      }
      output({ ok: true, data: setUv4Path(input) }, flags.compact)
      return
    }
    case 'show-config':
      output({ ok: true, data: { configFile: configFilePath(), config: readConfig().raw, env: UV4_ENV_KEYS.map((key) => ({ key, value: process.env[key] ?? null })) } }, flags.compact)
      return
    case 'candidates':
      output({ ok: true, data: findProjectCandidates(cwd) }, flags.compact)
      return
    case 'select': {
      if (project === undefined) throw new KeilError('BAD_ARGUMENT', 'select 需要 --project <uvprojx>')
      const data = await invokeAction('select', { cwd, project, source: 'cli' })
      output({ ok: true, data }, flags.compact)
      return
    }
    case 'clear-selection':
      output({ ok: true, data: await invokeAction('clear_selection', { cwd }) }, flags.compact)
      return
    case 'tree':
      output({ ok: true, data: await invokeAction('tree', base) }, flags.compact)
      return
    case 'files': {
      const data = await invokeAction('files', { cwd, query: typeof flags.query === 'string' ? flags.query : '' })
      output({ ok: true, data }, flags.compact)
      return
    }
    case 'build':
    case 'rebuild':
    case 'clean':
    case 'download': {
      const data = await invokeAction(command, base)
      output({ ok: data.status === 'success', data }, flags.compact)
      if (data.status !== 'success') process.exitCode = 1
      return
    }
    case 'build-start': {
      const mode = typeof flags.mode === 'string' ? flags.mode : 'build'
      const data = await invokeAction('build_start', { ...base, mode })
      output({ ok: true, data }, flags.compact)
      return
    }
    case 'build-status': {
      const data = buildManager.current() ?? { status: 'idle' }
      output({ ok: true, data }, flags.compact)
      return
    }
    case 'build-stop':
      output({ ok: true, data: await invokeAction('build_stop', base) }, flags.compact)
      return
    case 'add-file': {
      if (typeof flags.group !== 'string' || typeof flags.file !== 'string') {
        throw new KeilError('BAD_ARGUMENT', 'add-file 需要 --group <组> --file <文件>')
      }
      const data = await invokeAction('add_file', {
        ...base, group: flags.group, file: flags.file, allowMissing: flags.allowMissing === true,
      })
      output({ ok: true, data }, flags.compact)
      return
    }
    case 'remove-file': {
      if (typeof flags.group !== 'string' || typeof flags.file !== 'string') {
        throw new KeilError('BAD_ARGUMENT', 'remove-file 需要 --group <组> --file <文件名>')
      }
      const data = await invokeAction('remove_file', {
        ...base, group: flags.group, file: flags.file, allowMultiple: flags.allowMultiple === true,
      })
      output({ ok: true, data }, flags.compact)
      return
    }
    case 'add-include': {
      const includePath = typeof flags.path === 'string' ? flags.path : flags.include
      if (typeof includePath !== 'string') {
        throw new KeilError('BAD_ARGUMENT', 'add-include 需要 --path <目录>')
      }
      const data = await invokeAction('add_include', {
        ...base, includePath, allowMissing: flags.allowMissing === true,
      })
      output({ ok: true, data }, flags.compact)
      return
    }
    case 'remove-include': {
      const includePath = typeof flags.path === 'string' ? flags.path : flags.include
      if (typeof includePath !== 'string') {
        throw new KeilError('BAD_ARGUMENT', 'remove-include 需要 --path <目录>')
      }
      const data = await invokeAction('remove_include', { ...base, includePath })
      output({ ok: true, data }, flags.compact)
      return
    }
    case 'create-group': {
      if (typeof flags.name !== 'string') throw new KeilError('BAD_ARGUMENT', 'create-group 需要 --name <组名>')
      const data = await invokeAction('create_group', { ...base, name: flags.name })
      output({ ok: true, data }, flags.compact)
      return
    }
    case 'delete-group': {
      if (typeof flags.name !== 'string') throw new KeilError('BAD_ARGUMENT', 'delete-group 需要 --name <组名>')
      const data = await invokeAction('delete_group', { ...base, name: flags.name })
      output({ ok: true, data }, flags.compact)
      return
    }
    default:
      throw new KeilError('UNKNOWN_COMMAND', `未知命令：${command}。运行 dsh-keil --help 查看用法。`)
  }
}

try {
  await main()
} catch (error) {
  fail(error, error instanceof KeilError && error.code === 'BAD_ARGUMENT' ? 2 : 1)
}

// Expose selection helpers for debugging without changing command output.
void getSelection
