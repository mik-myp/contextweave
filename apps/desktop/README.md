# ContextWeave Desktop

ContextWeave 的 Electron 桌面客户端。Renderer 负责环境、代理、内核和运行记录的管理界面；Electron Main、Preload 和独立 Worker 负责本地 IPC、SQLite 元数据、独立浏览器生命周期和 CDP smoke task。

当前开发范围是 v0.1 的个人环境闭环。产品阶段、能力验证与迁移顺序见[项目总体规划](../../docs/project-plan.md)，库与进程边界见[技术栈与长期选型](../../docs/technology-stack.md)。内核能力声明不等于实测支持，已存在的 Adapter 也不代表指纹提供方已完成发布接入。

## 常用命令

从仓库根目录运行：

```bash
pnpm --filter @contextweave/desktop dev
pnpm --filter @contextweave/desktop typecheck
pnpm --filter @contextweave/desktop test
pnpm --filter @contextweave/desktop build
```

`build` 生成 Windows/macOS 安装包，`build:dir` 生成未压缩应用目录。v0.1 不签名、不公证，也不自动更新。

## 目录边界

- `src/`：React Renderer，不直接访问 Node.js 或 Electron。
- `electron/main.ts`：窗口、IPC、本地数据库和外部浏览器生命周期。
- `electron/preload.ts`：类型化、白名单 API。
- `electron/worker.ts`：独立 Playwright/CDP smoke Worker。
- `electron.vite.config.ts`：Main、Preload、Worker、Renderer 的构建入口。
