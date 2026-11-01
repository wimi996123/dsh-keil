/**
 * dsh-keil core: uvprojx discovery, registration edits, Keil builds and state.
 *
 * Host plugin, model CLI and tests all use this module. Nothing here imports a
 * DSH package, so it also runs from a plain `node` process.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'

function readOwnVersion() {
  try {
    return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export const VERSION = readOwnVersion()
export const PROJECT_EXT = '.uvprojx'
export const DEFAULT_STATE_FILE = path.join(os.homedir(), '.dsh', 'keil', 'state.json')
export const STATE_FILE = process.env.DSH_KEIL_STATE || DEFAULT_STATE_FILE
export const KEIL_HOME = path.dirname(STATE_FILE)
/**
 * Machine-level settings, kept beside the state file so every profile and every
 * CLI call on this machine reads the same UV4 location. `DSH_KEIL_CONFIG`
 * relocates the file (containers, CI, per-machine test runs).
 */
export const DEFAULT_CONFIG_FILE = path.join(KEIL_HOME, 'config.json')
/** The config file in effect right now: `DSH_KEIL_CONFIG` is read per call. */
export function configFilePath() {
  return process.env.DSH_KEIL_CONFIG || DEFAULT_CONFIG_FILE
}
/** The config file as resolved at module load; convenient for help text. */
export const CONFIG_FILE = configFilePath()
/** Environment variables checked before the config file, in this order. */
export const UV4_ENV_KEYS = ['DSH_KEIL_UV4', 'KEIL_UV4']
export const BUILD_TIMEOUT_MS = 15 * 60 * 1000
export const MAX_LOG_CHARS = 240 * 1024

const SKIP_DIRS = new Set([
  '.git', '.hg', '.svn', '.cache', '__pycache__', 'node_modules', '.venv', 'venv',
  '.idea', '.vscode', 'dist', 'obj', 'objects', '.vs',
])
const SOURCE_EXTS = new Set(['.c', '.h', '.cpp', '.hpp', '.cc', '.hh', '.cxx', '.s', '.asm', '.inc', '.lib', '.a'])

export class KeilError extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'KeilError'
    this.code = code
    this.details = details
  }
}

export function toPosix(value) {
  return String(value).replace(/\\/g, '/')
}

export function normalizeKey(value) {
  return path.resolve(value).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file))
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8')
  fs.renameSync(temp, file)
}

/* ------------------------------------------------------------------ *
 * Per-workspace user selection
 * ------------------------------------------------------------------ */

export function readState() {
  const state = readJson(STATE_FILE, null)
  if (state === null || typeof state !== 'object' || typeof state.workspaces !== 'object' || state.workspaces === null) {
    return { version: 1, workspaces: {} }
  }
  return state
}

/** The selection the USER made for this workspace. Never guessed from a scan. */
export function getSelection(cwd) {
  const state = readState()
  const entry = state.workspaces[normalizeKey(cwd)]
  if (entry === undefined || entry === null) return undefined
  if (typeof entry === 'string') return { project: entry, updatedAt: 0 }
  if (typeof entry.project !== 'string') return undefined
  return { project: entry.project, updatedAt: Number(entry.updatedAt) || 0 }
}

export function setSelection(cwd, projectPath, source = 'ui') {
  const abs = path.resolve(cwd, projectPath)
  assertProjectFile(abs)
  const state = readState()
  state.version = 1
  state.workspaces[normalizeKey(cwd)] = {
    project: abs,
    updatedAt: Date.now(),
    source,
  }
  writeJsonAtomic(STATE_FILE, state)
  return { project: abs }
}

export function clearSelection(cwd) {
  const state = readState()
  delete state.workspaces[normalizeKey(cwd)]
  writeJsonAtomic(STATE_FILE, state)
}

function assertProjectFile(projectPath) {
  const ext = path.extname(projectPath).toLowerCase()
  if (ext !== PROJECT_EXT) {
    throw new KeilError('BAD_PROJECT', `不是 Keil 工程文件（需要 ${PROJECT_EXT}）：${projectPath}`)
  }
  let stat
  try {
    stat = fs.statSync(projectPath)
  } catch {
    throw new KeilError('PROJECT_MISSING', `工程文件不存在：${projectPath}`)
  }
  if (!stat.isFile()) throw new KeilError('PROJECT_MISSING', `不是文件：${projectPath}`)
}

/**
 * Resolve the project for one operation.
 * `explicit` is only accepted when the caller (user/CLI) passed it. Without it
 * the stored USER selection is required; this function never scans and picks.
 */
export function resolveProjectPath(cwd, explicit) {
  if (typeof explicit === 'string' && explicit.trim() !== '') {
    const abs = path.isAbsolute(explicit) ? path.normalize(explicit) : path.resolve(cwd, explicit)
    assertProjectFile(abs)
    return { project: abs, source: 'explicit' }
  }
  const selection = getSelection(cwd)
  if (selection === undefined) {
    throw new KeilError(
      'NO_PROJECT_SELECTED',
      '当前工作区还没有由用户选择 Keil 工程。请在 DSH 的 Keil 面板里选择工程文件（插件不会自动选择）。',
      { cwd },
    )
  }
  assertProjectFile(selection.project)
  return { project: selection.project, source: 'user-selection' }
}

/* ------------------------------------------------------------------ *
 * Discovery (candidates only; never auto-selected)
 * ------------------------------------------------------------------ */

