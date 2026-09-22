# ContextWeave 技术栈与长期库选型

**项目名称：ContextWeave（织境）**  
**定位：开源、可自托管、面向个人与团队的多内核浏览器工作台**  
**文档日期：2026-09-21**

本文档定义 ContextWeave 从个人环境管理到团队协作、浏览器自动化、数据处理和 AI/RAG 的长期技术边界。它不是要求第一天安装所有依赖，而是提前确定哪些接口必须稳定、哪些库在进入相应阶段时再加入。

## 1. 选型原则

### 1.1 先稳定边界，再增加库

核心边界必须独立于桌面框架、浏览器内核和 AI 供应商：

- 浏览器内核通过 Kernel Registry、Kernel Adapter 和 Browser Runtime 接入。
- 工作流通过版本化 Workflow Schema 和确定性执行器运行。
- 个人与团队通过资源、事件、版本和租约接口连接。
- AI 通过受控 Tool Schema 调用浏览器、文件、HTTP 和数据工具。
- React 只负责界面，长任务由 Main、本地 Worker 或服务端 Worker 执行。

### 1.2 首期少依赖，后期按功能加入

首期只需要 Electron、React、TypeScript、SQLite、浏览器进程管理和基础团队 API。React Flow、Playwright、数据处理、队列、LangGraph 和向量库应在对应功能进入开发阶段时加入。

### 1.3 TypeScript 为主，Python 作为可选专用 Worker

主产品使用 TypeScript，减少客户端、服务端、工作流和 AI 之间的类型转换。Python 只用于 JS 生态不适合的 OCR、复杂文档解析、数据科学或特定浏览器内核，不作为普通用户的前置安装依赖。

### 1.4 不把桌面 WebView 当作指纹内核

Electron 自带 Chromium 只渲染管理界面。访问网站时使用独立浏览器进程、独立用户目录和内核专属适配器。任何 JavaScript 指纹注入库都不能替代真正的浏览器内核能力。

### 1.5 可自托管和可迁移

团队服务必须可以使用 Docker Compose 部署。数据库使用 PostgreSQL，对象存储使用 S3 兼容接口；不能把产品核心绑定到某一家云厂商。

## 2. 推荐总体架构

```text
contextweave/
├── apps/
│   ├── desktop/                 # Electron + React 桌面客户端
│   ├── server/                  # 自托管团队 API 服务
│   ├── web/                     # 后期的 Web 管理界面，可复用 UI 和 API Client
│   ├── worker-browser/           # 浏览器自动化和工作流 Worker
│   ├── worker-ai/               # LangChain/LangGraph/RAG Worker
│   └── worker-python/            # 可选的 OCR、文档和数据科学 Worker
├── packages/
│   ├── contracts/                # Zod 契约、JSON Schema、事件和权限模型
│   ├── workflow-schema/          # 工作流节点和版本迁移
│   ├── browser-control/          # 与具体内核无关的浏览器控制接口
│   ├── kernel-registry/          # 内核 manifest、下载、校验和注册
│   ├── kernel-adapters/          # Chromium、Camoufox 等适配器
│   ├── env-core/                 # 环境目录、运行锁、快照和本地状态
│   ├── db-local/                 # SQLite schema 和迁移
│   ├── db-server/                # PostgreSQL schema 和迁移
│   ├── api-client/               # 服务端 API Client
│   ├── ui/                       # shadcn/ui 的共享组件
│   ├── config/                   # ESLint、TypeScript、Vitest 等共享配置
│   └── observability/            # 日志、事件和追踪接口
├── deploy/
│   ├── docker-compose.yml        # PostgreSQL、对象存储和团队服务
│   └── migrations/
└── docs/
```

实际实现可以先只有 `apps/desktop` 和 `packages/contracts`，目录结构不代表需要一次性创建所有应用。

## 3. 依赖分层

| 层级 | 首选技术 | 进入阶段 | 主要边界 |
|---|---|---:|---|
| 包管理 | pnpm workspaces | v0.1 | 统一锁文件和脚本 |
| 任务编排 | Turborepo | v0.1 多包后 | 只负责构建缓存，不承载业务逻辑 |
| 语言 | TypeScript strict | v0.1 | 所有跨进程数据必须运行时校验 |
| 桌面 | Electron | v0.1 | 管理界面、本地协调和受控 IPC |
| UI | React + Vite + shadcn/ui | v0.1 | 只做展示和用户交互 |
| 本地数据 | SQLite + Drizzle ORM | v0.2 | 环境元数据和本地设置 |
| 浏览器控制 | 自有 Browser Control API + Playwright/CDP 适配 | v0.1/v1.1 | 不暴露具体内核参数给业务层 |
| 团队 API | NestJS + Fastify adapter + Zod | v0.4 | 模块化单体、REST/OpenAPI、自托管和客户端兼容 |
| 团队数据库 | PostgreSQL + Drizzle ORM | v0.4 | 租约、版本、权限和审计 |
| 对象存储 | S3 API + MinIO 开发环境 | v0.4/v0.5 | 快照、附件、报表和日志产物 |
| 队列 | PostgreSQL + pg-boss | v0.5/v1.4 | 初期不额外引入 Redis |
| 工作流 | 自有 Workflow Schema + TypeScript Executor | v1.1 | 确定性执行、重试和审计 |
| 流程画布 | React Flow（`@xyflow/react`） | v1.2 | 只负责编辑和布局 |
| AI | LangChain.js + LangGraph.js | v1.6 | 通过 Tool Gateway 调用能力 |
| RAG | PostgreSQL + pgvector | v1.6 | 先复用团队数据库，规模增加再拆分 |
| 测试 | Vitest + Playwright Test + Testcontainers | v0.1 起分层加入 | 单元、浏览器、服务和桌面测试 |

