# dsh-keil

DeepSeek Harness（DSH）的 Keil MDK/uVision 工作台。模型可以通过一个工具、一个 JSON CLI 和一个小型 HTTP API 查看、编译并烧录
嵌入式工程；人类还可以选配一个侧边栏面板。

[![test](https://github.com/wimi996123/dsh-keil/actions/workflows/test.yml/badge.svg)](https://github.com/wimi996123/dsh-keil/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) · [English](README.md) | 简体中文

## 要解决的问题

嵌入式固件由厂商 IDE 构建，而不是由 agent 构建：构建配方写在 Keil 的 `.uvprojx` 工程里，编译器是这台机器上安装的那个
MDK，烧录还依赖 IDE 的调试器配置。AI agent 能读 C 源码，却跑不了真正重要的那个循环——编译、读错误、修改、下载——于是
每一轮迭代都得由人转述。

`dsh-keil` 把这个循环变成模型可以直接使用的数据：agent 请求一次构建，拿回 JSON——退出码、错误/警告数、程序大小、日志
路径和生成的 HEX。面板、CLI 和 HTTP 路由共用同一套核心，因此三者不会各自漂移。

## 功能

- **只使用用户选定的工程。** 候选工程会被扫描并列出，但绝不自动选中；选择是用户的显式操作，按工作区保存。
- **通过 UV4 编译与烧录。** `-b` 增量编译、`-r` 全量重编、`-c` 清理、`-f` 下载；同一时间只跑一个任务，UV4 日志落盘。
- **工程树与头文件路径。** 工程组、已登记文件（磁盘上缺失的会标记）以及分号分隔的 `<IncludePath>`，都可以从面板、工具和
  CLI 修改。
- **只改工程登记。** 磁盘上的源文件、`.uvoptx` 和构建产物一律不碰；每次修改前先备份，写入走临时文件 + rename。
- **字节级保留的 XML 编辑。** 严格的区间解析器只做字符串区间拼接，不重新序列化整份文档：先加后删可让工程文件字节级还原，
  BOM/CRLF/注释都能保留。
- **纯 JSON CLI**（`dsh-keil`，退出码 `0`/`1`/`2`）以及**可选的 “Keil” 侧边栏标签页**。

## 环境要求

| 要求 | 说明 |
| --- | --- |
| Windows 10/11 | 编译和下载要执行 `UV4.exe`，因此需要 Windows；只读查看在能运行 Node 的系统上都可用。 |
| 带 uVision 5 的 Keil MDK（`UV4.exe`） | 编译器、器件包和调试器配置来自你的 MDK 安装与工程本身。 |
| DSH `0.2.1-rc.1` 或更新 | 桌面应用，或由 CLI 管理的 profile（`web`、`tui` 等）。本包就是一个普通 DSH bundle。 |
| Node.js 20 或更新 | 桌面应用自带运行时；独立安装需要 Node 20+（见 `engines`）。 |
| `dsh-better-sidebar` `0.28.0`+ | **可选。** 只用于侧边栏标签页；工具、CLI 和 HTTP API 都不依赖它。 |

## 安装

请从这个目录安装 bundle，并且始终传**绝对路径**（`file:` 加正斜杠绝对路径）。相对路径会按包管理器实际运行所在目录解析，
而不是按你的 checkout 解析，结果是静默找不到插件。

### 1. 由 CLI 管理的 DSH profile（最快）

```powershell
dsh plugin --profile web add "file:C:/src/dsh-keil"
dsh plugin --profile web add dsh-better-sidebar@0.28.2   # 可选 UI
```

普通 `dsh` CLI 需要 `pnpm` 在 `PATH` 上（桌面版 carrier CLI 自带 pnpm）。该命令会安装本包，并因为 `package.json`
声明了 bundle patch 而把它追加进 profile 的 `dsh.profile.bundles`。完成后重启 profile。保留的 `desktop` profile 会被
这个 CLI 拒绝（`profile "desktop" is managed exclusively by the Electron application`）——请改用下面的桌面应用方式。

`file:` 安装固定的是当前 checkout 的快照，因此 `git pull` 之后要重新安装；若要针对 checkout 做实时开发，改用
`link:C:/src/dsh-keil`，改动会在下次重启 DSH 后生效。

### 2. 桌面应用

在 **Settings → Plugins** 里从绝对 checkout 目录安装 bundle；或者运行随包提供的安装脚本，它会定位 DSH home、profile 以及
有权写入该 profile 的 CLI（`desktop` 用应用自带的 carrier CLI，其他 profile 用普通 `dsh`；手工 carrier-CLI 命令见
[AGENTS.md](AGENTS.md)）：

```powershell
node scripts/install.mjs --check                 # 只报告：profile、CLI、UV4、仓库
node scripts/install.mjs --dry-run               # 打印将执行的命令，不写入
node scripts/install.mjs                         # 安装到解析出的 profile
node scripts/install.mjs --profile web --no-ui   # 装到另一个 profile，不带侧边栏
```

参数：`--profile <name>`（默认取 `$DSH_PROFILE`，否则已存在 `desktop` 时用它，再否则用 `web`）、`--home <dir>`
（`$DSH_HOME`，否则 `~/.dsh`）、`--repo <dir>`（要安装的 checkout）、`--no-ui`（跳过 `dsh-better-sidebar`）、
`--dry-run`（只打印命令，不写入）、`--check`（只做健康检查，不写入）、`--json`（只输出汇总对象）。
`node scripts/install.mjs --help` 是权威说明。只有 pnpm 报告 profile 被锁定时才需要退出应用。

### 3. 让 AI agent 安装

把 [AGENTS.md](AGENTS.md) 交给 AI agent：里面有安装、验证和修复的 runbook，agent 不必重新摸索 DSH profile 的行为。

### 验证

从普通 checkout 就能运行：`node bin/keil.mjs --help`、`node bin/keil.mjs doctor --compact`、
`node bin/keil.mjs show-config` 和 `node --test test/core.test.mjs`。安装完成后，同一个 CLI 会以 `dsh-keil` 的形式出现在
profile 的 `node_modules/.bin` 里。

## 可选依赖行为

`dsh-better-sidebar` 是唯一的可选依赖，而且只影响 UI：client 端把标签页注册在 `ctx.inject(['betterSidebar'], …)` 里，
因此没有这个服务时注册不会执行，bundle 照常加载，也不会报错。

| 没有 `dsh-better-sidebar` | 有 `dsh-better-sidebar` |
| --- | --- |
| 工具、CLI 和 `/keil/api` 全部可用 | 工具、CLI 和 `/keil/api` 全部可用 |
| 没有侧边栏标签页，也没有告警 | 出现 **Keil** 标签页：工程选择、编译按钮、工程树、头文件路径、日志 |

host 端只要求 `tools` 服务，`webServer` 同样是可选的：headless 或 TUI profile 仍保留工具和 CLI，只是没有面板和 HTTP 路由。

## 配置 UV4

`UV4.exe` 每台机器解析一次，先命中者胜：

| 顺序 | 来源 | 说明 |
| --- | --- | --- |
| 1 | 环境变量 | `DSH_KEIL_UV4`，其次 `KEIL_UV4`；值可以是 exe、`UV4` 目录或 Keil 根目录 |
| 2 | 配置文件 | `%USERPROFILE%\.dsh\keil\config.json` → `{"uv4": "C:\\Keil_v5\\UV4\\UV4.exe"}` |
| 3 | 注册表 | `HKLM\SOFTWARE\WOW6432Node\Keil\Products\MDK`、`HKLM\SOFTWARE\Keil\Products\MDK`、`HKCU\SOFTWARE\Keil\Products\MDK` —— `Path` 值及其各级父目录 |
| 4 | 常见目录 | `%LOCALAPPDATA%\Keil_v5`、`%ProgramFiles%\Keil_v5`、`%ProgramFiles(x86)%\Keil_v5`、`C:`–`F:\Keil_v5` |
| 5 | `PATH` | `where UV4.exe` |

与其依赖自动发现，不如把路径记录一次：

```powershell
dsh-keil set-uv4 --path "C:\Keil_v5\UV4\UV4.exe"
dsh-keil set-uv4 --path "C:\Keil_v5"          # 也接受 UV4 目录或 Keil 根目录
dsh-keil doctor                               # 每条尝试过的路径，以及确切的修复方式
node bin/keil.mjs show-config                 # 当前生效的配置文件与环境变量
```

`set-uv4` 会校验输入、解析出 `UV4.exe` 并写入机器级配置文件。人类和 agent 在构建报 `UV4_NOT_FOUND` 时都应该用它（或设置
环境变量）；不要把机器路径写进仓库。

## 使用

### 侧边栏面板

打开 **Keil** 标签页。首次进入会显示工程选择器：扫描工作区里的候选工程（有深度限制，超过上限时标记 `truncated`），
或直接粘贴 `.uvprojx` 的绝对路径；选择按工作区保存。

- **编译 / 全量重编 / 下载 / 清理** 按钮，任务运行期间还有 **停止**。
- **构建日志** 标签页：状态、退出码、Program Size、错误/警告数、HEX 路径和日志文件（构建中每 0.9 秒轮询）。
- **工程树** 标签页：工程组、文件、磁盘上缺失的条目会标出；添加文件 / 新建组 / 移除 / 删除组。
- **头文件路径** 标签页编辑 `<IncludePath>`。界面文案支持中/英双语。

### 模型工具 `keil`

`action` 必填；可选参数为 `project`、`group`、`file`、`path`、`name`、`query`、`mode`、`allowMissing`、`allowMultiple`。

| 类型 | 操作 |
| --- | --- |
| 只读 | `status`、`doctor`、`candidates`、`tree`、`files` |
| 构建 | `build`、`rebuild`、`clean`、`download`（阻塞等待 UV4，最长 15 分钟）、`build_start`、`build_status`、`build_stop` |
| 登记修改 | `add_file`、`remove_file`、`add_include`、`remove_include`、`create_group`、`delete_group` |

这个工具刻意**没有 `select` 操作**：选工程是用户的决定。不传 `project` 时使用该会话工作目录下已保存的用户选择；连选择
都没有时报 `NO_PROJECT_SELECTED`。

### CLI `dsh-keil`

每条命令输出一个 JSON 对象。退出码：`0` 成功、`1` 操作失败、`2` 用法错误。全局选项：`--cwd <dir>`（默认当前目录）、
`--project <file>`（显式工程，覆盖已保存的选择）、`--compact`（单行 JSON）、`--json`（为兼容而接受；输出始终是 JSON）。

| 命令 | 用途 |
| --- | --- |
| `status` / `doctor` / `show-config` | 选择、工程摘要、UV4 与构建状态；环境诊断；当前配置 |
| `set-uv4 --path <p>` | 校验并保存 `UV4.exe` / UV4 目录 / Keil 根目录 |
| `candidates` | 列出 `--cwd` 下的 `.uvprojx`（绝不自动选择） |
| `select --project <file>` / `clear-selection` | 保存或清除 `--cwd` 的用户选择 |
| `tree` / `files [--query <text>]` | 工程组、文件、头文件路径；源文件搜索 |
| `build` / `rebuild` / `clean` / `download` | 运行 UV4 并等待；返回状态、摘要、日志、HEX |
| `build-start --mode <m>` / `build-status` / `build-stop` | 非阻塞的构建控制 |
| `add-file --group <g> --file <p> [--allow-missing]` | 在工程组里登记文件 |
| `remove-file --group <g> --file <name> [--allow-multiple]` | 取消文件登记 |
| `add-include --path <dir> [--allow-missing]` / `remove-include --path <dir>` | 增删头文件搜索路径 |
| `create-group --name <g>` / `delete-group --name <g>` | 新建或删除工程组 |

```powershell
dsh-keil select --cwd C:\work\fw --project C:\work\fw\MDK-ARM\app.uvprojx
dsh-keil tree --cwd C:\work\fw --compact
dsh-keil build --cwd C:\work\fw
dsh-keil download --project C:\work\fw\MDK-ARM\app.uvprojx
dsh-keil add-file --cwd C:\work\fw --group App --file Core\Src\timer.c
dsh-keil add-include --cwd C:\work\fw --path ../Core/Inc2 --allow-missing
```

传给 `add-file` / `add-include` / `remove-include` 的相对路径先按工作区解析，再按 `.uvprojx` 所在目录解析；写入工程的值以
`.uvprojx` 目录为基准。`FileType` 沿用 Keil 的编号：`.c`→1、`.s`/`.asm`→2、`.lib`/`.a`→4、`.cpp`/`.cc`/`.cxx`→8，
其他（含 `.h`、`.inc`）→5。

### HTTP API

host 端在 `/keil/api` 提供面板使用的同源 API（路由前缀 `/keil`，由 host web server 匹配）；需要已挂载的 `webServer`，
也就是 Web 或桌面组合。

```text
GET  /keil/api   → { "ok": true, "data": { "version", "build", "uv4" } }
POST /keil/api   body: { "action": "status", "cwd": "C:\\work\\fw" }
                 → { "ok": true, "data": … } | { "ok": false, "error": { "code", "message", "details"? } }
```

`action` 是共享核心的任意操作（`status`、`tree`、`build_start`、`select` 等）。请求体上限 1 MiB；失败以 JSON 返回而不是
HTTP 状态码，只有未知的 `/keil/...` 路径（404）和 API 路径上不支持的方法（405）例外。面板通过侧边栏的 host route 助手
解析 URL，因此 GUI 不在 `/` 上时同样可用。

### 数据与状态位置

| 路径 | 内容 | 覆盖方式 |
| --- | --- | --- |
| `%USERPROFILE%\.dsh\keil\state.json` | 每个工作区的用户工程选择 | `DSH_KEIL_STATE` |
| `%USERPROFILE%\.dsh\keil\config.json` | 机器级 UV4 路径 | `DSH_KEIL_CONFIG` |
| `%USERPROFILE%\.dsh\keil\backups\<工程名>\<时间戳>.uvprojx` | 修改前备份，保留最近 50 份 | 跟随状态目录 |
| `%USERPROFILE%\.dsh\keil\logs\<工程名>\<时间戳>-<模式>.log` | UV4 构建/下载日志 | 跟随状态目录 |

## 安全模型

- 只编辑 `.uvprojx` 里的**工程登记**；磁盘上的源文件、`.uvoptx`、目标文件和构建产物都不会被创建或删除（清理由
  `UV4 -c` 负责）。
- 每次修改前都先备份，新内容写入工程旁边的临时文件再 rename 覆盖，因此中断的运行不会留下写了一半的工程。
- 编辑是对原始文本的区间拼接，并有往返测试覆盖：先加后删可让文件字节级还原，保留 BOM、CRLF、注释和引号写法；格式错误的
  XML 会被拒绝，而不是猜测。
- 同一时间只允许一个构建；第二个请求报 `BUILD_BUSY`，因此不会有两个 UV4 进程同时写同一个工程。
- 插件绝不从扫描结果猜工程；未选择工程的工作区会明确报错。

## 故障排查

| 现象 / 错误码 | 原因 | 处理 |
| --- | --- | --- |
| `UV4_NOT_FOUND` | 自动发现没找到 `UV4.exe` | 运行 `dsh-keil doctor`，再执行 `set-uv4 --path …` 或设置 `DSH_KEIL_UV4` |
| `NO_PROJECT_SELECTED` | 该目录没有保存过选择 | 在面板中选择，或运行 `dsh-keil select`，或传 `--project` / `project` |
| `BUILD_BUSY` | 已有构建或下载在运行 | `dsh-keil build-status`；等待或执行 `build-stop` |
| `PROJECT_MISSING` | 选中的 `.uvprojx` 被移动或删除 | 重新选择；`clear-selection` 也可清除失效条目 |
| 已安装但没有 Keil 标签页 | `dsh-better-sidebar` 缺失或未挂载 | 安装 `dsh-better-sidebar@0.28.2` 并重启；工具与 CLI 本来就能用 |
| 安装后看不到插件 | profile 的插件列表在启动时读取 | 重启应用 / 重新启动 profile，然后在 Settings → Plugins 里确认 |
| `BAD_PROJECT_XML` / `FILE_MISSING` | 工程文件不是合法 XML，或路径不在磁盘上 | 用 uVision 重新保存；修正路径或使用 `--allow-missing` |

## 开发

```powershell
node --test test/core.test.mjs   # 14 个测试：解析、往返、选择、UV4 解析
npm run check                    # 对每个入口执行 node --check
npm run doctor                   # UV4 / 发现流程报告
```

```text
dsh-keil/
  package.json          DSH bundle 清单、bin、client 声明、engines
  cordis.patch.yml      在 profile 中挂载本插件的 bundle patch 行
  lib/core.mjs          发现、选择、uvprojx 解析/修改、构建管理、状态
  lib/index.js          host 端：`keil` 工具 + /keil HTTP 路由
  client/index.js       client 端：可选的语言字典 + 可选的侧边栏标签页
  bin/keil.mjs          JSON CLI（`dsh-keil`）
  test/core.test.mjs    自包含测试（临时目录，不碰真实用户状态）
  locale/{zh,en}.json   插件管理页的标题/描述
  scripts/install.mjs   零依赖安装/验证脚本
  docs/ARCHITECTURE.md  两半实现与核心如何协作
  AGENTS.md             给 AI agent 的安装/验证/修复 runbook
```

## 许可证与沿革

MIT——见 [LICENSE](LICENSE)。Copyright (c) 2026 wimi996123。

这套操作集合（工程组/文件登记、头文件路径、UV4 编译与下载、严格的 uvprojx 编辑）是对早期 Python `keil-tool` 的 Node.js
重写，并复现了它的行为：相同的相对路径解析、相同的 `FileType` 映射、相同的“先备份再原子写入”纪律。那个 Python 工具
**刻意不**纳入本仓库；这里的代码不会 import 或调用它。

## 范围与路线图

- 多 Target 工程只读写**第一个 Target**；其他 Target 名称只做只读展示。
- 编译与烧录**仅限 Windows**；工程查看与平台无关。
- 没有调试器集成：`download` 执行 `UV4 -f`，依赖工程里已经配好的调试器/Flash 算法。
- 只做登记修改——不创建源文件、不管理 MDK 器件包、不编辑编译选项。面板里以 `::` 开头的 RTE 组不提供删除按钮；CLI 没有
  这个限制。
- 后续方向：在同一套工具接口下支持其他工具链、调试/attach 操作，以及多 Target 编辑。
