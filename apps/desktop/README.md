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
- `electron/main.ts`：窗口、IPC 来源验证和应用装配。
- `electron/application.ts`：统一命令入口与领域服务组合。
- `electron/services/`：环境、内核、运行协调、预检、凭据和 Worker；命令不依赖页面生命周期。
- `electron/preload.ts`：类型化、白名单 API。
- `electron/worker.ts`：独立 Playwright/CDP smoke Worker。
- `electron.vite.config.ts`：Main、Preload、Worker、Renderer 的构建入口。

## v0.1 验证与开发数据

`pnpm check` 执行格式、lint、类型和行为测试；构建后运行 `pnpm test:desktop --require-native` 验证真实沙盒桥接和原生环境闭环。`node scripts/verify-browser.mjs --executable /path/to/browser` 从仓库根目录探测已批准的本机浏览器，只访问本地测试页面。

开发态可以用 `CONTEXTWEAVE_USER_DATA` 指定临时用户数据目录进行桌面验收，避免修改正常使用的数据。发行包不读取这个开发覆盖项。远程调试端口仅在测试启动命令中显式提供，正式应用不默认开启 Renderer 的调试端口。

数据库从旧 schema 迁移时会创建旁路一致性备份。回退前必须关闭客户端和相关浏览器，保留当前数据库及用户目录，再把备份交给兼容的旧客户端使用。不要直接把新 schema 降级标记为旧版本。