export function findProjectCandidates(root, options = {}) {
  const cwd = path.resolve(root)
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : 10
  const maxResults = Number.isInteger(options.maxResults) ? options.maxResults : 100
  const maxVisited = Number.isInteger(options.maxVisited) ? options.maxVisited : 30000
  const results = []
  const queue = [{ dir: cwd, depth: 0 }]
  let visited = 0
  let truncated = false
  while (queue.length > 0) {
    const { dir, depth } = queue.shift()
    if (visited >= maxVisited || results.length >= maxResults) { truncated = true; break }
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    visited += 1
    for (const entry of entries) {
      if (results.length >= maxResults) { truncated = true; break }
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth >= maxDepth) continue
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
        if (entry.name.startsWith('.') && entry.name !== '.') continue
        queue.push({ dir: abs, depth: depth + 1 })
        continue
      }
      if (!entry.isFile()) continue
      if (path.extname(entry.name).toLowerCase() !== PROJECT_EXT) continue
      let stat
      try { stat = fs.statSync(abs) } catch { continue }
      results.push({
        path: abs,
        relative: toPosix(path.relative(cwd, abs)),
        name: entry.name,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      })
    }
  }
  results.sort((a, b) => a.relative.localeCompare(b.relative, 'en'))
  return {
    root: cwd,
    candidates: results,
    truncated,
    visited,
  }
}

export function scanSourceFiles(root, query = '', options = {}) {
  const cwd = path.resolve(root)
  const needle = String(query ?? '').trim().toLowerCase()
  const maxResults = Number.isInteger(options.maxResults) ? options.maxResults : 150
  const maxVisited = Number.isInteger(options.maxVisited) ? options.maxVisited : 20000
  const results = []
  const queue = [{ dir: cwd, depth: 0 }]
  let visited = 0
  let truncated = false
  while (queue.length > 0) {
    const { dir, depth } = queue.shift()
    if (visited >= maxVisited || results.length >= maxResults) { truncated = true; break }
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    visited += 1
    for (const entry of entries) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth >= 10) continue
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
        if (entry.name.startsWith('.')) continue
        queue.push({ dir: abs, depth: depth + 1 })
        continue
      }
      if (!entry.isFile() || !SOURCE_EXTS.has(path.extname(entry.name).toLowerCase())) continue
      const relative = toPosix(path.relative(cwd, abs))
      if (needle !== '' && !relative.toLowerCase().includes(needle)) continue
      results.push({ path: abs, relative, name: entry.name })
      if (results.length >= maxResults) { truncated = true; break }
    }
  }
  results.sort((a, b) => a.relative.localeCompare(b.relative, 'en'))
  return { root: cwd, files: results, truncated }
}

/* ------------------------------------------------------------------ *
 * Minimal XML reader (span-preserving, no dependency)
 * ------------------------------------------------------------------ */

