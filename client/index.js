/**
 * dsh-keil Client half: the Keil workbench tab registered with dsh-better-sidebar.
 *
 * User-driven project selection is the only way a project is chosen. Build and
 * download buttons call the Host's /keil/api route; the registration tree and
 * include paths are edited through the same route.
 */
window.__ModuleLoader__.load({
  id: 'dsh-keil',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'dsh-keil'
    const zh = {
      tabTitle: 'Keil',
      tabDesc: 'Keil 工程编译、下载与工程树管理',
      project: '工程',
      selectProject: '选择工程',
      changeProject: '更换工程',
      refresh: '刷新',
      noProject: '还没有选择 Keil 工程',
      noProjectHint: '请由你选择一个 .uvprojx（插件不会自动挑）。候选来自当前工作区扫描。',
      scan: '扫描候选',
      scanning: '扫描中…',
      manualPath: '或输入 .uvprojx 绝对路径',
      usePath: '使用此路径',
      candidates: '候选工程',
      noCandidates: '当前工作区未发现 .uvprojx，可直接输入绝对路径。',
      truncated: '候选过多，已截断。',
      incremental: '增量编译',
      rebuild: '全量重编',
      clean: '清理',
      download: '下载',
      stop: '停止',
      buildLog: '构建日志',
      tree: '工程树',
      includes: '头文件路径',
      target: '目标',
      device: '器件',
      groups: '组',
      files: '文件',
      missing: '缺失',
      includeCount: '路径',
      addFile: '添加文件',
      addGroup: '新建组',
      groupName: '组名',
      filePath: '文件路径（绝对，或相对工作区/工程目录）',
      chooseFile: '从工作区选择',
      search: '搜索源文件…',
      add: '添加',
      cancel: '取消',
      create: '创建',
      remove: '移除',
      removeFileTitle: '从工程移除登记？',
      removeFileBody: '只删除 uvprojx 中的登记，磁盘文件不会被删除。',
      removeGroupTitle: '删除工程组？',
      removeGroupBody: '该组及其文件登记会从 uvprojx 中移除，磁盘文件不会被删除。',
      removeIncludeTitle: '移除头文件路径？',
      removeIncludeBody: '只修改 uvprojx 的 IncludePath，不删除磁盘目录。',
      noFiles: '该组暂无文件',
      noIncludes: '暂无头文件搜索路径',
      addInclude: '添加头文件路径',
      includePlaceholder: '绝对，或相对工作区/工程目录的路径',
      busy: '构建中',
      idle: '空闲',
      success: '成功',
      failed: '失败',
      noLog: '暂无日志。点击上面的编译按钮开始。',
      uv4Missing: '未找到 UV4.exe，请设置 DSH_KEIL_UV4 环境变量。',
      projectMissing: '已选择的工程文件不存在，请重新选择。',
      saved: '已保存到工程登记',
      buildStarted: '已开始构建',
      projectSelected: '工程已选择',
      onlyRegistration: '只修改工程登记，不删除磁盘文件。修改前自动备份。',
      close: '关闭',
      logFile: '日志文件',
      hex: 'HEX',
      exitCode: '退出码',
      errors: '错误',
      warnings: '警告',
      selectFailed: '选择工程失败',
      loadFailed: '加载失败',
      actionFailed: '操作失败',
      buildNotRunning: '没有运行中的构建',
      confirmDeleteFile: '从组“{group}”移除文件“{file}”的登记？\n\n磁盘文件不会被删除。',
      confirmDeleteGroup: '删除组“{group}”及其全部文件登记？\n\n磁盘文件不会被删除。',
      confirmDeleteInclude: '移除头文件路径“{path}”？\n\n只修改工程登记。',
      projectPath: '工程路径',
      relativeNote: '相对路径优先按当前工作区解析，再按 uvprojx 目录解析',
    }
    const en = {
      tabTitle: 'Keil',
      tabDesc: 'Build, download and manage a Keil project',
      project: 'Project',
      selectProject: 'Select project',
      changeProject: 'Change project',
      refresh: 'Refresh',
      noProject: 'No Keil project selected',
      noProjectHint: 'Choose a .uvprojx yourself (the plugin never picks one). Candidates come from the current workspace.',
      scan: 'Scan candidates',
      scanning: 'Scanning…',
      manualPath: 'Or enter an absolute .uvprojx path',
      usePath: 'Use this path',
      candidates: 'Candidate projects',
      noCandidates: 'No .uvprojx found under this workspace; enter an absolute path.',
      truncated: 'Too many candidates; the list was truncated.',
      incremental: 'Build',
      rebuild: 'Rebuild',
      clean: 'Clean',
      download: 'Download',
      stop: 'Stop',
      buildLog: 'Build log',
      tree: 'Project tree',
      includes: 'Include paths',
      target: 'Target',
      device: 'Device',
      groups: 'Groups',
      files: 'Files',
      missing: 'Missing',
      includeCount: 'Paths',
      addFile: 'Add file',
      addGroup: 'New group',
      groupName: 'Group name',
      filePath: 'File path (absolute, or relative to the workspace/project directory)',
      chooseFile: 'Pick from workspace',
      search: 'Search source files…',
      add: 'Add',
      cancel: 'Cancel',
      create: 'Create',
      remove: 'Remove',
      removeFileTitle: 'Remove registration?',
      removeFileBody: 'Only the uvprojx entry is removed; the file on disk is kept.',
      removeGroupTitle: 'Delete group?',
      removeGroupBody: 'The group and its file entries are removed from uvprojx; files on disk are kept.',
      removeIncludeTitle: 'Remove include path?',
      removeIncludeBody: 'Only IncludePath in uvprojx is changed; the directory on disk is kept.',
      noFiles: 'No files in this group',
      noIncludes: 'No include search paths',
      addInclude: 'Add include path',
      includePlaceholder: 'Absolute, or relative to the workspace/project directory',
      busy: 'Building',
      idle: 'Idle',
      success: 'Success',
      failed: 'Failed',
      noLog: 'No log yet. Use a build button above.',
      uv4Missing: 'UV4.exe not found. Set the DSH_KEIL_UV4 environment variable.',
      projectMissing: 'The selected project file is missing. Select it again.',
      saved: 'Saved to the project registration',
      buildStarted: 'Build started',
      projectSelected: 'Project selected',
      onlyRegistration: 'Only project registration is edited; files on disk are kept. A backup is made first.',
      close: 'Close',
      logFile: 'Log file',
      hex: 'HEX',
      exitCode: 'Exit code',
      errors: 'Errors',
      warnings: 'Warnings',
      selectFailed: 'Failed to select the project',
      loadFailed: 'Failed to load',
      actionFailed: 'Action failed',
      buildNotRunning: 'No build is running',
      confirmDeleteFile: 'Remove file "{file}" from group "{group}"?\n\nThe file on disk is kept.',
      confirmDeleteGroup: 'Delete group "{group}" and all its file entries?\n\nFiles on disk are kept.',
      confirmDeleteInclude: 'Remove include path "{path}"?\n\nOnly the project registration changes.',
      projectPath: 'Project path',
      relativeNote: 'Relative paths resolve from the workspace first, then the uvprojx directory',
    }

    function useActiveLocale(ctx) {
      const read = () => {
        try { return ctx?.locale?.getSnapshot?.().active === 'en' ? 'en' : 'zh' } catch { return 'zh' }
      }
      const [active, setActive] = useState(read)
      useEffect(() => {
        let dispose
        try {
          dispose = ctx?.locale?.subscribe?.(() => setActive(read()))
        } catch { /* locale service absent */ }
        return () => { try { dispose?.() } catch { /* ignore */ } }
      }, [ctx])
      return active
    }

    function useT(ctx) {
      const active = useActiveLocale(ctx)
      return useCallback((key, vars) => {
        const dict = active === 'en' ? en : zh
        let text = dict[key] ?? zh[key] ?? key
        if (vars && typeof text === 'string') {
          for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value))
        }
        return text
      }, [active])
    }

    async function callApi(ctx, body) {
      const route = ctx?.betterSidebar?.hostRouteUrl?.('/keil/api') ?? '/keil/api'
      const response = await fetch(route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      let json
      try {
        json = await response.json()
      } catch {
        throw new Error(`HTTP ${response.status}`)
      }
      if (json?.ok !== true) {
        const error = new Error(json?.error?.message ?? `HTTP ${response.status}`)
        error.code = json?.error?.code
        throw error
      }
      return json.data
    }

    const COLORS = {
      bg: 'var(--dsw-alias-bg-base)',
      layer1: 'var(--dsw-alias-bg-layer-1)',
      layer2: 'var(--dsw-alias-bg-layer-2)',
      overlay: 'var(--dsw-alias-bg-overlay)',
      border: 'var(--dsw-alias-border-l1)',
      border2: 'var(--dsw-alias-border-l2)',
      text: 'var(--dsw-alias-label-primary)',
      muted: 'var(--dsw-alias-label-secondary)',
      brand: 'var(--dsw-alias-brand-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
      success: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      idle: 'var(--dsw-alias-state-idle-primary)',
    }

    function Btn({ children, onClick, disabled, primary, danger, title, small, style }) {
      const base = {
        appearance: 'none',
        border: `1px solid ${primary ? 'transparent' : COLORS.border}`,
        background: primary ? COLORS.brand : danger ? 'transparent' : COLORS.layer2,
        color: primary ? COLORS.bg : danger ? COLORS.error : COLORS.text,
        borderRadius: 6,
        padding: small ? '2px 7px' : '5px 10px',
        font: 'inherit',
        fontSize: small ? 11 : 12,
        lineHeight: 1.4,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        whiteSpace: 'nowrap',
        ...style,
      }
      return h('button', { type: 'button', onClick, disabled, title: title ?? undefined, style: base }, children)
    }

    function Badge({ children, tone }) {
      const color = tone === 'error' ? COLORS.error : tone === 'success' ? COLORS.success : tone === 'warn' ? COLORS.warn : COLORS.muted
      return h('span', {
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px',
          borderRadius: 999, border: `1px solid ${COLORS.border}`, color,
          fontSize: 10.5, lineHeight: '16px', whiteSpace: 'nowrap',
        },
      }, children)
    }

    function Field({ label, value, onChange, placeholder, onEnter, autoFocus }) {
      return h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: COLORS.muted } },
        label ? h('span', null, label) : null,
        h('input', {
          value,
          autoFocus,
          placeholder: placeholder ?? '',
          onChange: (event) => onChange(event.target.value),
          onKeyDown: (event) => { if (event.key === 'Enter' && onEnter) onEnter() },
          style: {
            width: '100%', boxSizing: 'border-box', padding: '5px 7px', borderRadius: 6,
            border: `1px solid ${COLORS.border}`, background: COLORS.layer1, color: COLORS.text,
            font: 'inherit', fontSize: 12, outline: 'none',
          },
        }))
    }

    function Modal({ title, children, onClose, t }) {
      return h('div', {
        style: {
          position: 'absolute', inset: 0, zIndex: 30, background: 'rgba(0,0,0,0.42)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12,
        },
        onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() },
      }, h('div', {
        style: {
          width: '100%', maxWidth: 420, maxHeight: '90%', overflow: 'auto',
          background: COLORS.overlay, border: `1px solid ${COLORS.border2}`, borderRadius: 10,
          boxShadow: '0 12px 40px rgba(0,0,0,0.35)', padding: 12, color: COLORS.text,
        },
      },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 } },
        h('div', { style: { fontWeight: 600, fontSize: 13, flex: 1 } }, title),
        h(Btn, { small: true, onClick: onClose, title: t('close') }, '×')),
      children))
    }

    function ProjectPicker({ ctx, t, cwd, onPicked, onClose, initialCandidates }) {
      const [candidates, setCandidates] = useState(initialCandidates ?? [])
      const [truncated, setTruncated] = useState(false)
      const [manual, setManual] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')

      const scan = useCallback(async () => {
        setBusy(true)
        setError('')
        try {
          const data = await callApi(ctx, { action: 'candidates', cwd })
          setCandidates(data.candidates ?? [])
          setTruncated(data.truncated === true)
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy(false)
        }
      }, [ctx, cwd])

      useEffect(() => {
        if ((initialCandidates ?? []).length === 0) void scan()
      }, [initialCandidates, scan])

      const pick = async (project) => {
        if (busy) return
        setBusy(true)
        setError('')
        try {
          await callApi(ctx, { action: 'select', cwd, project })
          await onPicked()
          onClose()
        } catch (err) {
          setError(`${t('selectFailed')}: ${err.message}`)
        } finally {
          setBusy(false)
        }
      }

      return h(Modal, { title: t('selectProject'), onClose, t },
        h('div', { style: { fontSize: 11.5, color: COLORS.muted, lineHeight: 1.5, marginBottom: 8 } }, t('noProjectHint')),
        h('div', { style: { display: 'flex', gap: 6, marginBottom: 8 } },
          h(Btn, { small: true, onClick: scan, disabled: busy }, busy ? t('scanning') : t('scan'))),
        h('div', { style: { maxHeight: 210, overflow: 'auto', border: `1px solid ${COLORS.border}`, borderRadius: 8, background: COLORS.layer1 } },
          candidates.length === 0
            ? h('div', { style: { padding: 10, color: COLORS.muted, fontSize: 11.5 } }, t('noCandidates'))
            : candidates.map((candidate) => h('button', {
              key: candidate.path,
              type: 'button',
              onClick: () => void pick(candidate.path),
              title: candidate.path,
              style: {
                display: 'block', width: '100%', textAlign: 'left', padding: '7px 9px',
                border: 'none', borderBottom: `1px solid ${COLORS.border}`, background: 'transparent',
                color: COLORS.text, font: 'inherit', cursor: busy ? 'default' : 'pointer',
              },
            },
            h('div', { style: { fontSize: 12, fontFamily: 'ui-monospace, Consolas, monospace' } }, candidate.relative),
            h('div', { style: { fontSize: 10.5, color: COLORS.muted, marginTop: 2 } },
              `${Math.round(candidate.size / 1024)} KB · ${new Date(candidate.mtimeMs).toLocaleString()}`)))),
        truncated ? h('div', { style: { fontSize: 10.5, color: COLORS.warn, marginTop: 6 } }, t('truncated')) : null,
        h('div', { style: { marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 } },
          h(Field, {
            label: t('manualPath'),
            value: manual,
            onChange: setManual,
            placeholder: 'D:\\project\\MDK-ARM\\app.uvprojx',
            onEnter: () => { if (manual.trim() !== '') void pick(manual.trim()) },
          }),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 6 } },
            h(Btn, { small: true, primary: true, disabled: busy || manual.trim() === '', onClick: () => void pick(manual.trim()) }, t('usePath')))),
        error !== '' ? h('div', { style: { marginTop: 8, color: COLORS.error, fontSize: 11.5, whiteSpace: 'pre-wrap' } }, error) : null)
    }

    function AddFileDialog({ ctx, t, cwd, groups, group, onClose, onDone }) {
      const [targetGroup, setTargetGroup] = useState(group ?? (groups[0]?.name ?? ''))
      const [value, setValue] = useState('')
      const [files, setFiles] = useState([])
      const [query, setQuery] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')

      useEffect(() => {
        let cancelled = false
        ;(async () => {
          try {
            const data = await callApi(ctx, { action: 'files', cwd, query: '' })
            if (!cancelled) setFiles(data.files ?? [])
          } catch { /* optional suggestion list */ }
        })()
        return () => { cancelled = true }
      }, [ctx, cwd])

      const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase()
        const list = needle === '' ? files : files.filter((file) => file.relative.toLowerCase().includes(needle))
        return list.slice(0, 120)
      }, [files, query])

      const add = async () => {
        if (busy || value.trim() === '' || targetGroup === '') return
        setBusy(true)
        setError('')
        try {
          await callApi(ctx, { action: 'add_file', cwd, group: targetGroup, file: value.trim() })
          await onDone()
          onClose()
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy(false)
        }
      }

      return h(Modal, { title: t('addFile'), onClose, t },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: COLORS.muted } },
            h('span', null, t('group')),
            h('select', {
              value: targetGroup,
              onChange: (event) => setTargetGroup(event.target.value),
              style: {
                padding: '5px 7px', borderRadius: 6, border: `1px solid ${COLORS.border}`,
                background: COLORS.layer1, color: COLORS.text, font: 'inherit', fontSize: 12,
              },
            }, groups.map((item) => h('option', { key: item.name, value: item.name }, item.name)))),
          h(Field, { label: t('filePath'), value, onChange: setValue, onEnter: () => void add(), placeholder: 'Core/Src/new_file.c' }),
          h('div', { style: { fontSize: 11, color: COLORS.muted } }, t('chooseFile')),
          h(Field, { value: query, onChange: setQuery, placeholder: t('search') }),
          h('div', { style: { maxHeight: 160, overflow: 'auto', border: `1px solid ${COLORS.border}`, borderRadius: 8, background: COLORS.layer1 } },
            filtered.length === 0
              ? h('div', { style: { padding: 8, color: COLORS.muted, fontSize: 11 } }, '—')
              : filtered.map((file) => h('button', {
                key: file.path,
                type: 'button',
                onClick: () => { setValue(file.path); setQuery('') },
                title: file.path,
                style: {
                  display: 'block', width: '100%', textAlign: 'left', padding: '5px 8px', border: 'none',
                  borderBottom: `1px solid ${COLORS.border}`, background: 'transparent', color: COLORS.text,
                  font: 'inherit', fontSize: 11, cursor: 'pointer', fontFamily: 'ui-monospace, Consolas, monospace',
                },
              }, file.relative))),
        ),
        error !== '' ? h('div', { style: { marginTop: 8, color: COLORS.error, fontSize: 11.5, whiteSpace: 'pre-wrap' } }, error) : null,
        h('div', { style: { marginTop: 10, display: 'flex', justifyContent: 'flex-end', gap: 6 } },
          h(Btn, { small: true, onClick: onClose }, t('cancel')),
          h(Btn, { small: true, primary: true, disabled: busy || value.trim() === '', onClick: () => void add() }, t('add'))))
    }

    function NewGroupDialog({ ctx, t, cwd, onClose, onDone }) {
      const [name, setName] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const create = async () => {
        if (busy || name.trim() === '') return
        setBusy(true)
        setError('')
        try {
          await callApi(ctx, { action: 'create_group', cwd, name: name.trim() })
          await onDone()
          onClose()
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy(false)
        }
      }
      return h(Modal, { title: t('addGroup'), onClose, t },
        h(Field, { label: t('groupName'), value: name, onChange: setName, autoFocus: true, onEnter: () => void create() }),
        error !== '' ? h('div', { style: { marginTop: 8, color: COLORS.error, fontSize: 11.5 } }, error) : null,
        h('div', { style: { marginTop: 10, display: 'flex', justifyContent: 'flex-end', gap: 6 } },
          h(Btn, { small: true, onClick: onClose }, t('cancel')),
          h(Btn, { small: true, primary: true, disabled: busy || name.trim() === '', onClick: () => void create() }, t('create'))))
    }

    function ProjectTree({ ctx, t, cwd, tree, onChanged, setNotice, setError, mode = 'all' }) {
      const showGroups = mode !== 'includes'
      const showIncludes = mode !== 'tree'
      const [expanded, setExpanded] = useState(() => new Set([tree.groups[0]?.name].filter(Boolean)))
      const [addFileGroup, setAddFileGroup] = useState(undefined)
      const [showNewGroup, setShowNewGroup] = useState(false)
      const [includeValue, setIncludeValue] = useState('')
      const [busyAction, setBusyAction] = useState(false)

      const toggle = (name) => {
        setExpanded((current) => {
          const next = new Set(current)
          if (next.has(name)) next.delete(name)
          else next.add(name)
          return next
        })
      }

      const run = async (body, successText) => {
        setBusyAction(true)
        setError('')
        try {
          await callApi(ctx, { action: body.action, cwd, ...body })
          await onChanged()
          if (successText) setNotice(successText)
        } catch (err) {
          setError(err.message)
        } finally {
          setBusyAction(false)
        }
      }

      const confirmRemoveFile = (group, file) => {
        if (!window.confirm(t('confirmDeleteFile', { group, file }))) return
        void run({ action: 'remove_file', group, file }, t('saved'))
      }
      const confirmDeleteGroup = (group) => {
        if (!window.confirm(t('confirmDeleteGroup', { group }))) return
        void run({ action: 'delete_group', name: group }, t('saved'))
      }
      const addInclude = () => {
        if (includeValue.trim() === '') return
        const value = includeValue.trim()
        setIncludeValue('')
        void run({ action: 'add_include', path: value }, t('saved'))
      }
      const removeInclude = (value) => {
        if (!window.confirm(t('confirmDeleteInclude', { path: value }))) return
        void run({ action: 'remove_include', path: value }, t('saved'))
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        showGroups ? h(React.Fragment, null,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
          h('div', { style: { fontSize: 11.5, color: COLORS.muted, flex: 1 } },
            `${t('groups')} ${tree.counts.groups} · ${t('files')} ${tree.counts.files} · ${t('includeCount')} ${tree.counts.includes}`),
          h(Btn, { small: true, onClick: () => setShowNewGroup(true), disabled: busyAction }, `＋ ${t('addGroup')}`)),
        tree.counts.missing > 0
          ? h('div', { style: { fontSize: 11, color: COLORS.warn } }, `${t('missing')}: ${tree.counts.missing}`)
          : null,
        h('div', { style: { border: `1px solid ${COLORS.border}`, borderRadius: 8, overflow: 'hidden', background: COLORS.layer1 } },
          tree.groups.map((group) => {
            const open = expanded.has(group.name)
            return h('div', { key: group.name, style: { borderBottom: `1px solid ${COLORS.border}` } },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, padding: '4px 5px', background: COLORS.layer2 } },
                h('button', {
                  type: 'button', onClick: () => toggle(group.name),
                  style: { border: 'none', background: 'transparent', color: COLORS.text, cursor: 'pointer', font: 'inherit', padding: '0 2px', width: 18 },
                  title: open ? 'collapse' : 'expand',
                }, open ? '▾' : '▸'),
                h('div', { style: { flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: group.name }, group.name),
                h('span', { style: { fontSize: 10.5, color: COLORS.muted } }, String(group.files.length)),
                h(Btn, { small: true, title: t('addFile'), onClick: () => setAddFileGroup(group.name) }, '＋'),
                group.name.startsWith('::') ? null : h(Btn, {
                  small: true, danger: true, title: t('remove'),
                  onClick: () => confirmDeleteGroup(group.name),
                }, '×')),
              open ? h('div', null,
                group.files.length === 0
                  ? h('div', { style: { padding: '6px 10px', fontSize: 11, color: COLORS.muted } }, t('noFiles'))
                  : group.files.map((file) => h('div', {
                    key: `${group.name}:${file.name}:${file.path}`,
                    style: { display: 'flex', alignItems: 'center', gap: 5, padding: '3px 6px 3px 24px', borderTop: `1px solid ${COLORS.border}` },
                  },
                  h('span', {
                    title: file.path,
                    style: {
                      flex: 1, minWidth: 0, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap', color: file.exists ? COLORS.text : COLORS.error,
                      fontFamily: 'ui-monospace, Consolas, monospace',
                    },
                  }, file.name, file.exists ? '' : ' (missing)'),
                  h(Btn, { small: true, danger: true, onClick: () => confirmRemoveFile(group.name, file.name), title: t('remove') }, '×')))
              ) : null)
          }))) : null,
        showIncludes ? h(React.Fragment, null,
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 } },
          h('div', { style: { fontSize: 11.5, fontWeight: 600 } }, t('includes')),
          h('div', { style: { fontSize: 10.5, color: COLORS.muted } }, t('relativeNote')),
          h('div', { style: { border: `1px solid ${COLORS.border}`, borderRadius: 8, background: COLORS.layer1 } },
            tree.includes.length === 0
              ? h('div', { style: { padding: 7, fontSize: 11, color: COLORS.muted } }, t('noIncludes'))
              : tree.includes.map((value) => h('div', {
                key: value,
                style: { display: 'flex', alignItems: 'center', gap: 5, padding: '4px 6px', borderTop: `1px solid ${COLORS.border}` },
              },
              h('span', {
                title: value,
                style: { flex: 1, minWidth: 0, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
              }, value),
              h(Btn, { small: true, danger: true, onClick: () => removeInclude(value), title: t('remove') }, '×')))),
          h('div', { style: { display: 'flex', gap: 5 } },
            h('input', {
              value: includeValue,
              placeholder: t('includePlaceholder'),
              onChange: (event) => setIncludeValue(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter') addInclude() },
              style: {
                flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '4px 6px', borderRadius: 6,
                border: `1px solid ${COLORS.border}`, background: COLORS.layer1, color: COLORS.text,
                font: 'inherit', fontSize: 11,
              },
            }),
            h(Btn, { small: true, primary: true, onClick: addInclude, disabled: busyAction || includeValue.trim() === '' }, t('add'))))) : null,
        h('div', { style: { fontSize: 10.5, color: COLORS.muted, lineHeight: 1.5 } }, t('onlyRegistration')),
        addFileGroup !== undefined
          ? h(AddFileDialog, {
            ctx, t, cwd, group: addFileGroup, groups: tree.groups,
            onClose: () => setAddFileGroup(undefined),
            onDone: onChanged,
          })
          : null,
        showNewGroup
          ? h(NewGroupDialog, { ctx, t, cwd, onClose: () => setShowNewGroup(false), onDone: onChanged })
          : null)
    }

    function BuildSummary({ t, job }) {
      if (!job || !job.summary) return null
      const summary = job.summary
      const parts = []
      if (summary.programSize) {
        parts.push(`Code=${summary.programSize.code} RO=${summary.programSize.roData} RW=${summary.programSize.rwData} ZI=${summary.programSize.ziData}`)
      }
      if (typeof summary.errors === 'number') parts.push(`${t('errors')}=${summary.errors}`)
      if (typeof summary.warnings === 'number') parts.push(`${t('warnings')}=${summary.warnings}`)
      return h('div', { style: { fontSize: 10.5, color: COLORS.muted, lineHeight: 1.5 } }, parts.join(' · '))
    }

    function KeilPanel(props) {
      const { ctx, scope } = props
      const t = useT(ctx)
      const cwd = typeof scope?.cwd === 'string' && scope.cwd !== '' ? scope.cwd : ''
      const [status, setStatus] = useState(null)
      const [tree, setTree] = useState(null)
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [showPicker, setShowPicker] = useState(false)
      const [view, setView] = useState('tree')
      const [buildJob, setBuildJob] = useState(null)
      const [stopping, setStopping] = useState(false)
      const mounted = useRef(true)
      useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

      const loadStatus = useCallback(async () => {
        try {
          const data = await callApi(ctx, { action: 'status', cwd })
          if (!mounted.current) return
          setStatus(data)
          if (data.project) {
            try {
              const treeData = await callApi(ctx, { action: 'tree', cwd })
              if (mounted.current) setTree(treeData)
            } catch (err) {
              if (mounted.current) setError(err.message)
            }
          } else {
            setTree(null)
          }
          if (data.build && data.build.status === 'running') setBuildJob(data.build)
          else if (data.build && buildJob === null) setBuildJob(data.build)
          if (data.project === null && data.selection === null) setShowPicker(true)
        } catch (err) {
          if (mounted.current) setError(err.message)
        } finally {
          if (mounted.current) setLoading(false)
        }
      }, [ctx, cwd, buildJob])

      const refreshTree = useCallback(async () => {
        try {
          const treeData = await callApi(ctx, { action: 'tree', cwd })
          if (mounted.current) setTree(treeData)
        } catch (err) {
          if (mounted.current) setError(err.message)
        }
      }, [ctx, cwd])

      useEffect(() => {
        setLoading(true)
        setStatus(null)
        setTree(null)
        setBuildJob(null)
        void loadStatus()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [cwd])

      useEffect(() => {
        if (!notice) return undefined
        const timer = setTimeout(() => setNotice(''), 3500)
        return () => clearTimeout(timer)
      }, [notice])

      useEffect(() => {
        if (!buildJob || buildJob.status !== 'running') return undefined
        let cancelled = false
        const tick = async () => {
          try {
            const data = await callApi(ctx, { action: 'build_status', cwd })
            if (cancelled) return
            setBuildJob(data)
            if (data.status !== 'running') {
              await loadStatus()
            }
          } catch (err) {
            if (!cancelled) setError(err.message)
          }
        }
        const timer = setInterval(() => { void tick() }, 900)
        return () => { cancelled = true; clearInterval(timer) }
      }, [buildJob?.id, buildJob?.status, ctx, cwd, loadStatus])

      const startBuild = async (mode) => {
        setError('')
        setNotice(t('buildStarted'))
        setView('log')
        try {
          const job = await callApi(ctx, { action: 'build_start', cwd, mode })
          setBuildJob(job)
        } catch (err) {
          setError(err.message)
        }
      }

      const stopBuild = async () => {
        if (stopping) return
        setStopping(true)
        try {
          const job = await callApi(ctx, { action: 'build_stop', cwd })
          setBuildJob(job)
        } catch (err) {
          setError(err.message)
        } finally {
          setStopping(false)
        }
      }

      const project = status?.project
      const selection = status?.selection
      const buildRunning = buildJob?.status === 'running'
      const buildFailed = buildJob?.status === 'failed'
      const buildSuccess = buildJob?.status === 'success'

      const headerSubtitle = project
        ? `${project.target?.name ?? ''}${project.target?.device ? ` · ${project.target.device}` : ''}`
        : t('noProject')

      return h('div', {
        style: {
          display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
          color: COLORS.text, background: 'transparent', position: 'relative',
        },
      },
      h('div', { style: { padding: '9px 10px 8px', borderBottom: `1px solid ${COLORS.border}`, background: COLORS.layer1 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { style: { fontSize: 13, fontWeight: 650, letterSpacing: 0.2 } }, 'Keil Workbench'),
            h('div', {
              title: project?.path ?? '',
              style: { fontSize: 10.5, color: COLORS.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 },
            }, headerSubtitle)),
          h(Btn, { small: true, onClick: () => setShowPicker(true) }, project ? t('changeProject') : t('selectProject')),
          h(Btn, { small: true, onClick: () => { setError(''); void loadStatus() }, disabled: loading }, t('refresh'))),
        project
          ? h('div', { title: project.path, style: { marginTop: 6, fontSize: 10, color: COLORS.muted, fontFamily: 'ui-monospace, Consolas, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, project.path)
          : null,
        status?.uv4?.found === false
          ? h('div', { style: { marginTop: 6, fontSize: 10.5, color: COLORS.warn } }, t('uv4Missing'))
          : null,
        selection && project === null
          ? h('div', { style: { marginTop: 6, fontSize: 10.5, color: COLORS.error } }, t('projectMissing'))
          : null),
      h('div', { style: { padding: '7px 10px', display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center', borderBottom: `1px solid ${COLORS.border}` } },
        h(Btn, { primary: true, small: true, disabled: !project || buildRunning, onClick: () => void startBuild('build') }, `▶ ${t('incremental')}`),
        h(Btn, { small: true, disabled: !project || buildRunning, onClick: () => void startBuild('rebuild') }, t('rebuild')),
        h(Btn, { small: true, disabled: !project || buildRunning, onClick: () => void startBuild('download') }, t('download')),
        h(Btn, { small: true, disabled: !project || buildRunning, onClick: () => void startBuild('clean') }, t('clean')),
        buildRunning ? h(Btn, { small: true, danger: true, disabled: stopping, onClick: () => void stopBuild() }, stopping ? '…' : `■ ${t('stop')}`) : null,
        h('div', { style: { flex: 1 } }),
        buildRunning
          ? h(Badge, { tone: 'warn' }, `${t('busy')}…`)
          : buildSuccess
            ? h(Badge, { tone: 'success' }, t('success'))
            : buildFailed
              ? h(Badge, { tone: 'error' }, t('failed'))
              : h(Badge, null, t('idle'))),
      error !== '' ? h('div', { style: { margin: '7px 10px 0', padding: '6px 8px', borderRadius: 6, border: `1px solid ${COLORS.error}`, color: COLORS.error, fontSize: 11, whiteSpace: 'pre-wrap', display: 'flex', gap: 6 } },
        h('div', { style: { flex: 1 } }, error),
        h('button', { type: 'button', onClick: () => setError(''), style: { border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit' } }, '×')) : null,
      notice !== '' ? h('div', { style: { margin: '7px 10px 0', padding: '5px 8px', borderRadius: 6, border: `1px solid ${COLORS.border2}`, color: COLORS.muted, fontSize: 11 } }, notice) : null,
      h('div', { style: { display: 'flex', gap: 4, padding: '7px 10px 0' } },
        [['tree', t('tree')], ['includes', t('includes')], ['log', t('buildLog')]].map(([key, label]) => h('button', {
          key,
          type: 'button',
          onClick: () => setView(key),
          style: {
            border: 'none', borderBottom: `2px solid ${view === key ? COLORS.brand : 'transparent'}`,
            background: 'transparent', color: view === key ? COLORS.text : COLORS.muted,
            padding: '3px 6px 4px', font: 'inherit', fontSize: 11.5, cursor: 'pointer',
          },
        }, label))),
      h('div', { style: { flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 10px 12px' } },
        !project && !loading
          ? h('div', { style: { border: `1px dashed ${COLORS.border2}`, borderRadius: 8, padding: 14, textAlign: 'center' } },
            h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4 } }, t('noProject')),
            h('div', { style: { fontSize: 11, color: COLORS.muted, lineHeight: 1.5, marginBottom: 8 } }, t('noProjectHint')),
            h(Btn, { primary: true, small: true, onClick: () => setShowPicker(true) }, t('selectProject')))
          : view === 'tree' && tree
            ? h(ProjectTree, { ctx, t, cwd, tree, mode: 'tree', onChanged: async () => { await loadStatus() }, setNotice, setError })
            : view === 'includes' && tree
              ? h(ProjectTree, { ctx, t, cwd, tree, mode: 'includes', onChanged: async () => { await loadStatus() }, setNotice, setError })
              : view === 'log'
                ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                    buildJob
                      ? h(Badge, { tone: buildJob.status === 'success' ? 'success' : buildJob.status === 'failed' ? 'error' : 'warn' },
                        `${buildJob.mode} · ${buildJob.status}`)
                      : h(Badge, null, t('idle')),
                    buildJob && typeof buildJob.exitCode === 'number'
                      ? h('span', { style: { fontSize: 10.5, color: COLORS.muted } }, `${t('exitCode')}: ${buildJob.exitCode}`)
                      : null,
                    buildJob?.hex?.path
                      ? h('span', { title: buildJob.hex.path, style: { fontSize: 10.5, color: COLORS.success, fontFamily: 'ui-monospace, Consolas, monospace' } }, `${t('hex')}: ${buildJob.hex.path}`)
                      : null),
                  h(BuildSummary, { t, job: buildJob }),
                  buildJob?.logFile
                    ? h('div', { title: buildJob.logFile, style: { fontSize: 10, color: COLORS.muted, fontFamily: 'ui-monospace, Consolas, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `${t('logFile')}: ${buildJob.logFile}`)
                    : null,
                  h('pre', {
                    style: {
                      margin: 0, padding: 9, borderRadius: 8, border: `1px solid ${COLORS.border}`,
                      background: COLORS.layer1, color: COLORS.text, fontSize: 10.8, lineHeight: 1.5,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: 100,
                      fontFamily: 'ui-monospace, Consolas, monospace', overflow: 'auto',
                    },
                  }, buildJob?.log && buildJob.log.trim() !== '' ? buildJob.log : t('noLog')))
                : h('div', { style: { color: COLORS.muted, fontSize: 11 } }, loading ? '…' : '')),
      showPicker
        ? h(ProjectPicker, {
          ctx, t, cwd,
          initialCandidates: status?.discovery?.candidates ?? [],
          onPicked: async () => { setNotice(t('projectSelected')); await loadStatus() },
          onClose: () => setShowPicker(false),
        })
        : null)
    }

    function KeilIcon() {
      return h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': true, style: { display: 'block' } },
        h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 3, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M7 9h6M7 12h4M7 15h7', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
        h('path', { d: 'M16 14.5l2 2 3-4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    return {
      // Nothing here is a hard requirement:
      //  - `locale` is normally provided by the base web composition; without it
      //    the panel falls back to its built-in zh/en dictionaries.
      //  - `betterSidebar` is OPTIONAL. dsh-keil is usable as a pure tool/CLI
      //    plugin, so a profile without dsh-better-sidebar must keep working and
      //    simply show no sidebar tab (instead of throwing and blanking the UI).
      inject: [],
      apply(ctx) {
        ctx.inject(['locale'], (localeCtx) => {
          localeCtx.effect(() => {
            const offZh = localeCtx.locale.register(NS, 'zh', zh)
            const offEn = localeCtx.locale.register(NS, 'en', en)
            return () => { offZh(); offEn() }
          }, 'dsh-keil: locale dictionaries')
        })
        ctx.inject(['betterSidebar'], (sidebarCtx) => {
          sidebarCtx.effect(() => sidebarCtx.betterSidebar.registerTab({
            id: 'keil',
            title: () => 'Keil',
            description: () => 'Keil build / download / project registration',
            icon: () => h(KeilIcon),
            order: 35,
            single: true,
            component: KeilPanel,
          }), 'dsh-keil: sidebar tab')
        })
      },
    }
  },
})
