/**
 * Self-contained core tests. Run with: node --test test/core.test.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-keil-test-'))
process.env.DSH_KEIL_STATE = path.join(tempRoot, 'state.json')
process.env.DSH_KEIL_CONFIG = path.join(tempRoot, 'config.json')
delete process.env.DSH_KEIL_UV4
delete process.env.KEIL_UV4

const core = await import('../lib/core.mjs')

function makeFakeUv4Root(label) {
  const root = fs.mkdtempSync(path.join(tempRoot, `${label}-keil-`))
  const uvDir = path.join(root, 'UV4')
  fs.mkdirSync(uvDir, { recursive: true })
  const exe = path.join(uvDir, 'UV4.exe')
  fs.writeFileSync(exe, 'stub')
  return { root, uvDir, exe }
}

function makeProject() {
  const root = fs.mkdtempSync(path.join(tempRoot, 'project-'))
  const mdk = path.join(root, 'MDK-ARM')
  fs.mkdirSync(mdk, { recursive: true })
  fs.mkdirSync(path.join(root, 'Core', 'Inc'), { recursive: true })
  fs.mkdirSync(path.join(root, 'Core', 'Src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'Core', 'Src', 'main.c'), 'int main(void){return 0;}\n')
  fs.writeFileSync(path.join(root, 'Core', 'Src', 'extra.c'), 'int extra;\n')
  const xml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>',
    '<Project xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '  <SchemaVersion>2.1</SchemaVersion>',
    '  <Targets>',
    '    <Target>',
    '      <TargetName>App</TargetName>',
    '      <TargetOption>',
    '        <TargetCommonOption>',
    '          <Device>STM32F411RCTx</Device>',
    '        </TargetCommonOption>',
    '        <TargetArmAds>',
    '          <Cads>',
    '            <VariousControls>',
    '              <IncludePath>../Core/Inc</IncludePath>',
    '            </VariousControls>',
    '          </Cads>',
    '        </TargetArmAds>',
    '      </TargetOption>',
    '      <Groups>',
    '        <Group>',
    '          <GroupName>App</GroupName>',
    '          <Files>',
    '            <File>',
    '              <FileName>main.c</FileName>',
    '              <FileType>1</FileType>',
    '              <FilePath>../Core/Src/main.c</FilePath>',
    '            </File>',
    '          </Files>',
    '        </Group>',
    '      </Groups>',
    '    </Target>',
    '  </Targets>',
    '</Project>',
    '',
  ].join('\r\n')
  const project = path.join(mdk, 'app.uvprojx')
  fs.writeFileSync(project, xml)
  return { root, project }
}

test('loadProjectView reads target, groups, files and include paths', () => {
  const { project } = makeProject()
  const view = core.loadProjectView(project)
  assert.equal(view.target.name, 'App')
  assert.equal(view.target.device, 'STM32F411RCTx')
  assert.equal(view.counts.groups, 1)
  assert.equal(view.counts.files, 1)
  assert.deepEqual(view.includes, ['../Core/Inc'])
  assert.equal(view.groups[0].files[0].name, 'main.c')
  assert.equal(view.groups[0].files[0].exists, true)
})

test('add/remove file edits only registration and round-trips', () => {
  const { root, project } = makeProject()
  const before = fs.readFileSync(project)
  const extra = path.join(root, 'Core', 'Src', 'extra.c')
  core.addFile(project, 'App', extra)
  let view = core.loadProjectView(project)
  assert.equal(view.counts.files, 2)
  assert.equal(view.groups[0].files[1].name, 'extra.c')
  assert.equal(view.groups[0].files[1].path, '../Core/Src/extra.c')
  assert.equal(fs.existsSync(extra), true)
  core.removeFile(project, 'App', 'extra.c')
  view = core.loadProjectView(project)
  assert.equal(view.counts.files, 1)
  assert.equal(fs.existsSync(extra), true)
  const after = fs.readFileSync(project)
  assert.equal(before.equals(after), true, 'add+remove should leave uvprojx byte-identical')
})

test('create/delete group and include path edits round-trip safely', () => {
  const { project } = makeProject()
  core.createGroup(project, 'AddedGroup')
  let view = core.loadProjectView(project)
  assert.equal(view.counts.groups, 2)
  core.addIncludePath(project, '../Core/Inc2', { allowMissing: true })
  view = core.loadProjectView(project)
  assert.deepEqual(view.includes, ['../Core/Inc', '../Core/Inc2'])
  core.removeIncludePath(project, '../Core/Inc2')
  core.deleteGroup(project, 'AddedGroup')
  view = core.loadProjectView(project)
  assert.equal(view.counts.groups, 1)
  assert.deepEqual(view.includes, ['../Core/Inc'])
})

test('duplicate registrations are rejected', () => {
  const { root, project } = makeProject()
  assert.throws(
    () => core.addFile(project, 'App', path.join(root, 'Core', 'Src', 'main.c')),
    (error) => error.code === 'FILE_EXISTS',
  )
  assert.throws(
    () => core.addIncludePath(project, '../Core/Inc'),
    (error) => error.code === 'INCLUDE_EXISTS',
  )
  assert.throws(
    () => core.createGroup(project, 'App'),
    (error) => error.code === 'GROUP_EXISTS',
  )
})

test('user selection is per workspace and never auto-discovered', () => {
  const { root, project } = makeProject()
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace)
  assert.throws(
    () => core.resolveProjectPath(workspace),
    (error) => error.code === 'NO_PROJECT_SELECTED',
  )
  core.setSelection(workspace, project, 'ui')
  const resolved = core.resolveProjectPath(workspace)
  assert.equal(resolved.project, path.resolve(project))
  assert.equal(resolved.source, 'user-selection')
  core.clearSelection(workspace)
  assert.throws(
    () => core.resolveProjectPath(workspace),
    (error) => error.code === 'NO_PROJECT_SELECTED',
  )
})

test('candidate scan finds uvprojx but does not select it', () => {
  const { root } = makeProject()
  const found = core.findProjectCandidates(root)
  assert.equal(found.candidates.length, 1)
  assert.equal(found.candidates[0].name, 'app.uvprojx')
  assert.throws(
    () => core.resolveProjectPath(root),
    (error) => error.code === 'NO_PROJECT_SELECTED',
  )
})

test('relative paths resolve from the workspace first, like the Python tool', () => {
  const { root, project } = makeProject()
  fs.mkdirSync(path.join(root, 'NewSrc'))
  fs.writeFileSync(path.join(root, 'NewSrc', 'added.c'), 'int added;\n')
  fs.mkdirSync(path.join(root, 'NewInc'))
  core.addFile(project, 'App', 'NewSrc/added.c', { baseDir: root })
  core.addIncludePath(project, 'NewInc', { baseDir: root })
  let view = core.loadProjectView(project)
  const added = view.groups[0].files.find((file) => file.name === 'added.c')
  assert.equal(added.path, '../NewSrc/added.c')
  assert.ok(view.includes.includes('../NewInc'))
  core.removeFile(project, 'App', 'added.c')
  core.removeIncludePath(project, 'NewInc', { baseDir: root })
  view = core.loadProjectView(project)
  assert.equal(view.groups[0].files.some((file) => file.name === 'added.c'), false)
  assert.equal(view.includes.includes('../NewInc'), false)
})

test('FileType follows the old Python mapping (.inc stays header/default 5)', () => {
  const { root, project } = makeProject()
  fs.writeFileSync(path.join(root, 'Core', 'Inc', 'table.inc'), '; generated\n')
  core.addFile(project, 'App', path.join(root, 'Core', 'Inc', 'table.inc'))
  const view = core.loadProjectView(project)
  const added = view.groups[0].files.find((file) => file.name === 'table.inc')
  assert.equal(added.type, '5')
})

test('strict parser rejects mismatched XML instead of guessing', () => {
  const { root, project } = makeProject()
  const text = fs.readFileSync(project, 'utf8').replace('</Target>', '</Nope>')
  fs.writeFileSync(project, text)
  assert.throws(
    () => core.loadProjectView(project),
    (error) => error.code === 'BAD_PROJECT_XML',
  )
})

test('BOM, CRLF, comments, > in attributes and self-closing Files survive edits', () => {
  const root = fs.mkdtempSync(path.join(tempRoot, 'edge-'))
  const mdk = path.join(root, 'MDK-ARM')
  fs.mkdirSync(mdk, { recursive: true })
  fs.mkdirSync(path.join(root, 'Src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'Src', 'a.c'), 'int a;\n')
  const xml = '\uFEFF<?xml version="1.0" encoding="UTF-8"?>\r\n'
    + '<!-- comment <with> fake tags -->\r\n'
    + '<Project note="a > b">\r\n'
    + '  <Targets>\r\n'
    + '    <Target>\r\n'
    + '      <TargetName>Edge</TargetName>\r\n'
    + '      <TargetOption><TargetArmAds><Cads><VariousControls>\r\n'
    + '        <IncludePath></IncludePath>\r\n'
    + '      </VariousControls></Cads></TargetArmAds></TargetOption>\r\n'
    + '      <Groups>\r\n'
    + '        <Group><GroupName>Empty</GroupName><Files/></Group>\r\n'
    + '      </Groups>\r\n'
    + '    </Target>\r\n'
    + '  </Targets>\r\n'
    + '</Project>'
  const project = path.join(mdk, 'edge.uvprojx')
  fs.writeFileSync(project, xml)
  const before = fs.readFileSync(project)
  core.addFile(project, 'Empty', path.join(root, 'Src', 'a.c'))
  let view = core.loadProjectView(project)
  assert.equal(view.groups[0].files[0].name, 'a.c')
  core.removeFile(project, 'Empty', 'a.c')
  const after = fs.readFileSync(project)
  const afterText = after.toString('utf8')
  assert.equal(afterText.startsWith('\uFEFF'), true, 'BOM must survive')
  assert.equal(afterText.includes('\r\n'), true, 'CRLF must survive')
  assert.equal(afterText.includes('<!-- comment <with> fake tags -->'), true, 'comments must survive')
  assert.equal(afterText.includes('<Project note="a > b">'), true, 'quoted > in attributes must survive')
  assert.equal(core.loadProjectView(project).groups[0].files.length, 0)
})

test('UV4 path accepts the exe, its UV4 folder, or the Keil root folder', () => {
  const { root, uvDir, exe } = makeFakeUv4Root('accept')
  assert.equal(core.resolveUv4Input(exe), exe)
  assert.equal(core.resolveUv4Input(uvDir), exe)
  assert.equal(core.resolveUv4Input(root), exe)
  assert.equal(core.resolveUv4Input(path.join(root, 'nope')), undefined)
  assert.equal(core.resolveUv4Input(''), undefined)
})

test('UV4 discovery prefers the environment, then the machine config file', () => {
  const first = makeFakeUv4Root('env-first')
  const second = makeFakeUv4Root('config-second')
  process.env.DSH_KEIL_CONFIG = path.join(tempRoot, 'config-priority.json')
  core.setUv4Path(second.root)
  try {
    process.env.DSH_KEIL_UV4 = first.uvDir
    core.resetUv4Cache()
    let described = core.describeUv4({ refresh: true })
    assert.equal(described.path, first.exe)
    assert.equal(described.source, 'env:DSH_KEIL_UV4')
    assert.equal(described.found, true)

    delete process.env.DSH_KEIL_UV4
    core.resetUv4Cache()
    described = core.describeUv4({ refresh: true })
    assert.equal(described.path, second.exe)
    assert.equal(described.source, 'config')
  } finally {
    delete process.env.DSH_KEIL_UV4
    core.resetUv4Cache()
  }
})

test('set-uv4 persists a resolved path and rejects junk input', () => {
  const { root, exe } = makeFakeUv4Root('persist')
  process.env.DSH_KEIL_CONFIG = path.join(tempRoot, 'config-persist.json')
  const saved = core.setUv4Path(root)
  assert.equal(saved.uv4, exe)
  assert.equal(saved.configFile, process.env.DSH_KEIL_CONFIG)
  const onDisk = JSON.parse(fs.readFileSync(saved.configFile, 'utf8'))
  assert.equal(onDisk.uv4, exe)
  assert.equal(onDisk.version, 1)
  assert.throws(
    () => core.setUv4Path(path.join(root, 'missing-dir')),
    (error) => error.code === 'UV4_NOT_FOUND',
  )
})

test('status and doctor expose the UV4 source and the config paths', () => {
  const { root } = makeFakeUv4Root('status')
  process.env.DSH_KEIL_CONFIG = path.join(tempRoot, 'config-status.json')
  core.setUv4Path(root)
  const status = core.getRuntimeStatus({ cwd: tempRoot })
  assert.equal(status.configFile, process.env.DSH_KEIL_CONFIG)
  assert.equal(status.uv4.found, true)
  assert.equal(status.uv4.source, 'config')
  assert.equal(status.config.uv4, status.uv4.path)
  const doctor = core.getDoctorReport({ cwd: tempRoot })
  assert.equal(doctor.version, JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version)
  assert.equal(doctor.uv4.found, true)
  assert.equal(Array.isArray(doctor.uv4.attempts), true)
  assert.equal(doctor.uv4.attempts.some((attempt) => attempt.source === 'config'), true)
})

test.after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true })
})