## 4. Monorepo 与开发工具

### 4.1 包管理和构建

推荐：

- **pnpm workspaces**：依赖安装快，支持 workspace 协议，适合 Electron、服务端和共享包。
- **Turborepo**：在多应用出现后提供任务依赖、缓存和并行构建。
- **Changesets**：共享包和协议发生版本变化时生成变更记录；客户端整体发布仍由 GitHub Release 控制。
- **Node.js LTS**：使用 `.nvmrc` 或 Volta 固定主版本，CI 和本地保持一致。

不建议第一天使用 Nx、Bazel 或自建构建系统。它们可以解决更大规模问题，但会增加前期认知成本。

### 4.2 TypeScript 配置

- 开启 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`。
- 使用 project references 或统一的 `tsconfig.base.json`。
- 跨进程消息、数据库 JSON 和 API 输入都必须经过 Zod 运行时校验。
- 共享包只导出稳定的类型和函数，不直接依赖 Electron、NestJS/Fastify 或 React 具体实现。

### 4.3 代码质量

推荐组合：

- **ESLint**：代码规则和危险 API 检查。
- **typescript-eslint**：TypeScript 规则。
- **Prettier**：格式统一。
- **lint-staged + Husky**：提交前执行轻量检查，可选加入。
- **Commitlint**：多人协作时使用 Conventional Commits。
- **Vitest**：单元测试和契约测试。

v0.1 的正式 `pnpm check` 门禁为 Prettier（本次维护的 Renderer/Main/Preload 文件）、ESLint、TypeScript 和 Vitest。Oxlint/Oxfmt 只在后续独立试运行中评估，不替换当前 Electron 根链路；Vite+ 仍不作为桌面应用根脚手架。

格式化和 lint 不能替代代码审查。不要为了通过规则在 Renderer 中放宽 Electron 安全检查。

## 5. Electron 桌面客户端

### 5.1 基础库

首选：

- **Electron**：窗口、托盘、生命周期、IPC、文件选择和外部进程协调。
- **Vite + React + TypeScript**：管理界面构建。
- **electron-vite**：提供 Main、Preload、Renderer 和后续 Worker 的 Vite/Rollup 构建与开发体验。当前稳定 5.x 的 peer 依赖支持 Vite 5/6/7；官方 React/TypeScript 模板当前使用 Vite 7 系列，不追求未经适配的 Vite 8。
- **React + `@vitejs/plugin-react`**：管理界面和 Fast Refresh。
- **electron-builder**：Windows NSIS、macOS DMG、Linux AppImage/deb、`extraResources`、`asarUnpack` 和 GitHub Release 产物。
- **electron-log**：本地日志滚动、日志目录和崩溃前诊断。
- **@electron/rebuild**：better-sqlite3、keytar 等原生模块在 Electron 目标 ABI 下重建；每个操作系统和 Electron major 都要在 CI 验证。
- **electron-updater**：后期再加入；未签名发布阶段先使用 GitHub Release 手动下载。

`Electron Forge + @electron-forge/plugin-vite` 是官方替代方案，适合更看重 make/publish 一体化的项目；其 Vite 插件和 Monorepo/native module 组合需要锁定版本并单独验证。ContextWeave 当前选择 `electron-vite + electron-builder`，因为外部内核资源、多入口 Worker、原生 SQLite 模块和自托管发布需要更细的打包控制。两套方案只选一套，不能同时维护两套发布链路。

### 5.2 Renderer 层

推荐：

- **React**：页面和组件。
- **TanStack React Router (`@tanstack/react-router`)**：桌面端文件路由、类型化 params/search、loader 和权限前置校验。
- v0.1 当前使用 TanStack Router File-based Routing：通过 `@tanstack/router-plugin/vite` 生成 `src/routeTree.gen.ts`，Renderer 使用 `createRouter` + `RouterProvider`，Electron 打包页面使用 `createHashHistory`，避免 `file://` 路径回退问题。菜单只负责导航到 route，不再维护手工 `page` 状态。
- **shadcn/ui + Base UI**：当前官网默认的可复制、可调整无障碍组件基线；Radix 作为兼容现有项目的可选基础，不作为 ContextWeave v0.1 的 UI primitive。
- **shadcn CLI 当前 `cn` 工具**：组件源码使用 CLI 当前生成的 `cn` 依赖和 Tailwind class 合并方式；不要再单独维护一套旧的 `cn` 工具实现。
- **Tailwind CSS**：布局和主题。
- **主题系统**：以 shadcn/Base UI CSS variables 为唯一主题边界；第一版支持主题模式、颜色预设、圆角、密度、字体和官方 Sidebar 布局变体，主题配置需要版本化并通过受限设置接口持久化，不在组件内散落颜色值。
- **Lucide React**：图标。
- **TanStack Query**：服务端状态、缓存、请求重试和失效。
- **Zustand**：工作空间选择、侧边栏、弹窗等轻量 UI 状态。
- **React Hook Form + Zod Resolver**：复杂表单和运行时校验。
- **TanStack Table**：环境、成员、代理和审计表格。
- **Sonner**：轻量通知。
- **date-fns**：需要日期计算或复杂时区处理时按功能引入；当前 Base UI Calendar 组件使用原生 `Intl`，桌面端暂不保留未使用的直接依赖。
- **i18next + react-i18next**：中文、英文和后续出海地区的界面国际化；业务数据和日志不依赖界面语言。