const XML_TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?([A-Za-z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^"'>])*?)(\/?)>/g

function parseXml(text) {
  const doc = { name: '#document', children: [], parent: null, start: 0, end: text.length, openEnd: 0, closeStart: text.length, selfClosing: false }
  const stack = [doc]
  XML_TOKEN.lastIndex = 0
  let match
  while ((match = XML_TOKEN.exec(text)) !== null) {
    const raw = match[0]
    if (raw.startsWith('<!--') || raw.startsWith('<![CDATA[') || raw.startsWith('<?')) continue
    const name = match[1]
    const selfClosing = match[3] === '/'
    const isClosing = raw.startsWith('</')
    if (isClosing) {
      const top = stack[stack.length - 1]
      if (top.name !== name) {
        throw new KeilError('BAD_PROJECT_XML', `XML 标签不匹配：期望 </${top.name}>，实际 </${name}>（偏移 ${match.index}）`)
      }
      top.closeStart = match.index
      top.end = XML_TOKEN.lastIndex
      stack.pop()
      continue
    }
    const node = {
      name,
      attrs: match[2] ?? '',
      children: [],
      parent: stack[stack.length - 1],
      start: match.index,
      openEnd: XML_TOKEN.lastIndex,
      closeStart: selfClosing ? XML_TOKEN.lastIndex : -1,
      end: XML_TOKEN.lastIndex,
      selfClosing,
    }
    node.parent.children.push(node)
    if (!selfClosing) stack.push(node)
  }
  if (stack.length !== 1) {
    throw new KeilError('BAD_PROJECT_XML', `XML 存在未闭合标签：<${stack[stack.length - 1].name}>`)
  }
  return doc
}

function xmlText(text, node) {
  if (node === undefined || node === null) return ''
  if (node.selfClosing) return ''
  const raw = text.slice(node.openEnd, node.closeStart < 0 ? node.end : node.closeStart)
  return raw.trim()
}

function unescapeXml(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function child(node, name) {
  if (node === undefined || node === null) return undefined
  return node.children.find((item) => item.name === name)
}

function children(node, name) {
  if (node === undefined || node === null) return []
  return node.children.filter((item) => item.name === name)
}

function findPath(node, names) {
  let current = node
  for (const name of names) {
    current = child(current, name)
    if (current === undefined) return undefined
  }
  return current
}

function lineIndentAt(text, position) {
  const lineStart = text.lastIndexOf('\n', Math.max(0, position - 1)) + 1
  const before = text.slice(lineStart, position)
  return /^[ \t]*$/.test(before) ? before : ''
}

function replaceNodeText(text, node, value) {
  const escaped = escapeXml(value)
  if (node.selfClosing) {
    return `${text.slice(0, node.start)}<${node.name}>${escaped}</${node.name}>${text.slice(node.end)}`
  }
  return `${text.slice(0, node.openEnd)}${escaped}${text.slice(node.closeStart)}`
}

function insertBeforeCloseTag(text, node, lines, eol) {
  const lineStart = text.lastIndexOf('\n', Math.max(0, node.closeStart - 1)) + 1
  const beforeOnLine = text.slice(lineStart, node.closeStart)
  if (/^[ \t]*$/.test(beforeOnLine)) {
    return `${text.slice(0, lineStart)}${lines.join(eol)}${eol}${beforeOnLine}${text.slice(node.closeStart)}`
  }
  return `${text.slice(0, node.closeStart)}${eol}${lines.join(eol)}${eol}${text.slice(node.closeStart)}`
}

function removeElement(text, node) {
  const lineStart = text.lastIndexOf('\n', Math.max(0, node.start - 1)) + 1
  const beforeOnLine = text.slice(lineStart, node.start)
  if (/^[ \t]*$/.test(beforeOnLine)) {
    let end = node.end
    if (text.startsWith('\r\n', end)) end += 2
    else if (text[end] === '\n') end += 1
    return text.slice(0, lineStart) + text.slice(end)
  }
  return text.slice(0, node.start) + text.slice(node.end)
}

function eolOf(text) {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

/* ------------------------------------------------------------------ *
 * Project model
 * ------------------------------------------------------------------ */

function fileTypeFor(name) {
  const ext = path.extname(name).toLowerCase()
  if (ext === '.c') return '1'
  if (ext === '.s' || ext === '.asm') return '2'
  if (ext === '.lib' || ext === '.a') return '4'
  if (ext === '.cpp' || ext === '.cc' || ext === '.cxx') return '8'
  // .h / .hpp / .inc / other files keep the header/default type, matching the
  // original Python tool's get_file_type().
  return '5'
}

function splitIncludes(value) {
  return String(value ?? '')
    .split(';')
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

function normalizePathKey(value) {
  return toPosix(String(value ?? '')).replace(/\/+$/, '').toLowerCase()
}

/**
 * Resolve a user-supplied path the same way the old Python tool did: a
 * relative path is first anchored at the caller's working directory, then at
 * the uvprojx directory. This keeps `dsh-keil add-file --file Core/Src/x.c`
 * working from the workspace root while the UI can still use project-relative
 * paths.
 */
function pathCandidates(modelDir, target, baseDir) {
  const raw = String(target ?? '').trim()
  if (raw === '') return []
  if (path.isAbsolute(raw)) return [path.normalize(raw)]
  const candidates = []
  if (typeof baseDir === 'string' && baseDir.trim() !== '') {
    candidates.push(path.resolve(baseDir, raw))
  }
  const fromProject = path.resolve(modelDir, raw)
  if (!candidates.some((item) => normalizePathKey(item) === normalizePathKey(fromProject))) {
    candidates.push(fromProject)
  }
  return candidates
}

function firstExistingFile(candidates) {
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch { /* next */ }
  }
  return undefined
}

function firstExistingDirectory(candidates) {
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate
    } catch { /* next */ }
  }
  return undefined
}

function readProjectInternal(projectPath) {
  assertProjectFile(projectPath)
  const text = fs.readFileSync(projectPath, 'utf8')
  const eol = eolOf(text)
  const doc = parseXml(text)
  const projectNode = doc.children.find((node) => node.name === 'Project')
  if (projectNode === undefined) throw new KeilError('BAD_PROJECT_XML', 'uvprojx 中没有 <Project> 根节点')
  const targetsNode = child(projectNode, 'Targets')
  const targetNodes = children(targetsNode, 'Target')
  const targetNode = targetNodes[0]
  const targetName = unescapeXml(xmlText(text, child(targetNode, 'TargetName')))
  const device = unescapeXml(xmlText(text, findPath(targetNode, ['TargetOption', 'TargetCommonOption', 'Device'])))
  const includeNode = findPath(targetNode, ['TargetOption', 'TargetArmAds', 'Cads', 'VariousControls', 'IncludePath'])
  // Keil stores the group tree under each Target, not under Project.
  const groupsNode = child(targetNode, 'Groups')
  const groups = []
  for (const groupNode of children(groupsNode, 'Group')) {
    const name = unescapeXml(xmlText(text, child(groupNode, 'GroupName')))
    const filesNode = child(groupNode, 'Files')
    const files = []
    for (const fileNode of children(filesNode, 'File')) {
      const name2 = unescapeXml(xmlText(text, child(fileNode, 'FileName')))
      const filePath = unescapeXml(xmlText(text, child(fileNode, 'FilePath')))
      const type = unescapeXml(xmlText(text, child(fileNode, 'FileType'))) || fileTypeFor(name2)
      const absPath = filePath === '' ? '' : path.resolve(path.dirname(projectPath), toPosix(filePath))
      let exists = false
      if (absPath !== '') {
        try { exists = fs.statSync(absPath).isFile() } catch { exists = false }
      }
      files.push({ name: name2, path: filePath, type, absPath, exists, node: fileNode })
    }
    groups.push({ name, files, node: groupNode, filesNode })
  }
  const includeRaw = includeNode === undefined ? '' : unescapeXml(xmlText(text, includeNode))
  const includes = splitIncludes(includeRaw)
  return {
    path: projectPath,
    dir: path.dirname(projectPath),
    name: path.basename(projectPath),
    base: path.basename(projectPath, path.extname(projectPath)),
    text,
    eol,
    doc,
    projectNode,
    targetsNode,
    targetNodes,
    targetNode,
    targetName: targetName || '(unnamed target)',
    device,
    includeNode,
    includeRaw,
    includes,
    groupsNode,
    groups,
  }
}

export function loadProjectView(projectPath) {
  const model = readProjectInternal(projectPath)
  let stat
  try { stat = fs.statSync(projectPath) } catch { stat = undefined }
  const fileCount = model.groups.reduce((sum, group) => sum + group.files.length, 0)
  const missing = model.groups.reduce((sum, group) => sum + group.files.filter((file) => !file.exists).length, 0)
  return {
    path: model.path,
    dir: model.dir,
    name: model.name,
    base: model.base,
    mtimeMs: stat?.mtimeMs ?? 0,
    target: { name: model.targetName, device: model.device },
    targets: model.targetNodes.map((node) => unescapeXml(xmlText(model.text, child(node, 'TargetName')))),
    counts: { groups: model.groups.length, files: fileCount, missing, includes: model.includes.length },
    groups: model.groups.map((group) => ({
      name: group.name,
      files: group.files.map((file) => ({
        name: file.name,
        path: file.path,
        type: file.type,
        absPath: file.absPath,
        exists: file.exists,
      })),
    })),
    includes: model.includes,
  }
}

function backupProject(projectPath) {
  const dir = path.join(KEIL_HOME, 'backups', path.basename(projectPath, path.extname(projectPath)))
  ensureDir(dir)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = path.join(dir, `${stamp}.uvprojx`)
  fs.copyFileSync(projectPath, target)
  const entries = fs.readdirSync(dir).filter((name) => name.endsWith('.uvprojx')).sort()
  while (entries.length > 50) {
    const oldest = entries.shift()
    try { fs.rmSync(path.join(dir, oldest), { force: true }) } catch { /* ignore */ }
  }
  return target
}

function writeProjectAtomic(projectPath, text) {
  const temp = `${projectPath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temp, text, 'utf8')
  fs.renameSync(temp, projectPath)
}

function requireGroup(model, groupName) {
  const group = model.groups.find((item) => item.name === groupName)
  if (group === undefined) throw new KeilError('GROUP_NOT_FOUND', `工程组不存在：${groupName}`)
  return group
}

export function createGroup(projectPath, groupName) {
  const name = String(groupName ?? '').trim()
  if (name === '') throw new KeilError('BAD_ARGUMENT', '组名不能为空')
  const model = readProjectInternal(projectPath)
  if (model.groups.some((group) => group.name === name)) {
    throw new KeilError('GROUP_EXISTS', `工程组已存在：${name}`)
  }
  if (model.groupsNode === undefined) throw new KeilError('BAD_PROJECT_XML', '工程中没有 <Groups> 节点')
  const closeIndent = lineIndentAt(model.text, model.groupsNode.closeStart)
  const groupIndent = model.groups.length > 0
    ? lineIndentAt(model.text, model.groups[0].node.start)
    : `${closeIndent}  `
  const fileIndent = `${groupIndent}  `
  const lines = [
    `${groupIndent}<Group>`,
    `${fileIndent}<GroupName>${escapeXml(name)}</GroupName>`,
    `${fileIndent}<Files></Files>`,
    `${groupIndent}</Group>`,
  ]
  const next = insertBeforeCloseTag(model.text, model.groupsNode, lines, model.eol)
  const backup = backupProject(projectPath)
  writeProjectAtomic(projectPath, next)
  return { project: projectPath, group: name, backup }
}

export function deleteGroup(projectPath, groupName) {
  const model = readProjectInternal(projectPath)
  const group = requireGroup(model, groupName)
  const backup = backupProject(projectPath)
  writeProjectAtomic(projectPath, removeElement(model.text, group.node))
  return { project: projectPath, group: groupName, backup }
}

export function addFile(projectPath, groupName, filePath, options = {}) {
  const model = readProjectInternal(projectPath)
  const group = requireGroup(model, groupName)
  const candidates = pathCandidates(model.dir, filePath, options.baseDir)
  if (candidates.length === 0) throw new KeilError('BAD_ARGUMENT', '文件路径不能为空')
  const existing = firstExistingFile(candidates)
  const abs = existing ?? candidates[0]
  if (existing === undefined && options.allowMissing !== true) {
    throw new KeilError('FILE_MISSING', `文件不存在：${candidates.join(' 或 ')}`)
  }
  const fileName = path.basename(abs)
  const relative = toPosix(path.relative(model.dir, abs)) || fileName
  if (group.files.some((file) => file.name.toLowerCase() === fileName.toLowerCase())) {
    throw new KeilError('FILE_EXISTS', `组 ${groupName} 已登记同名文件：${fileName}`)
  }
  if (group.files.some((file) => toPosix(file.path).toLowerCase() === relative.toLowerCase())) {
    throw new KeilError('FILE_EXISTS', `组 ${groupName} 已登记该路径：${relative}`)
  }
  const filesNode = group.filesNode
  if (filesNode === undefined) throw new KeilError('BAD_PROJECT_XML', `组 ${groupName} 中没有 <Files> 节点`)
  const closeIndent = lineIndentAt(model.text, filesNode.closeStart)
  const fileIndent = group.files.length > 0
    ? lineIndentAt(model.text, group.files[0].node.start)
    : `${closeIndent}  `
  const inner = `${fileIndent}  `
  const block = [
    `${fileIndent}<File>`,
    `${inner}<FileName>${escapeXml(fileName)}</FileName>`,
    `${inner}<FileType>${fileTypeFor(fileName)}</FileType>`,
    `${inner}<FilePath>${escapeXml(relative)}</FilePath>`,
    `${fileIndent}</File>`,
  ]
  let next
  if (filesNode.selfClosing) {
    const indent = lineIndentAt(model.text, filesNode.start)
    next = `${model.text.slice(0, filesNode.start)}<Files>${model.eol}${block.join(model.eol)}${model.eol}${indent}</Files>${model.text.slice(filesNode.end)}`
  } else {
    next = insertBeforeCloseTag(model.text, filesNode, block, model.eol)
  }
  const backup = backupProject(projectPath)
  writeProjectAtomic(projectPath, next)
  return { project: projectPath, group: groupName, file: { name: fileName, path: relative, absPath: abs }, backup }
}

export function removeFile(projectPath, groupName, fileName, options = {}) {
  const model = readProjectInternal(projectPath)
  const group = requireGroup(model, groupName)
  const wanted = path.basename(String(fileName ?? '').trim())
  const targets = group.files.filter((file) => file.name === wanted || toPosix(file.path) === toPosix(String(fileName)))
  if (targets.length === 0) throw new KeilError('FILE_NOT_FOUND', `组 ${groupName} 中没有登记文件：${fileName}`)
  if (targets.length > 1 && options.allowMultiple !== true) {
    throw new KeilError('FILE_AMBIGUOUS', `组 ${groupName} 中有多个同名登记：${fileName}`)
  }
  const target = targets[0]
  const backup = backupProject(projectPath)
  writeProjectAtomic(projectPath, removeElement(model.text, target.node))
  return { project: projectPath, group: groupName, removed: { name: target.name, path: target.path }, backup }
}

export function addIncludePath(projectPath, includePath, options = {}) {
  const model = readProjectInternal(projectPath)
  if (model.includeNode === undefined) throw new KeilError('BAD_PROJECT_XML', '工程中没有 IncludePath 配置')
  const candidates = pathCandidates(model.dir, includePath, options.baseDir)
  if (candidates.length === 0) throw new KeilError('BAD_ARGUMENT', '头文件路径不能为空')
  const existing = firstExistingDirectory(candidates)
  const abs = existing ?? candidates[0]
  if (existing === undefined && options.allowMissing !== true) {
    throw new KeilError('DIR_MISSING', `头文件目录不存在：${candidates.join(' 或 ')}`)
  }
  const relative = toPosix(path.relative(model.dir, abs))
  if (relative === '') throw new KeilError('BAD_ARGUMENT', '不能把头文件路径设置为工程文件所在目录本身')
  const normalized = normalizePathKey(relative)
  if (model.includes.some((item) => normalizePathKey(item) === normalized)) {
    throw new KeilError('INCLUDE_EXISTS', `头文件路径已存在：${relative}`)
  }
  const nextValue = model.includes.length === 0 ? relative : `${model.includes.join(';')};${relative}`
  const next = replaceNodeText(model.text, model.includeNode, nextValue)
  const backup = backupProject(projectPath)
  writeProjectAtomic(projectPath, next)
  return { project: projectPath, added: relative, includes: [...model.includes, relative], backup }
}

export function removeIncludePath(projectPath, includePath, options = {}) {
  const model = readProjectInternal(projectPath)
  if (model.includeNode === undefined) throw new KeilError('BAD_PROJECT_XML', '工程中没有 IncludePath 配置')
  const wantedRaw = String(includePath ?? '').trim()
  if (wantedRaw === '') throw new KeilError('BAD_ARGUMENT', '头文件路径不能为空')
  const wantedKeys = new Set([normalizePathKey(wantedRaw)])
  for (const candidate of pathCandidates(model.dir, wantedRaw, options.baseDir)) {
    wantedKeys.add(normalizePathKey(path.relative(model.dir, candidate)))
  }
  const index = model.includes.findIndex((item) => wantedKeys.has(normalizePathKey(item)))
  if (index < 0) throw new KeilError('INCLUDE_NOT_FOUND', `头文件路径不存在：${includePath}`)
  const remaining = model.includes.filter((_, i) => i !== index)
  const next = replaceNodeText(model.text, model.includeNode, remaining.join(';'))
  const backup = backupProject(projectPath)
  writeProjectAtomic(projectPath, next)
  return { project: projectPath, removed: model.includes[index], includes: remaining, backup }
}

/* ------------------------------------------------------------------ *
 * Machine configuration: where is Keil's UV4.exe on THIS machine?
 *
 * Resolution order (first hit wins):
 *   1. environment  DSH_KEIL_UV4 / KEIL_UV4
 *   2. config file  <KEIL_HOME>/config.json   ({"uv4": "C:\\Keil_v5\\UV4\\UV4.exe"})
 *   3. registry     HKLM/HKCU Keil\Products\MDK "Path" (Windows)
 *   4. common       %LOCALAPPDATA%, Program Files, C:..F:\Keil_v5
 *   5. PATH         `where UV4.exe`
 * An entry may name UV4.exe, its UV4 folder, or the Keil root folder
 * (C:\Keil_v5), so a human or an agent can paste whichever path they know.
 * ------------------------------------------------------------------ */

const CONFIG_VERSION = 1
const UV4_CACHE_MS = 2000
let uv4Cache = { at: 0, value: undefined }

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Drop the short-lived discovery cache (config/env changes, tests). */
export function resetUv4Cache() {
  uv4Cache = { at: 0, value: undefined }
}

/** Read `<KEIL_HOME>/config.json`; a missing or malformed file yields defaults. */
export function readConfig() {
  const file = configFilePath()
  const raw = readJson(file, null)
  const config = isRecord(raw) ? raw : {}
  const uv4 = typeof config.uv4 === 'string' && config.uv4.trim() !== ''
    ? config.uv4.trim()
    : typeof config.uv4Path === 'string' && config.uv4Path.trim() !== ''
      ? config.uv4Path.trim()
      : undefined
  return { version: Number(config.version) || CONFIG_VERSION, uv4, raw: config, file }
}

/** Merge `patch` into the machine config file and drop cached discovery. */
export function writeConfig(patch) {
  const file = configFilePath()
  const next = { ...readConfig().raw, ...patch, version: CONFIG_VERSION }
  writeJsonAtomic(file, next)
  resetUv4Cache()
  return next
}

function expandUserPath(input) {
  let value = String(input).trim().replace(/^"(.*)"$/, '$1')
  if (value === '~' || value.startsWith('~/') || value.startsWith('~\\')) {
    value = path.join(os.homedir(), value.slice(1))
  }
  return value.replace(/%([^%]+)%/g, (match, name) => process.env[name] ?? match)
}

/**
 * Turn a user-supplied path into the UV4.exe it names.
 * Accepts UV4.exe itself, the `UV4` folder, or the Keil root (`C:\Keil_v5`).
 */
export function resolveUv4Input(input) {
  if (typeof input !== 'string' || input.trim() === '') return undefined
  const abs = path.resolve(expandUserPath(input))
  let stat
  try { stat = fs.statSync(abs) } catch { return undefined }
  if (stat.isFile()) return abs
  if (!stat.isDirectory()) return undefined
  for (const candidate of [path.join(abs, 'UV4', 'UV4.exe'), path.join(abs, 'UV4.exe')]) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch { /* next */ }
  }
  return undefined
}

/** Persist the resolved UV4.exe into the machine config file. */
export function setUv4Path(input) {
  const resolved = resolveUv4Input(input)
  if (resolved === undefined) {
    throw new KeilError(
      'UV4_NOT_FOUND',
      `不是有效的 UV4 路径（需要 UV4.exe、其 UV4 目录或 Keil 安装根目录）：${input}`,
      { configFile: configFilePath() },
    )
  }
  writeConfig({ uv4: resolved })
  return { configFile: configFilePath(), uv4: resolved }
}

function registryUv4Candidates() {
  if (process.platform !== 'win32') return []
  const keys = [
    'HKLM\\SOFTWARE\\WOW6432Node\\Keil\\Products\\MDK',
    'HKLM\\SOFTWARE\\Keil\\Products\\MDK',
    'HKCU\\SOFTWARE\\Keil\\Products\\MDK',
  ]
  const candidates = []
  for (const key of keys) {
    let out
    try {
      out = execFileSync('reg.exe', ['query', key, '/v', 'Path'], {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch { continue }
    const match = /Path\s+REG_[A-Z_]+\s+(.+)/i.exec(out)
    if (match === null) continue
    let dir = match[1].trim()
    for (let level = 0; level < 4; level += 1) {
      candidates.push(path.join(dir, 'UV4', 'UV4.exe'), path.join(dir, 'UV4.exe'))
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return candidates
}

function commonUv4Candidates() {
  const roots = []
  const local = process.env.LOCALAPPDATA
  if (local) roots.push(path.join(local, 'Keil_v5'))
  for (const name of ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432']) {
    const base = process.env[name]
    if (base) roots.push(path.join(base, 'Keil_v5'))
  }
  for (const drive of ['C:', 'D:', 'E:', 'F:']) roots.push(`${drive}\\Keil_v5`)
  const candidates = []
  for (const root of roots) candidates.push(path.join(root, 'UV4', 'UV4.exe'), path.join(root, 'UV4.exe'))
  return candidates
}

/**
 * Describe how UV4 was located: the winning path, its source, and the attempts
 * that were made. Used by `status`, `doctor`, the HTTP route and the CLI so a
 * human or the model can see exactly what to fix when Keil is not found.
 */
export function describeUv4({ refresh = false } = {}) {
  const now = Date.now()
  if (!refresh && uv4Cache.value !== undefined && now - uv4Cache.at < UV4_CACHE_MS) return uv4Cache.value
  const config = readConfig()
  const attempts = []
  const consider = (source, input) => {
    const resolved = resolveUv4Input(input)
    attempts.push({ source, input: String(input), path: resolved ?? null })
    return resolved
  }
  let found
  let source
  for (const key of UV4_ENV_KEYS) {
    const raw = process.env[key]
    if (typeof raw !== 'string' || raw.trim() === '') continue
    const resolved = consider(`env:${key}`, raw)
    if (resolved !== undefined) { found = resolved; source = `env:${key}`; break }
  }
  if (found === undefined && config.uv4 !== undefined) {
    const resolved = consider('config', config.uv4)
    if (resolved !== undefined) { found = resolved; source = 'config' }
  }
  if (found === undefined) {
    for (const candidate of [...registryUv4Candidates(), ...commonUv4Candidates()]) {
      const resolved = consider('auto', candidate)
      if (resolved !== undefined) { found = resolved; source = 'auto'; break }
      if (attempts.length > 60) break
    }
  }
  if (found === undefined && process.platform === 'win32') {
    try {
      const out = execFileSync('where.exe', ['UV4.exe'], {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const first = out.split(/\r?\n/).map((line) => line.trim()).find((line) => line !== '')
      if (first !== undefined && fs.statSync(first).isFile()) { found = first; source = 'auto:path' }
    } catch { /* not on PATH */ }
  }
  const value = {
    path: found ?? null,
    found: found !== undefined,
    source: source ?? null,
    configFile: configFilePath(),
    envKeys: UV4_ENV_KEYS,
    platform: process.platform,
    attempts,
    hint: found === undefined
      ? `未找到 UV4.exe：设置环境变量 ${UV4_ENV_KEYS[0]}，或运行 dsh-keil set-uv4 --path <UV4.exe|UV4 目录|Keil 根目录>（写入 ${configFilePath()}）。`
      : undefined,
  }
  uv4Cache = { at: now, value }
  return value
}

/** The UV4.exe path, or undefined. Thin wrapper over {@link describeUv4}. */
export function findUv4Path() {
  const described = describeUv4()
  return described.path ?? undefined
}

/**
 * Best-effort detection of the optional UI dependency (`dsh-better-sidebar`).
 * The Host half never requires it: when it is absent the sidebar tab is simply
 * not registered, while the tool, CLI and HTTP API keep working.
 */
function detectOptionalSidebar() {
  const profileDir = process.env.DSH_PROFILE_DIR
  const base = { package: 'dsh-better-sidebar', optional: true }
  if (typeof profileDir !== 'string' || profileDir === '') {
    return {
      ...base,
      installed: null,
      note: 'Optional UI dependency. Tool, CLI and HTTP API work without it; the sidebar tab appears only when it is mounted.',
    }
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(profileDir, 'node_modules', 'dsh-better-sidebar', 'package.json'), 'utf8'))
    return {
      ...base,
      installed: true,
      version: typeof manifest.version === 'string' ? manifest.version : null,
      note: 'Installed: the Keil tab is registered when the betterSidebar client service is mounted.',
    }
  } catch {
    return {
      ...base,
      installed: false,
      version: null,
      note: 'Not installed in this profile: the Keil tool, CLI and HTTP API still work; no sidebar tab is registered.',
    }
  }
}

/** One JSON-ready report for humans, agents and issue reports. */
export function getDoctorReport({ cwd = process.cwd() } = {}) {
  return {
    version: VERSION,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cwd: path.resolve(cwd),
    stateFile: STATE_FILE,
    configFile: configFilePath(),
    keilHome: KEIL_HOME,
    uv4: describeUv4({ refresh: true }),
    optionalSidebar: detectOptionalSidebar(),
  }
}

function parseBuildSummary(log) {
  const summary = {}
  const size = /Program Size:\s*Code=(\d+)\s+RO-data=(\d+)\s+RW-data=(\d+)\s+ZI-data=(\d+)/i.exec(log)
  if (size !== null) {
    summary.programSize = {
      code: Number(size[1]),
      roData: Number(size[2]),
      rwData: Number(size[3]),
      ziData: Number(size[4]),
    }
  }
  const err = /(\d+)\s+Error\(s\),\s*(\d+)\s+Warning\(s\)/i.exec(log)
  if (err !== null)
  {
    summary.errors = Number(err[1])
    summary.warnings = Number(err[2])
  }
  const target = /Target\s+'([^']+)'/i.exec(log)
  if (target !== null) summary.target = target[1]
  const buildTime = /Build Time Elapsed:\s*([0-9:]+)/i.exec(log)
  if (buildTime !== null) summary.elapsed = buildTime[1]
  summary.eraseDone = /Erase Done/i.test(log)
  summary.programDone = /Programming Done/i.test(log)
  summary.verifyOk = /Verify OK/i.test(log)
  summary.flashError = /(Flash Load finished with error|Error: Flash Download failed|Cannot Load Flash Programming Algorithm)/i.test(log)
  return summary
}

function findLatestHex(projectDir) {
  const queue = [{ dir: projectDir, depth: 0 }]
  let best
  let visited = 0
  while (queue.length > 0 && visited < 12000) {
    const { dir, depth } = queue.shift()
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    visited += 1
    for (const entry of entries) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth >= 6) continue
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
        queue.push({ dir: abs, depth: depth + 1 })
        continue
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.hex') continue
      let stat
      try { stat = fs.statSync(abs) } catch { continue }
      if (best === undefined || stat.mtimeMs > best.mtimeMs) best = { path: abs, mtimeMs: stat.mtimeMs, size: stat.size }
    }
  }
  return best
}

function tailor(text) {
  if (typeof text !== 'string') return ''
  return text.length > MAX_LOG_CHARS ? text.slice(text.length - MAX_LOG_CHARS) : text
}

export class BuildManager {
  constructor(home) {
    this.home = home
    this.job = null
    this.counter = 0
  }

  current() {
    return this.job === null ? undefined : this.publicJob(this.job)
  }

  publicJob(job) {
    if (job === null || job === undefined) return undefined
    let log = job.log
    if (job.logFile !== undefined) {
      try {
        const stat = fs.statSync(job.logFile)
        if (job.lastLogSize !== stat.size) {
          log = tailor(fs.readFileSync(job.logFile, 'utf8'))
          job.log = log
          job.lastLogSize = stat.size
        }
      } catch { /* log may not exist yet */ }
    }
    return {
      id: job.id,
      mode: job.mode,
      project: job.project,
      status: job.status,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      exitCode: job.exitCode,
      log,
      logFile: job.logFile,
      command: job.command,
      summary: job.summary,
      hex: job.hex,
      error: job.error,
    }
  }

  start({ project, mode = 'build' }) {
    if (this.job !== null && this.job.status === 'running') {
      throw new KeilError('BUILD_BUSY', `已有 ${this.job.mode} 任务在运行（${this.job.id}）`)
    }
    const uv4 = findUv4Path()
    if (uv4 === undefined) {
      const described = describeUv4({ refresh: true })
      throw new KeilError('UV4_NOT_FOUND', described.hint, { configFile: configFilePath(), attempts: described.attempts })
    }
    if (!['build', 'rebuild', 'clean', 'download'].includes(mode)) {
      throw new KeilError('BAD_ARGUMENT', `未知构建模式：${mode}`)
    }
    const projectPath = path.resolve(project)
    assertProjectFile(projectPath)
    this.counter += 1
    const id = `keil-${Date.now().toString(36)}-${this.counter}`
    const projectName = path.basename(projectPath, path.extname(projectPath))
    const logDir = path.join(this.home, 'logs', projectName)
    ensureDir(logDir)
    const startedAt = Date.now()
    const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-')
    const logFile = path.join(logDir, `${stamp}-${mode}.log`)
    const args = mode === 'download'
      ? ['-f', projectPath, '-j0', '-o', logFile]
      : mode === 'clean'
        ? ['-c', projectPath, '-j0', '-o', logFile]
        : [mode === 'rebuild' ? '-r' : '-b', projectPath, '-j0', '-o', logFile]
    const job = {
      id,
      mode,
      project: projectPath,
      status: 'running',
      startedAt,
      finishedAt: undefined,
      exitCode: undefined,
      log: '',
      logFile,
      lastLogSize: -1,
      command: [uv4, ...args],
      summary: undefined,
      hex: undefined,
      error: undefined,
      stdout: '',
      stderr: '',
      child: undefined,
      waiters: [],
      timer: undefined,
    }
    this.job = job
    try {
      const child = spawn(uv4, args, { cwd: path.dirname(projectPath), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      job.child = child
      child.stdout?.on('data', (chunk) => { job.stdout += chunk.toString('utf8') })
      child.stderr?.on('data', (chunk) => { job.stderr += chunk.toString('utf8') })
      child.on('error', (error) => {
        job.error = error.message
        this.finish(job, -1)
      })
      child.on('close', (code) => { this.finish(job, typeof code === 'number' ? code : -1) })
      job.timer = setTimeout(() => {
        job.error = `构建超时（>${Math.round(BUILD_TIMEOUT_MS / 60000)} 分钟）`
        try { job.child?.kill() } catch { /* ignore */ }
      }, BUILD_TIMEOUT_MS)
      job.timer.unref?.()
    } catch (error) {
      job.error = error instanceof Error ? error.message : String(error)
      this.finish(job, -1)
    }
    return this.publicJob(job)
  }

  finish(job, code) {
    if (job.status !== 'running') return
    if (job.timer !== undefined) clearTimeout(job.timer)
    job.exitCode = code
    job.finishedAt = Date.now()
    job.status = code >= 0 && (code === 0 || code === 1) && job.error === undefined ? 'success' : 'failed'
    if (job.error !== undefined) job.status = 'failed'
    let fileLog = ''
    try { fileLog = fs.readFileSync(job.logFile, 'utf8') } catch { fileLog = '' }
    const combined = [fileLog, job.stdout, job.stderr].filter((part) => part.trim() !== '').join('\n')
    job.log = tailor(combined)
    job.summary = parseBuildSummary(combined)
    if (job.status === 'success' && job.mode !== 'download' && job.mode !== 'clean') {
      job.hex = findLatestHex(path.dirname(job.project))
    }
    for (const resolve of job.waiters.splice(0)) resolve(this.publicJob(job))
  }

  wait(id) {
    if (this.job === null || this.job.id !== id) {
      throw new KeilError('BUILD_NOT_FOUND', `构建任务不存在：${id}`)
    }
    if (this.job.status !== 'running') return Promise.resolve(this.publicJob(this.job))
    return new Promise((resolve) => { this.job.waiters.push(resolve) })
  }

  stop() {
    if (this.job === null || this.job.status !== 'running') {
      throw new KeilError('BUILD_NOT_RUNNING', '当前没有运行中的构建任务')
    }
    this.job.error = '用户停止'
    try { this.job.child?.kill() } catch { /* ignore */ }
    this.finish(this.job, -1)
    return this.publicJob(this.job)
  }
}

export const buildManager = new BuildManager(KEIL_HOME)

export function getRuntimeStatus({ cwd = process.cwd(), project, includeCandidates = false } = {}) {
  const resolved = (() => {
    try {
      return resolveProjectPath(cwd, project)
    } catch (error) {
      if (error instanceof KeilError && error.code === 'NO_PROJECT_SELECTED') return undefined
      throw error
    }
  })()
  let projectView
  let projectError
  if (resolved !== undefined) {
    try {
      const full = loadProjectView(resolved.project)
      const { groups, includes, ...summary } = full
      projectView = summary
    } catch (error) {
      projectError = error instanceof Error ? error.message : String(error)
    }
  }
  const uv4 = describeUv4()
  const currentBuild = buildManager.current()
  const config = readConfig()
  const status = {
    cwd: path.resolve(cwd),
    stateFile: STATE_FILE,
    configFile: configFilePath(),
    selection: resolved === undefined ? null : { project: resolved.project, source: resolved.source },
    project: projectView ?? null,
    projectError,
    uv4: {
      path: uv4.path,
      found: uv4.found,
      source: uv4.source,
      ...(uv4.hint === undefined ? {} : { hint: uv4.hint }),
    },
    config: { uv4: config.uv4 ?? null },
    build: currentBuild === undefined
      ? null
      : { ...currentBuild, log: typeof currentBuild.log === 'string' ? currentBuild.log.slice(-20000) : '' },
    version: VERSION,
  }
  if (includeCandidates) status.discovery = findProjectCandidates(cwd)
  return status
}

/* ------------------------------------------------------------------ *
 * Action facade (used by the Host tool, HTTP route and CLI)
 * ------------------------------------------------------------------ */

export async function invokeAction(action, params = {}) {
  const cwd = path.resolve(params.cwd ?? process.cwd())
  switch (action) {
    case 'status':
      return getRuntimeStatus({ cwd, project: params.project, includeCandidates: params.includeCandidates === true })
    case 'candidates':
      return findProjectCandidates(cwd)
    case 'select': {
      if (typeof params.project !== 'string' || params.project.trim() === '') {
        throw new KeilError('BAD_ARGUMENT', 'select 需要 project 参数')
      }
      const selected = setSelection(cwd, params.project, params.source === 'cli' ? 'cli' : 'ui')
      return { ...selected, status: getRuntimeStatus({ cwd }) }
    }
    case 'clear_selection':
      clearSelection(cwd)
      return { cleared: true }
    case 'doctor':
      return getDoctorReport({ cwd })
    case 'tree':
      return loadProjectView(resolveProjectPath(cwd, params.project).project)
    case 'files':
      return scanSourceFiles(cwd, params.query ?? '', { maxResults: params.maxResults })
    case 'create_group': {
      const project = resolveProjectPath(cwd, params.project).project
      return createGroup(project, params.group ?? params.name)
    }
    case 'delete_group': {
      const project = resolveProjectPath(cwd, params.project).project
      return deleteGroup(project, params.group ?? params.name)
    }
    case 'add_file': {
      const project = resolveProjectPath(cwd, params.project).project
      const file = params.file ?? params.path
      if (typeof file !== 'string' || file.trim() === '') throw new KeilError('BAD_ARGUMENT', 'add_file 需要 file 参数')
      return addFile(project, params.group, file, { allowMissing: params.allowMissing === true, baseDir: cwd })
    }
    case 'remove_file': {
      const project = resolveProjectPath(cwd, params.project).project
      const file = params.file ?? params.name
      if (typeof file !== 'string' || file.trim() === '') throw new KeilError('BAD_ARGUMENT', 'remove_file 需要 file 参数')
      return removeFile(project, params.group, file, { allowMultiple: params.allowMultiple === true })
    }
    case 'add_include': {
      const project = resolveProjectPath(cwd, params.project).project
      const include = params.includePath ?? params.path
      if (typeof include !== 'string' || include.trim() === '') throw new KeilError('BAD_ARGUMENT', 'add_include 需要 includePath 参数')
      return addIncludePath(project, include, { allowMissing: params.allowMissing === true, baseDir: cwd })
    }
    case 'remove_include': {
      const project = resolveProjectPath(cwd, params.project).project
      const include = params.includePath ?? params.path
      if (typeof include !== 'string' || include.trim() === '') throw new KeilError('BAD_ARGUMENT', 'remove_include 需要 includePath 参数')
      return removeIncludePath(project, include, { baseDir: cwd })
    }
    case 'build':
    case 'rebuild':
    case 'clean':
    case 'download': {
      const project = resolveProjectPath(cwd, params.project).project
      const started = buildManager.start({ project, mode: action })
      return buildManager.wait(started.id)
    }
    case 'build_start': {
      const project = resolveProjectPath(cwd, params.project).project
      const mode = params.mode ?? 'build'
      return buildManager.start({ project, mode })
    }
    case 'build_status':
      return buildManager.current() ?? { status: 'idle' }
    case 'build_stop':
      return buildManager.stop()
    default:
      throw new KeilError('UNKNOWN_ACTION', `未知操作：${action}`)
  }
}

export function readLogFile(file, maxChars = MAX_LOG_CHARS) {
  try {
    return tailor(fs.readFileSync(file, 'utf8'))
  } catch {
    return ''
  }
}

export function hashId(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 10)
}
