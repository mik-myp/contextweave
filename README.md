# ContextWeave

ContextWeave（织境）是一个本地优先的浏览器环境工作台，面向需要长期保存和重复使用独立浏览器环境的个人与团队。它将环境配置、代理、浏览器内核和运行记录集中到桌面客户端，实际网站访问运行在独立浏览器进程和用户目录中。通过可选择发行版本的指纹内核、持久环境身份和认证代理提供个人使用闭环，后续扩展本地自动化接口与自托管团队能力。

[![CI](https://github.com/mik-myp/contextweave/actions/workflows/ci.yml/badge.svg)](https://github.com/mik-myp/contextweave/actions/workflows/ci.yml) [![Latest preview](https://img.shields.io/github/v/release/mik-myp/contextweave?include_prereleases&label=preview)](https://github.com/mik-myp/contextweave/releases)

## 项目状态

项目处于持续开发阶段。本节和下面的功能清单会随着实现、测试和发布结果更新；它们描述仓库当前可验证的能力，不代表尚未完成的路线图功能。

当前正式版本为 **v0.1.0**，对应标签 `v0.1.0`；历史 `v0.1.0-alpha.x` 标签保留。安装包通过 GitHub Actions 构建并发布到仓库 Releases。

当前可用界面：

- 桌面应用壳层、侧边栏、页面导航搜索及本地用户菜单。
- 环境列表：名称或 ID 搜索，状态/内核/代理多选筛选，表头排序与快速隐藏，列设置、数字页码导航、行选择、启动/停止及批量操作。
- 独立的新建与编辑环境页：名称、内核、代理、浏览器语言/时区/窗口设置；运行中只读、停止后编辑、未保存离开确认。
- 简体中文 / English 界面语言切换。
- 主题 Drawer：浅色 / 深色 / 跟随系统、六个快捷色与自定义颜色、Auto / Sans / Serif 字体、圆角、密度、侧边栏形态、布局、内容宽度和方向。
- 默认采用中性底色与用户强调色；密度分别调整控件、菜单、表单和内容间距。
- 界面缩放与减少动态效果；主题即时预览、本地保存和失败重试。

底层已有能力：

- 环境与代理的 contracts、IPC 服务、repository 和本地安全凭据保存。
- 独立浏览器用户目录、运行锁、生命周期管理及标准 Chromium / Chrome / Edge 探测。
- Kernel Registry、manifest 校验、内核 Adapter 和受限 Worker。

管理页面现已接通本地能力：

- 环境：单项删除、按当前筛选选择并批量启动／停止／删除；逐项报告失败，移入回收站时保留配置、历史和浏览器数据，支持单项及批量恢复。
- 代理：列表搜索、多选筛选、排序、列设置、分页，名称、新建／编辑 Dialog、单项和批量删除；新增、编辑与列表操作均可测试代理连接，显示 HTTPS 检测结果、延迟和出口 IP；检查环境引用与运行状态。密码由系统安全存储保护，可保留、替换或移除，不在列表和表单中回传。
- 内核：本机浏览器可用性、平台、可执行路径及能力证据。已观察到的 CDP 握手按可执行文件身份记录版本与时间；其余声明不自动标记为已验证。列表展示已安装的具体版本与发现的本机浏览器，独立安装入口从官方 Releases 选择版本；不支持的包不允许安装。
- 运行记录：浏览器会话和后台操作分区，记录开始/结束时间、配置修订、实际浏览器版本、操作阶段与结果。
- 能力说明已整合到内核详情，旧指纹能力路由重定向到内核页；指纹环境使用持久的 32 位身份种子与固定内核版本；能力证据按实际测试范围呈现。
- 设置（含关于）：本地数据路径、凭据状态、未关联数据目录和版本许可信息；主题 Drawer 和界面语言统一从右上角调整。

启动前会检查内核、代理连通性、凭据可读性、数据目录、剩余空间和运行锁；失败不自动切为直连。配置编辑具有修订冲突检查，草稿只保存非敏感表单字段。

批量操作只作用于当前筛选下选中的适用记录。隐藏选择不参与操作，失败项保留选择并显示原因；不会把部分失败显示为全部成功。

指纹内核使用 [adryfish/fingerprint-chromium](https://github.com/adryfish/fingerprint-chromium) 的官方发行包，下载时校验可信 SHA-256、归档路径及可执行架构，保留原包资源与许可。不同版本并存，已有环境不会自动切换到新版。当前推荐的 `148.0.7778.215` 支持 Windows x64 与 Apple Silicon Mac；Intel Mac 的管理端可使用本机标准 Chrome/Edge，当前没有已确认可用的该版本指纹包。上游源码公开可能滞后于二进制，项目不宣称已完成可复现构建验证。

HTTP、HTTPS 与带用户名/密码的 SOCKS5 均通过每次会话独立的本机代理桥接。上游密码只用于内存中的连接，使用远端 DNS，不会在代理失败时自动改为直连。项目不承诺绕过验证码、风控、访问控制或平台限制。

### 首次使用

1. 打开 **内核 → 安装内核**，选择内核类型（首版为 Fingerprint Chromium）和具体发行版本，下载并完成校验。也可切换到“下载链接”：官方链接自动识别，其他 HTTPS 来源需填写版本、可信 SHA-256，并确认许可。
2. 如需代理，在 **代理** 中新建配置并测试连接；支持 HTTP(S) 与 SOCKS5 认证。
3. 在 **环境 → 新建** 选择已安装的内核版本、代理、语言、时区和窗口大小，保存配置。
4. 启动环境后正常使用浏览器；停止并重新打开时，保留同一个身份种子、内核版本、Cookie 与网站存储。
5. 编辑前先停止环境。移入回收站会保留浏览器数据，恢复后可继续使用。

安装包目前未配置开发者签名和 macOS 公证。Windows、macOS 的系统安装提示与代码签名状态一致；这与浏览器内核包的 SHA-256 校验是两个独立事项。

### 主题设置的设计参考

ContextWeave 的主题设置在交互组织和视觉表达上参考了 [New API](https://github.com/QuantumNous/new-api) 项目，包括主题抽屉、分组设置、选项预览和即时切换等方向。ContextWeave 的主题实现代码、SVG 图形、CSS 样式和其他主题资源均由本项目独立编写，不复制 New API 的源代码、路径数据或资源。

管理页面、表格控件与 CRUD 组合改编自 [shadcn-admin](https://github.com/satnaing/shadcn-admin)，按 MIT 许可保留其版权与许可声明，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。共享组件适配 Base UI、TanStack Table v9、动态主题和双语界面；环境使用独立配置页，代理使用 Dialog。完整声明同时内置于应用的“系统设置 → 关于”页面。

## 快速开始

开发环境：

- Node.js `>=22.15.0 <23`
- pnpm `10.26.2`
- Windows x64、macOS x64 或 macOS arm64

从仓库根目录运行：

```bash
corepack enable
pnpm install
pnpm dev
```

常用命令：

```bash
pnpm check
pnpm --filter @contextweave/desktop exec electron-vite build
pnpm --filter @contextweave/desktop build:dir
```

`pnpm check` 会执行格式检查、ESLint、TypeScript 和 Vitest。首次运行开发命令时，桌面端会准备当前平台的 Electron 二进制。

## 工作方式

ContextWeave 将管理界面和实际浏览器访问分开：

```text
Electron 桌面客户端
├── Renderer：React/TypeScript + TanStack Router
├── Preload：类型化、白名单 IPC API
├── Main：窗口、SQLite、本地目录和进程协调
├── Worker：受限的 Playwright/CDP 任务
└── Kernel Registry/Adapter：独立浏览器内核接入
```

- Renderer 不直接访问 Node.js、文件系统、数据库或任意 IPC。
- Electron 自带 Chromium 只用于管理界面，不是指纹浏览器内核。
- 网站访问使用独立浏览器进程和独立用户目录。
- 本地 SQLite 使用 Node/Electron 内置的 `node:sqlite` `DatabaseSync`。
- 本地凭据使用 Electron `safeStorage`；代理密码不会进入命令行、URL、日志或普通配置。

## 仓库结构

```text
apps/desktop/
├── electron/       # Main、Preload、Worker 和 Electron 构建入口
└── src/
    ├── app/        # 应用壳层
    ├── routes/     # TanStack Router 文件路由
    ├── features/   # 环境、代理、内核、设置等领域页面
    └── shared/     # 跨页面配置和通用代码

packages/
├── contracts/              # 跨进程数据和运行时 schema
├── storage/                # SQLite repository
├── kernel-core/            # 内核注册和适配器边界
├── kernel-standard-chromium/
├── kernel-fingerprint-chromium/
└── worker-protocol/        # Worker 消息协议
```

## 发展路线

项目先完善可验证的个人使用闭环，再扩展自动化和团队能力。v0.1.0 对应当前实现范围，其余阶段是后续路线：

| 阶段      | 重点                                                       |
| --------- | ---------------------------------------------------------- |
| v0.1.0    | 指纹内核按版本安装、稳定环境身份、认证代理、运行闭环与恢复 |
| v0.2      | 分组标签、配置复制、模板、更多指纹选项与网络诊断           |
| v0.3      | 回收站、快照、导入导出与兼容性预检                         |
| v0.4      | 与界面共用业务命令的 Local API、CLI/MCP                    |
| v1.0      | 个人稳定版、平台与升级/恢复验收                            |
| v1.1–v1.2 | 自托管团队、权限审计，再到受控的跨设备数据交接             |
| v1.3 以后 | 工作流、网站测试、数据处理与按需求加入的 AI/RAG            |

多内核通过独立 Adapter 扩展，每个提供方单独验证。个人稳定版不等待所有内核和团队功能完成。现有主题 Drawer、表格与独立环境配置页继续保留。

产品结构、参考项目、领域模型、版本验收和迁移顺序见[项目总体规划与技术方案](docs/project-plan.md)；技术与库的采用条件见[技术栈与长期库选型](docs/technology-stack.md)。

## 本地浏览器验证

构建后可运行桌面端回归：

```bash
pnpm --filter @contextweave/desktop exec electron-vite build
pnpm test:desktop --require-native
```

它使用临时用户目录启动真实 Electron，检查沙盒桥接、环境创建/重开、运行互斥、回收与恢复。`--require-native` 要求本机存在支持的 Chrome/Edge/Chromium；不传该参数时，无浏览器会明确报告跳过原生运行检查。

指纹内核的实际安装与运行验收：

```bash
pnpm test:fingerprint --require-provider
# 可选：使用已知发行包验证自定义下载链接路径
pnpm test:fingerprint --require-provider --custom-source
```

此测试会从官方来源下载指定的已核查发行包，在隔离用户目录中安装，验证实际启动、固定身份、页面存储、认证代理和回收恢复，结束后清理。Windows x64 与 macOS arm64 发布构建执行该测试；未支持的架构不得当作通过。

可以对已批准使用的本机 Chromium 浏览器执行可重复的本地探测：

```bash
node scripts/verify-browser.mjs --executable /path/to/browser --output /tmp/browser-report.json
```

脚本不下载内核，只访问回环地址中的测试页面，使用临时目录验证两次启动的观测参数和页面存储保留情况，并输出可执行文件 SHA-256。结果是限定范围内的观察，不能当作指纹防护效果或提供方已通过发布验收。

## 文档

- [项目总体规划与技术方案](docs/project-plan.md)：产品目标、阶段路线和总体架构。
- [技术栈与长期库选型](docs/technology-stack.md)：当前实现、后续技术路线和库替换条件。
- [项目开发规范](AGENTS.md)：目录、组件、代码质量、测试和协作规范。
- [桌面端说明与常用命令](apps/desktop/README.md)：桌面应用目录边界和命令。

## 参与开发

提交代码前请阅读 [AGENTS.md](AGENTS.md)，确认变更符合项目规划和技术栈路线。使用短期分支和 Pull Request，提交遵循 Conventional Commits，并在 Pull Request 中提供测试命令、结果和已知限制。

## 发布与许可

预览安装包目前不签名或公证；发布说明会提供支持平台、已知限制、SHA-256 和 SBOM。首次启动可能需要根据操作系统提示手动放行。

仓库当前没有 `LICENSE` 文件，因此尚未授予复制、修改或分发代码的默认许可。本次提供应用安装包不等于新增源代码再许可；第三方依赖和浏览器各自的许可声明见上方说明及 THIRD_PARTY_NOTICES。
