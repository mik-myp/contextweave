# ContextWeave

ContextWeave（织境）是一个面向个人与团队场景的多内核浏览器工作台。它把浏览器环境、代理、内核、运行状态和本地任务集中到桌面客户端中，同时让实际网站访问运行在独立的浏览器进程和用户目录里。

[![CI](https://github.com/mik-myp/contextweave/actions/workflows/ci.yml/badge.svg)](https://github.com/mik-myp/contextweave/actions/workflows/ci.yml) [![Latest preview](https://img.shields.io/github/v/release/mik-myp/contextweave?include_prereleases&label=preview)](https://github.com/mik-myp/contextweave/releases)

## 项目状态

项目处于持续开发阶段。本节和下面的功能清单会随着实现、测试和发布结果更新；它们描述仓库当前可验证的能力，不代表尚未完成的路线图功能。

历史预览版本 `v0.1.0-alpha.5` 曾通过 Windows x64、macOS x64 和 macOS arm64 的 CI 构建；该结果不代表当前开发分支已完成发布验收。

当前可用界面：

- 桌面应用壳层、侧边栏、页面导航搜索及本地用户菜单。
- 简体中文 / English 界面语言切换。
- 主题 Drawer：浅色 / 深色 / 跟随系统、六个快捷色与自定义颜色、Auto / Sans / Serif 字体、圆角、密度、侧边栏形态、布局、内容宽度和方向。
- 界面缩放与减少动态效果；主题即时预览、本地保存和失败重试。

底层已有能力：

- 环境与代理的 contracts、IPC 服务、repository 和本地安全凭据保存。
- 独立浏览器用户目录、运行锁、生命周期管理及标准 Chromium / Chrome / Edge 探测。
- Kernel Registry、manifest 校验、内核 Adapter 和受限 Worker。

环境、代理、内核、指纹、活动、设置与关于页面目前是路由占位，业务界面正在重建。底层能力不代表这些页面已提供可操作的产品功能；后续将随交付逐项更新本清单。

`fingerprint-chromium` 目前只有 Adapter、配置 schema 和内核接入设计。其来源、下载地址、许可证、SHA-256、安全更新责任和跨平台启动矩阵完成核查前，不会作为 ContextWeave 的可下载或可分发内核。项目不承诺绕过验证码、风控、访问控制或平台限制。

### 主题设置的设计参考

ContextWeave 的主题设置在交互组织和视觉表达上参考了 [New API](https://github.com/QuantumNous/new-api) 项目，包括主题抽屉、分组设置、选项预览和即时切换等方向。ContextWeave 的实现代码、SVG 图形、CSS 样式和其他资源均由本项目独立编写，不复制 New API 的源代码、路径数据或资源。

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

项目会先完善个人本地闭环，再逐步扩展团队和自动化能力：

- 个人环境、代理、内核和运行可靠性。
- 本地备份恢复、导入导出、配置迁移和诊断。
- 自托管团队服务、成员权限、环境租约、同步和异常恢复。
- 工作流、网站功能测试、数据处理、业务连接器和 AI/RAG。

详细的产品边界、阶段计划和架构约束见[项目总体规划与技术方案](docs/project-plan.md)；每个阶段开始前都会根据实际进展更新该文档。

## 文档

- [项目总体规划与技术方案](docs/project-plan.md)：产品目标、阶段路线和总体架构。
- [技术栈与长期库选型](docs/technology-stack.md)：当前实现、后续技术路线和库替换条件。
- [项目开发规范](AGENTS.md)：目录、组件、代码质量、测试和协作规范。
- [桌面端说明与常用命令](apps/desktop/README.md)：桌面应用目录边界和命令。

## 参与开发

提交代码前请阅读 [AGENTS.md](AGENTS.md)，确认变更符合项目规划和技术栈路线。使用短期分支和 Pull Request，提交遵循 Conventional Commits，并在 Pull Request 中提供测试命令、结果和已知限制。

## 发布与许可

预览安装包目前不签名或公证；发布说明会提供支持平台、已知限制、SHA-256 和 SBOM。首次启动可能需要根据操作系统提示手动放行。

仓库当前没有 `LICENSE` 文件，因此尚未授予复制、修改或分发代码的默认许可。正式开源发布前，需要补充项目许可证，并审查第三方内核、字体、图标和依赖的许可证兼容性。
