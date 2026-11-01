/**
 * dsh-keil Host half.
 *
 * - Registers the model-facing `keil` tool.
 * - Serves the Keil panel's same-origin JSON API at POST /keil/api.
 *
 * The user selects the .uvprojx in the panel; neither the tool nor the API
 * guesses a project from a scan.
 */
import {
  KeilError,
  VERSION,
  buildManager,
  describeUv4,
  invokeAction,
} from './core.mjs'

export const name = 'dsh-keil'
/**
 * `tools` is required: without it this bundle has nothing to contribute.
 * `webServer` is optional: a headless/TUI profile still gets the model tool and
 * the CLI, it simply has no panel route. The panel's dependency on
 * dsh-better-sidebar lives entirely in the Client half, which registers its tab
 * only when that service is mounted.
 */
export const inject = ['tools']

const ACTIONS = [
  'status',
  'doctor',
  'candidates',
  'tree',
  'files',
  'build',
  'rebuild',
  'clean',
  'download',
  'build_start',
  'build_status',
  'build_stop',
  'add_file',
  'remove_file',
  'add_include',
  'remove_include',
  'create_group',
  'delete_group',
]

const TOOL_DESCRIPTION = `Keil MDK/uVision project operations: incremental build, rebuild, clean, flash download, project tree and include-path management.

Important: the .uvprojx must be chosen by the USER in the DSH Keil panel; this tool never scans and auto-picks.
- If an action returns NO_PROJECT_SELECTED, ask the user to pick the project in the Keil panel, or use the project parameter after the user gives an explicit path.
- Edit actions only change the uvprojx registration; files on disk are never deleted. Every edit is backed up to the DSH state directory first.
- Builds block until UV4 exits (15 min cap) and return the exit code, summary, log tail and the generated hex path.
- Common flow: status -> build/rebuild -> download; tree lists groups/files; add_file/remove_file and add_include/remove_include maintain the registration.
- When UV4 cannot be found (UV4_NOT_FOUND), run action=doctor to see every path that was tried, then have the user set DSH_KEIL_UV4 or run dsh-keil set-uv4 --path <UV4.exe|UV4 dir|Keil root>.`

function cwdOf(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd()
}

function createTool() {
  return {
    name: 'keil',
    description: TOOL_DESCRIPTION,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ACTIONS,
          description: 'Operation. status/doctor/candidates/tree/files are read-only; build/rebuild/clean/download invoke UV4; add_*/remove_*/create_group/delete_group edit the project registration.',
        },
        project: {
          type: 'string',
          description: 'Optional explicit .uvprojx path (absolute, or relative to cwd). Pass it only when the user explicitly named that project; omit to use the selection the user made in the Keil panel.',
        },
        group: {
          type: 'string',
          description: 'Project group name (add_file/remove_file/create_group/delete_group).',
        },
        file: {
          type: 'string',
          description: 'File path (add_file) or file name (remove_file); absolute or relative to the project directory.',
        },
        path: {
          type: 'string',
          description: 'Header include search path (add_include/remove_include); absolute or relative to the uvprojx directory.',
        },
        name: {
          type: 'string',
          description: 'Group name (create_group/delete_group).',
        },
        query: {
          type: 'string',
          description: 'Filter text for the files action.',
        },
        mode: {
          type: 'string',
          enum: ['build', 'rebuild', 'clean', 'download'],
          description: 'Build mode for build_start.',
        },
        allowMissing: {
          type: 'boolean',
          description: 'Allow registering a file/directory that does not exist on disk yet (default false).',
        },
        allowMultiple: {
          type: 'boolean',
          description: 'remove_file: remove the first of several same-named registrations instead of failing (default false).',
        },
      },
      required: ['action'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
      },
      render(_args, value) {
        return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
      },
    },
    async execute(args, exec) {
      const cwd = cwdOf(exec)
      const payload = {
        ...args,
        cwd,
        includePath: typeof args.path === 'string' ? args.path : undefined,
      }
      return invokeAction(args.action, payload).then((value) => JSON.parse(JSON.stringify(value)))
    },
  }
}

function writeJson(res, status, body) {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader?.('content-type', 'application/json; charset=utf-8')
  res.setHeader?.('cache-control', 'no-store')
  res.end(text)
}

async function readJsonBody(req, limit = 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    size += buffer.length
    if (size > limit) throw new KeilError('BODY_TOO_LARGE', '请求体超过 1 MiB')
    chunks.push(buffer)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new KeilError('BAD_JSON', '请求体不是合法 JSON')
  }
}

function routeHandler(ctx) {
  return async (req, res) => {
    const connection = ctx.get('connection')
    const rejected = connection?.requestRejection?.(req)
    if (rejected !== undefined) {
      writeJson(res, rejected, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
      return
    }
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    if (url.pathname === '/keil/api' && req.method === 'GET') {
      writeJson(res, 200, {
        ok: true,
        data: {
          version: VERSION,
          build: buildManager.current() ?? null,
          uv4: describeUv4(),
        },
      })
      return
    }
    if (url.pathname !== '/keil/api') {
      writeJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'unknown keil route' } })
      return
    }
    if (req.method !== 'POST') {
      writeJson(res, 405, { ok: false, error: { code: 'METHOD', message: 'POST required' } })
      return
    }
    try {
      const body = await readJsonBody(req)
      const action = typeof body.action === 'string' ? body.action : ''
      if (action === '') throw new KeilError('BAD_ARGUMENT', '缺少 action')
      const data = await invokeAction(action, {
        ...body,
        cwd: typeof body.cwd === 'string' && body.cwd !== '' ? body.cwd : process.cwd(),
      })
      writeJson(res, 200, { ok: true, data })
    } catch (error) {
      const isKeil = error instanceof KeilError
      writeJson(res, 200, {
        ok: false,
        error: {
          code: isKeil ? error.code : 'INTERNAL',
          message: error instanceof Error ? error.message : String(error),
          ...(isKeil && error.details !== undefined ? { details: error.details } : {}),
        },
      })
    }
  }
}

export function apply(ctx, _config) {
  ctx.effect(() => ctx.tools.register(createTool()), 'dsh-keil: keil tool')
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: '/keil',
      handler: routeHandler(ctx),
    }), 'dsh-keil: /keil routes')
  })
}