本次官网核查（2026-09-21）记录：shadcn/ui 的 [Base UI 默认变更说明](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default)说明新项目默认使用 Base UI，同时继续支持 Radix；[组件手册](https://ui.shadcn.com/docs/components/accordion)的 Base UI 版本使用 `@base-ui/react`。React Router 的[声明式安装文档](https://reactrouter.com/start/declarative/installation)当前使用 `react-router` 包，因此项目不保留未使用的 `react-router-dom` 声明。

不建议同时使用 Redux、MobX、Zustand 和多个请求状态库。推荐 TanStack Query 管服务端状态，Zustand 管界面状态。

### 5.3 Preload、Main 和 IPC

- `contextIsolation: true`。
- Renderer sandbox 开启。
- `nodeIntegration: false`。
- Preload 只暴露白名单 API，不暴露整个 `ipcRenderer`、`fs` 或 `child_process`。
- IPC 参数统一使用 `packages/contracts` 中的 Zod schema 校验。
- 不允许远程网站页面加载进拥有本地能力的窗口。
- 外部浏览器窗口和管理界面窗口分离，不能共享 Electron session。

IPC 方法应接近领域操作，例如 `environment.start`、`kernel.install`、`team.acquireLease`，不要暴露 `runCommand` 这种无边界接口。

### 5.4 本地任务与进程

- **execa**：启动 Worker、内核安装器和诊断命令，统一 stdout、stderr、超时和退出码。
- Node.js `child_process.spawn`：需要长期控制的浏览器进程使用原生 API，以便保存 PID、stdio 和取消信号。
- **proper-lockfile** 或基于独占文件句柄的实现：本地环境运行锁。
- `AbortController`：取消启动、下载、同步和工作流任务。
- **pino**：Worker 和服务端结构化日志；Electron 日志通过 electron-log 适配。

所有长任务必须有任务 ID、阶段、进度、取消和恢复状态，不能绑定 React 组件生命周期。

### 5.5 项目初始化方案

五种方案的定位不同：

| 方案 | 评价 | 结论 |
|---|---|---|
| 先用裸 Vite，再手工接 Electron | 需要自己处理 Main、Preload、Renderer、HMR、打包、资源和原生模块 | 不推荐作为首个正式项目 |
| `electron-vite` React/TypeScript 模板 | Main/Preload/Renderer 已分开，React 开发体验好，配合 electron-builder 可以精细处理 Worker、native module 和外部内核资源 | 当前推荐 |
| Vite+ `vp create vite -- --template react-ts` 后手工接 Electron | 统一 Web 工具链和 Vite 8/Rolldown/Oxc/Vitest/Vite Task；目前是 Beta，没有 Electron 入口、IPC、原生模块重建或安装包发布集成 | 暂不作为桌面根脚手架 |
| 先用 shadcn Vite 模板，再接 Electron | shadcn 只是组件和样式初始化工具，不是 Electron 架构脚手架 | 不推荐作为根项目生成器 |
| Electron Forge Vite/TypeScript 模板 | 官方 Electron 流程，适合 make、publish 和 GitHub Release，但 Vite 插件与复杂 Monorepo 需要额外验证 | 官方备选 |

初始化顺序：

1. 使用 `electron-vite` 的 React/TypeScript 模板创建 `apps/desktop`。
2. 在 Renderer 中加入 React、`react-router` 和 React Hook Form。
3. 运行 shadcn CLI 初始化 Tailwind 和组件；初期组件放在桌面应用，WebUI 出现后再抽到 `packages/ui`。
4. 将桌面应用接入 pnpm workspace 和 Turborepo。
5. 创建 `packages/contracts`、`packages/kernel-protocol`、`packages/config` 和 `packages/ui` 的最小版本。
6. 创建 `apps/api`，使用 NestJS + Fastify adapter；桌面端先通过 mock API 或本地 adapter 验证界面。

典型创建命令由当前 CLI 版本决定，建议使用交互式命令并选择 React + TypeScript 模板；如果 CLI 的包名或参数发生变化，以其当前帮助信息为准：

```bash
pnpm create electron-vite@latest
# 选择 React / TypeScript 模板，项目目录使用 apps/desktop

cd apps/desktop
pnpm add react react-dom react-router react-hook-form zod @hookform/resolvers
pnpm dlx shadcn@latest init
```

如果当前 `electron-vite` 或 electron-builder 在某个 Electron major 上出现兼容问题，再评估 Electron Forge；不要回到裸 Vite 手工拼接，也不要在同一发行链路中混用 Forge 和 electron-builder。无论选择哪套脚手架，Electron Main 只做窗口、IPC 和本地运行时编排，外部浏览器内核仍由独立进程启动。

### 5.6 Vite+ 的定位与采用策略

[Vite+](https://viteplus.dev/) 是 VoidZero 的统一 Web 工具链。官方当前网站和公告将其标为 Beta；本次核查到的 Vite+ 版本为 0.3.x，核心工具链包含 Vite/Rolldown、Vitest、Oxlint/Oxfmt、tsdown 和 Vite Task。官方文档列出的能力包括：

- `vp create`：创建 Vite 应用、Monorepo 或库。
- `vp dev`、`vp build`：Vite/Rolldown 开发和构建。
- `vp check`：Oxlint、Oxfmt 和类型检查。
- `vp test`：Vitest。
- `vp run`：Vite Task 的任务依赖和缓存。
- `vp pack`：通过 tsdown 打包库或 Node 独立可执行文件。
- `vp env`、`vp install`：运行时和包管理协助。

当前 `electron-vite` React/TypeScript 模板并不等于“最新 Vite”：本次核查的模板依赖为 `electron-vite` 5.x、Vite 7.x；`electron-vite` 6.0.0-beta.1 才将 Vite 8 列入 peer 依赖，属于预发布版本。稳定的 Vite 7 组合对于 Electron 应用已经足够，Vite 主版本不是必须追新的功能。

Vite+ 的 `vp create vite -- --template react-ts` 可以生成 Web React 项目，但当前没有 ContextWeave 所需的 Electron Main、Preload、IPC、安全窗口配置、原生模块 ABI 重建、`extraResources`/`asarUnpack` 或安装包发布流程。`vp pack` 也不是 Electron 安装包打包器；它主要面向库和 Node 独立可执行文件。

因此当前策略是：

1. 桌面应用使用 `electron-vite + electron-builder`，版本固定在经过验证的稳定组合。
2. Vite+ 暂不作为 `apps/desktop` 的根脚手架，也不与 electron-vite 同时接管同一个桌面入口。
3. 可以在未来 WebUI 或独立共享包中试用 Vite+，也可以在 Vite+ 达到稳定版本后评估 `vp check`、`vp test` 和 `vp run`。
4. 如果将 Vite+ 与 Electron Forge v8 的 Vite 插件组合，必须作为独立实验分支验证；不要直接把 Beta 工具链用于主发布链路。Forge v8.0.0-alpha.10 的 `@electron-forge/plugin-vite` 已面向 Vite 8，并支持多个 build 入口（Main、Preload、Worker 等），但插件 README 明确写着 experimental、没有 API 稳定性保证；alpha.10 本身也是预发布版本。因此它适合做 Vite 8 兼容性实验，不适合作为当前首个正式发布基线。

这不是因为 Vite+ 不能编译 JavaScript，而是因为它解决的是 Web 工具链统一问题，Electron Forge/electron-builder 解决的是桌面运行时和安装包发布问题。两者职责不同。

### 5.7 本次核查资料

- [Vite+ 官方首页](https://viteplus.dev/)
- [Vite+ Creating a Project](https://viteplus.dev/guide/create)
- [Vite+ Pack](https://viteplus.dev/guide/pack)
- [Vite+ Monorepo Guide](https://viteplus.dev/guide/monorepo)
- [electron-vite v5 README](https://github.com/alex8088/electron-vite/tree/v5.0.0)
- [electron-vite React/TypeScript 模板](https://github.com/alex8088/quick-start/tree/master/packages/create-electron/playground/react-ts)
- [Electron Forge v8.0.0-alpha.10 Release](https://github.com/electron/forge/releases/tag/v8.0.0-alpha.10)
- [Electron Forge v8 plugin-vite README](https://github.com/electron/forge/blob/v8.0.0-alpha.10/packages/plugin/vite/README.md)
- [NestJS Performance（Fastify）](https://docs.nestjs.com/techniques/performance)

## 6. 浏览器内核与自动化库

### 6.1 Kernel Registry

内核注册、下载和校验属于独立模块。推荐使用：

- **Zod**：Kernel Manifest 和内核专属配置 Schema。
- Node.js `fetch`/`undici`：HTTP 下载。
- Node.js `crypto`：SHA-256 校验和随机令牌。
- **extract-zip** 与 **tar**：按清单解压，并自行做路径穿越检查。
- **get-port**：为 CDP 或内核专用调试端口分配端口。
- **pidusage**：进程资源诊断。

下载流程：解析 manifest → 校验平台和架构 → 下载临时文件 → SHA-256 校验 → 原子移动 → 记录版本和来源。不能下载后直接执行未校验的压缩包。

### 6.2 Browser Control API

业务层只依赖统一接口，例如：

```ts
interface BrowserSession {
  pages(): Promise<PageRef[]>;
  openPage(url: string): Promise<PageRef>;
  click(target: LocatorSpec, options?: ClickOptions): Promise<void>;
  fill(target: LocatorSpec, value: string, options?: FillOptions): Promise<void>;
  extract(spec: ExtractSpec): Promise<unknown>;
  screenshot(options?: ScreenshotOptions): Promise<ArtifactRef>;
  close(): Promise<void>;
}
```

具体库通过 Adapter 接入：

- **Playwright Core**：优先用于支持 Playwright 协议或 CDP 连接的 Chromium 内核。使用 `playwright-core` 避免自动下载另一套浏览器。
- **Chrome DevTools Protocol**：对于 Playwright 未覆盖的内核能力，使用 `chrome-remote-interface` 或自有 CDP client。
- **Camoufox Adapter**：以 Camoufox 官方支持的控制协议为准；如果 Node.js 不能直接连接，则由独立 Python/协议 Worker 提供适配，不污染通用接口。
- **标准 Chromium/Chrome/Edge Adapter**：只使用实际支持的 CDP 能力，不假设这些浏览器具有 fingerprint-chromium 的专属参数。

不能在业务代码中写 `if kernel === "camoufox"`。内核专属参数只在 Adapter 和 manifest 中出现。

### 6.3 指纹与环境配置

不引入一个“通用指纹 npm 包”来伪装所有特征。配置分为：

- 通用配置：代理、语言、时区、窗口、启动页、扩展、数据目录。
- 内核配置：平台、硬件并发、Canvas、Audio、WebGL、字体和特定启动参数。
- 能力声明：CDP、文件上传、截图、iframe、Shadow DOM、下载等。

每个内核单独维护版本、参数 schema、数据目录兼容范围、能力签名和回归测试。内核升级必须先备份，再做启动、代理/DNS 泄漏、跨 iframe/Worker 和用户目录兼容测试。

## 7. 本地环境与数据层

### 7.1 SQLite

推荐：

- **SQLite**：个人模式的本地元数据。
- **better-sqlite3**：同步调用简单、性能稳定；需要配合 Electron 原生模块重建。
- **Drizzle ORM**：类型安全、SQL 透明、迁移可控。
- **drizzle-kit**：生成和执行 schema migration。

数据库保存环境元数据、内核绑定、代理引用、任务状态、备份索引和本地设置。浏览器用户目录仍是独立文件资源，不能把整个用户目录塞进 SQLite。

v0.1 的实际实现因 Windows 开发环境无法完成 `better-sqlite3` 的 Electron ABI rebuild，暂时使用 Electron/Node 内置 `node:sqlite` `DatabaseSync`；Drizzle schema 保留用于长期 schema 表达和后续替换评估。具体取舍和退出条件记录在 [ADR 0001](adr/0001-local-sqlite-runtime.md)。

### 7.2 本地凭据

- 小型本机密钥优先使用 Electron `safeStorage`。
- 需要跨应用共享凭据时再评估 **keytar**，同时考虑原生模块发布和系统钥匙串差异。
- 不在日志、工作流 JSON、崩溃报告和普通 SQLite 字段中保存明文代理密码或 Cookie。

### 7.3 环境快照

环境快照需要独立资源模型：

- 元数据：SQLite/PostgreSQL。
- 大文件：对象存储或本地快照目录。
- 内容校验：SHA-256 或内容寻址哈希。
- 敏感快照可选客户端加密：使用 Web Crypto 或 **libsodium-wrappers** 的标准 AEAD，采用信封密钥设计；不自创加密算法。默认不上传 Cookie 和网站会话，用户明确启用后才进入加密同步流程。
- 上传：临时文件、分片、断点续传和最终提交。
- 恢复：校验清单、解压到临时目录、原子切换、失败回滚。

早期可使用 `tar`/`zlib`，规模增加后再引入 zstd、分块去重或专门快照服务。不要在第一版就实现复杂的全量增量算法。

## 8. 自托管团队服务端

### 8.1 Web/API 框架

推荐：

- **NestJS**：团队 API 的模块化单体框架，适合认证、成员、环境、租约、快照、审计和任务模块。
- **@nestjs/platform-fastify**：让 NestJS 使用 Fastify HTTP adapter，保留较低开销和插件生态。
- **@nestjs/config**：环境变量和服务配置管理。
- **Zod + nestjs-zod**：请求、响应、配置和事件校验；共享 `packages/contracts` 中的 schema。
- **@nestjs/swagger** 或 **zod-to-openapi**：生成 OpenAPI；二者只选择一种主要生成路径，避免重复维护 DTO。
- **openapi-typescript** + **openapi-fetch**：从服务端契约生成轻量 API Client，避免桌面端和 Web 端手写请求类型。
- **@fastify/helmet**、**@fastify/cors**、**@fastify/rate-limit**：通过 Fastify adapter 注册基础安全插件。
- **@fastify/multipart**：仅在服务端需要接收文件时启用；大型文件优先走对象存储预签名 URL。
- **jose**：JWT/JWE 等标准令牌。
- **argon2**：密码哈希。
- **nestjs-pino**：Nest 模块中的结构化日志。
- **@nestjs/terminus**：健康检查和依赖状态。
- **openid-client**：后期接入自建 OIDC/企业 SSO。

NestJS 只用于 `apps/api` 的服务端模块，不用于 Electron Main、浏览器 Adapter 或 Worker。API 采用模块化单体，不在首期拆微服务；所有模块复用 REST + OpenAPI、Zod、domain 层和 `packages/contracts`。如果未来确实需要极简边缘 API，可以单独评估 Fastify/Hono，但不能同时维护两套团队 API。GraphQL、tRPC 可以作为局部方案研究，但不作为首期公共协议。

### 8.2 PostgreSQL

推荐：

- **PostgreSQL**：团队成员、角色、环境元数据、租约、版本、审计和任务索引。
- **pg**：Node.js PostgreSQL 驱动。
- **Drizzle ORM**：schema、事务和迁移。
- PostgreSQL 原生事务、`SELECT ... FOR UPDATE`、唯一约束和 `SKIP LOCKED`：租约和版本并发控制。
- 租约记录必须包含 `expiresAt`、心跳、`revision` 和单调递增的 `fencingToken`；所有提交都校验 fencing token，并使用 `If-Match`/幂等键防止旧客户端覆盖新版本。
- PostgreSQL `jsonb`：保存版本化配置和节点参数，但关键字段仍应有正式列和索引。

服务端所有租约、版本提交和权限变化必须在事务内完成。不能用一个内存 `running` 字段解决团队接力。

### 8.3 认证、权限与审计

首期：

- 账号、密码、刷新令牌或设备令牌。
- Argon2id 密码哈希。
- 短期 access token + 可撤销 refresh token。
- 团队、成员、角色、环境访问策略。
- 所有环境接管、提交、恢复、删除和权限变化写入审计日志。

后期：

- OIDC/企业 SSO。
- SCIM 用户同步。
- 更细粒度的 ABAC 条件。
- 管理员强制释放租约和设备撤销。

权限逻辑应放在服务端 domain/policy 层，不散落在 React 菜单判断中。客户端隐藏菜单只是体验优化，不是安全边界。

### 8.4 对象存储

推荐：

- **AWS SDK for JavaScript v3** 的 S3 Client。
- 本地开发和自托管示例使用 **MinIO**。
- 生产环境支持 AWS S3、Cloudflare R2、Ceph 或其他 S3 兼容服务。
- 使用预签名 URL 上传和下载大型快照、截图、报表及日志产物。

服务端数据库只保存对象 key、大小、哈希、版本、归属和生命周期状态，不保存大型二进制内容。

### 8.5 队列与调度

首选分阶段：

- v0.4：同步 API 直接处理小任务。
- v0.5/v1.4：**pg-boss**，复用 PostgreSQL，处理快照、通知和定时任务。
- 大规模执行节点出现后：评估 **BullMQ + Redis** 或 Temporal。
- 需要长时间、可检查点、跨服务工作流时：评估 **Temporal**，但不在首期引入。

队列任务必须幂等，有任务版本、租约、重试次数、退避和死信状态。

## 9. 工作流与自动化

### 9.1 工作流协议

工作流定义使用带版本的 JSON Schema：

- `workflowId`、`version`、`nodes`、`edges`。
- 每个节点有稳定 `type`、输入 schema、输出 schema和 capability 要求。
- 节点参数使用 Zod 校验后再转换为 JSON Schema。
- 保存迁移函数，不直接修改历史工作流结构。
- 工作流运行、节点运行和产物都拥有独立 ID。

React Flow 只负责画布编辑。它的内部节点格式不能直接作为服务端执行协议。

### 9.2 执行器

推荐库：

- **React Flow（`@xyflow/react`）**：画布。
- **XState**：运行状态、暂停、取消、人工确认等状态机；不让 XState 替代整个 DAG 数据模型。
- **p-queue**：并发限制。
- **p-retry**：带退避的可重试操作。
- **p-timeout** 或 AbortSignal：节点超时。
- **cron-parser**：解析定时表达式。
- **jsonata**：受控字段映射和表达式计算。
- **jmespath**：JSON 数据查询，可按需加入。

执行器必须支持：节点日志、输入输出摘要、重试、超时、取消、暂停、恢复、人工确认、失败分支和产物引用。

### 9.3 脚本节点

默认不在 Electron Renderer 或 Main 直接执行用户提供的任意 Node.js 代码。

分级策略：

1. 内置表达式：jsonata/jmespath，无文件和网络权限。
2. 受限 JavaScript：使用 **quickjs-emscripten** 或独立沙箱 Worker，仅暴露显式变量和工具。
3. 高权限脚本：单独进程或容器执行，明确显示权限和风险；团队管理员可禁用。

用户脚本必须有超时、内存限制、日志截断和取消机制。不能通过 `eval`、Renderer 注入或未限制的 `child_process` 实现脚本功能。

## 10. 电商、数据采集和报表能力

### 10.1 HTTP 与网页数据

- **undici**：服务端和 Worker 的 HTTP 请求。
- **Crawlee**（后期）：在需要队列、会话池、持久化请求队列和采集生命周期时使用 `@crawlee/playwright`；简单任务仍直接使用 Browser Control API，避免一开始绑定完整爬虫框架。
- **cheerio**：静态 HTML 解析。
- Playwright/CDP：需要真实浏览器、登录态、滚动或动态渲染时使用。
- **robots-parser**、限速器和域名策略：采集任务按站点配置速率和范围。
- **p-queue**：并发和限速；失败项进入可重试队列。

HTTP 数据采集不能绕过站点权限、验证码或服务条款。产品提供的是用户授权下的浏览器自动化和数据处理能力。

### 10.2 CSV/XLSX 和数据转换

- **csv-parse/csv-stringify**：CSV 解析和写出。
- **ExcelJS**：XLSX 读写、工作表和格式处理。
- **Papa Parse**：浏览器端小型 CSV 处理，可选。
- **Zod**：导入数据行和输出数据集校验。
- **decimal.js**：价格、税率和币种金额计算，避免 JavaScript 浮点误差。
- **date-fns-tz**：跨时区日期处理。
- **DuckDB**（后期）：订单、商品和采集结果需要本地聚合或大于内存时使用；通过 Parquet/CSV/JSONL 与对象存储交换数据，不作为首期事务数据库。

金额、币种、订单号、SKU 和日期应在数据模型中有明确类型和来源字段，不能只保存格式化后的字符串。

### 10.3 文件产物

统一使用 Artifact 模型记录：文件 ID、类型、大小、哈希、来源任务、创建时间、保留策略和对象存储 key。截图、下载报表、异常 HTML 和日志都通过 Artifact 引用，不能全部塞进任务 JSON。

## 11. 网站功能测试

推荐：

- **Playwright Test**：标准浏览器和受支持的外部内核测试。
- `@playwright/test` 的 trace、截图、视频和 HTML 报告。
- **axe-core**：可选的无障碍检查。
- **pixelmatch** 或 Playwright screenshot comparison：视觉回归，可从小范围开始。
- **Testcontainers**：启动临时 PostgreSQL、MinIO 和测试服务。
- **Pact** 或 OpenAPI 契约测试（后期）：服务端和桌面/Web API Client 分开发布时，用于检测兼容性破坏。
- **MSW**：前端 API mock；服务端集成测试优先使用真实测试数据库。

测试工作流与生产工作流共享节点协议，但测试节点额外支持断言、测试数据、前置条件、清理步骤和报告。定制指纹内核与标准 Chromium 应有对照测试矩阵。

## 12. LangChain、LangGraph 与 RAG

### 12.1 AI Worker

推荐：

- **LangChain.js**：模型、检索器、工具和文档处理的组件层。
- **LangGraph.js**：带状态、检查点、人工确认和恢复的 Agent 图。
- **@langchain/core**：统一消息、Runnable 和工具接口。
- 各模型供应商的独立 adapter：`@langchain/openai`、`@langchain/anthropic`、`@langchain/google-genai`、`@langchain/ollama` 或 OpenAI-compatible 服务。
- **AI SDK** 可以用于前端流式 UI，但不能替代 LangGraph 的服务端状态和权限边界。

AI Worker 不直接获得 Electron、文件系统根目录、数据库超级权限或任意 CDP 端口。它只能调用 Tool Gateway 注册的工具。

### 12.2 RAG 存储

首选：

- PostgreSQL + **pgvector**：团队自托管时减少额外服务。
- LangChain 的 PostgreSQL vector store 或自有 repository 层。
- 规模增加后再评估 Qdrant、Weaviate 或 Milvus。

文档表至少保存租户、权限、来源、版本、哈希、分块、embedding 模型、更新时间和删除状态。检索结果必须经过权限过滤，不能先召回再依赖前端隐藏。

### 12.3 文档处理

TypeScript 优先：

- **mammoth**：DOCX 文本提取。
- **pdf-parse** 或 pdf.js：PDF 文本提取。
- **ExcelJS**：表格提取。
- **tesseract.js**：轻量 OCR 试用；生产 OCR 评估 Python/PaddleOCR 或外部服务。
- 文档分块使用 LangChain splitter，但分块规则和版本写入文档元数据。

AI 生成的工作流只能先生成草稿。涉及修改价格、上传资料、提交订单、删除数据或发送消息时，必须经过权限检查和人工确认。

## 13. Web 管理端

完整 WebUI 放到团队基础稳定后再做，技术栈与桌面 Renderer 共享：

- React + Vite + TypeScript。
- shadcn/ui、Tailwind CSS、TanStack Query、TanStack Table。
- 共享 `packages/ui`、`packages/contracts` 和 `packages/api-client`。
- Web 只能管理团队成员、权限、设备、审计、任务状态和服务设置。
- Web 不能直接操作成员电脑上的浏览器用户目录或本机进程。

桌面端专属能力通过 Electron Main/Preload 提供；Web 端通过 API 和服务端队列提供能力。不要为了复用页面而把本机文件和进程权限放进 Web API。

## 14. 可观测性与诊断

### 14.1 日志

- **pino**：Worker、API 和服务端结构化日志。
- **electron-log**：客户端文件日志和滚动策略。
- 日志字段包含任务 ID、环境 ID、租约 ID、设备 ID、用户 ID 和版本，但不包含 Cookie、代理密码、Authorization header 和完整页面内容。
- 支持用户主动导出脱敏诊断包。

### 14.2 指标和追踪

- **prom-client**：自托管服务的 Prometheus 指标。
- **OpenTelemetry**：API、队列、Worker 和数据库的 trace/span。
- **Sentry** 可作为可选、明确告知并可关闭的崩溃采集；开源默认不上传页面内容和凭据。

首期至少记录：浏览器启动耗时、内核下载失败、快照上传/下载耗时、租约冲突、工作流节点耗时、队列重试和磁盘空间。

## 15. 安全与依赖治理

### 15.1 Electron 安全

- contextIsolation、sandbox、nodeIntegration=false。
- CSP、禁止不必要的远程内容和导航。
- IPC 白名单和 Zod 校验。
- CDP 端口只绑定 loopback，使用随机端口和一次性令牌。
- 不把外部浏览器的调试端口暴露到局域网。
- 下载的内核执行文件经过 HTTPS、SHA-256 和 manifest 校验。

### 15.2 服务端安全

- Helmet、CORS 白名单、限流和请求体大小限制。
- PostgreSQL 使用最小权限账号。
- 对象存储 bucket 默认私有，下载使用短时预签名 URL。
- 密钥从环境变量或外部 Secret 管理器读取，不写入镜像和仓库。
- 团队所有资源查询必须带租户/团队过滤条件。
- 关键写操作使用幂等键和审计记录。

### 15.3 依赖和许可证

- `pnpm-lock.yaml` 必须提交。
- 使用 **OSV-Scanner**、`pnpm audit`、GitHub Dependabot 或 Renovate 检查漏洞。
- 使用 **Syft/Grype** 或同类工具生成发布物 SBOM，可在后期加入。
- 新增依赖记录用途、许可证、是否包含原生模块、是否联网、是否收集数据。
- 特别核查 AGPL、GPL、商业许可和带模型/数据条款的依赖。
- 浏览器内核、补丁源码、二进制下载地址和许可证单独登记，不因为 npm 包许可证宽松就推断内核可自由分发。

## 16. 发布和部署

### 16.1 桌面发布

GitHub Actions 负责：

- Windows、macOS、Linux 构建矩阵。
- Electron 应用打包和产物校验。
- 内核下载包的 manifest 和 SHA-256 生成。
- GitHub Release 草稿和校验文件。
- 生成 SBOM 和版本变更说明。

用户已经决定前期不把代码签名作为发布前提，但发布流程应保留以后接入 Windows、macOS 和 Linux 签名的接口。未签名安装包需要在文档中说明系统提示和校验方式。

### 16.2 团队服务部署

Docker Compose 首期包含：

- ContextWeave Server。
- PostgreSQL。
- MinIO 或外部 S3 配置。
- 可选 pg-boss worker。
- 反向代理由用户选择 Caddy、Nginx 或 Traefik。

服务端必须提供数据库迁移、健康检查、备份说明、环境变量模板和升级回滚说明。

### 16.3 可选远程执行节点

远程执行节点不是普通 API 进程的附属线程。它需要：

- 设备注册和短期凭据。
- 能力标签，例如 OS、内核、代理区域和可用扩展。
- 任务租约、心跳和取消。
- 独立浏览器用户目录。
- 结果和 Artifact 上传。
- 节点退出时清理敏感数据。

## 17. 分阶段加入库和能力

### v0.1-v0.3：个人客户端和多内核验证

加入：

- Electron、Vite、React、TypeScript。
- shadcn/ui、Tailwind、TanStack Query、Zustand、React Hook Form、Zod。
- pnpm、Vitest、ESLint、Prettier。
- SQLite、better-sqlite3、Drizzle。
- execa、get-port、electron-log。
- Kernel Registry、manifest、SHA-256、至少两个内核 Adapter。
- Playwright Core 或 CDP client 的最小控制闭环。

暂不加入：LangChain、LangGraph、pgvector、Redis、Temporal、完整 WebUI 和复杂增量快照。

### v0.4-v0.6：自托管团队和环境接力

加入：

- NestJS、@nestjs/platform-fastify、Zod、OpenAPI。
- PostgreSQL、Drizzle migrations、jose、argon2。
- S3 SDK、MinIO、预签名 URL。
- pg-boss、服务端 pino、prom-client。
- 团队、权限、租约、版本、审计和快照恢复。
- Testcontainers 的 PostgreSQL/MinIO 集成测试。

### v1.1-v1.5：工作流、采集和测试

加入：

- 独立 TypeScript Worker。
- Workflow Schema、XState、React Flow、p-queue、p-retry。
- Playwright Test、csv-parse、ExcelJS、decimal.js、cheerio、undici。
- 任务队列、定时调度、断言、测试报告和数据集。

### v1.6 以后：AI、RAG 和复杂执行

加入：

- LangChain.js、LangGraph.js、独立 AI Worker。
- PostgreSQL pgvector，后期按规模评估 Qdrant 等向量数据库。
- 文档解析、OCR、Embedding、重排序和知识库权限过滤。
- 人工审批、工具调用审计、Agent 检查点和失败恢复。
- 可选 Python Worker、Ollama、云模型或企业模型服务。

## 18. 首期不建议引入的技术

- 不同时使用 Electron、Tauri 和 Wails。
- 不把 Electron Renderer 当作指纹浏览器。
- 不在第一版引入 Redis、Kafka、Temporal、Kubernetes 或微服务拆分。
- 不直接采用重量级低代码工作流引擎替代自己的 Workflow Schema。
- 不把 LangGraph 当作基础浏览器操作执行器。
- 不把所有环境文件存到 PostgreSQL 大字段中。
- 不让客户端直接连接 PostgreSQL。
- 不在 Renderer、Main 或服务端执行没有权限边界的任意用户脚本。
- 不通过修改 User-Agent 或注入 JavaScript 宣称完成指纹隔离。

## 19. 最终推荐基线

首期最终技术栈为：

```text
Electron
├── React + TypeScript + Vite
├── shadcn/ui `base-nova` + Tailwind CSS + Base UI
├── TanStack Query + Zustand
├── React Hook Form + Zod
├── Electron Main/Preload
├── SQLite + better-sqlite3 + Drizzle ORM
├── Kernel Registry + Kernel Adapter + Browser Runtime
├── Playwright Core/CDP adapter
└── 独立 TypeScript Worker

自托管团队服务
├── NestJS + Fastify adapter + Zod + OpenAPI
├── PostgreSQL + Drizzle ORM
├── jose + argon2
├── S3 API + MinIO
├── pg-boss
└── pino + Prometheus/OpenTelemetry

后期能力
├── React Flow + XState + p-queue + p-retry
├── Playwright Test + Testcontainers
├── CSV/XLSX/HTML 数据处理
├── LangChain.js + LangGraph.js
├── PostgreSQL pgvector
└── 可选 Python/OCR/本地模型 Worker
```

这套方案允许替换 Electron、PostgreSQL 托管方式、浏览器内核、模型供应商和向量数据库，而不破坏环境模型、团队协议、工作流协议和 AI Tool Schema。真正需要长期维护的是这些边界，而不是某一个具体库的调用方式。
