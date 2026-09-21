# ADR 0001：v0.1 本地 SQLite 运行时实现

**修订号：** r1  
**状态：** 生效  
**日期：** 2026-09-21  
**适用范围：** v0.1 个人本地客户端  
**关联文档：** [v0.1 执行文档](../versions/v0.1-execution-r6.md)、[技术栈与长期库选型](../technology-stack.md)

## 背景

v0.1 需要在 Electron 主进程中保存环境、代理、内核安装和运行会话元数据。执行文档原先建议 `better-sqlite3 + Drizzle ORM`，但 Windows 开发环境没有可用的 Visual Studio C++ Build Tools，Electron ABI rebuild 无法完成。

同时，v0.1 仍然需要 SQLite 的事务语义、WAL、可重复 migration 和同步查询，不应因为原生模块安装问题改成 JSON 文件或把数据库移到远程服务。

## 决定

v0.1 运行时使用 Electron/Node 内置的 `node:sqlite` `DatabaseSync`：

- migration 通过显式 SQL 执行，使用 `CREATE TABLE IF NOT EXISTS` 和索引。
- repository 层隐藏 SQLite 语句，Renderer、Preload 和 Worker 不直接访问数据库。
- Drizzle schema 文件继续保留，用于表达长期 schema、后续生成 migration 和未来替换实现。
- `better-sqlite3` 暂不作为运行时依赖；保留 `rebuild:native` 脚本，后续在跨平台 CI 和 ABI 验证完成后重新评估。
- `keytar` 不在 v0.1 引入；代理密码使用 Electron `safeStorage` 加密后写入独立凭据文件。

## 取舍

`node:sqlite` 减少了当前开发和打包的原生模块阻塞，Electron 运行时不需要额外 ABI rebuild。代价是它在 Node 22 中仍可能显示实验性警告，API 稳定性和跨 Electron major 兼容性需要持续验证。

SQLite 仍然只保存元数据。浏览器用户目录、内核二进制和截图等文件不写入数据库；敏感凭据不写入普通 SQLite 字段。

## 迁移或退出条件

出现以下情况时重新评估 `better-sqlite3` 或其他实现：

1. 目标 Electron major 不再提供可用的 `node:sqlite`。
2. 需要的 SQLite 扩展、并发吞吐或查询能力超出 `DatabaseSync`。
3. Windows/macOS CI 能稳定完成 `better-sqlite3` ABI rebuild，并且安装包体积、启动时间和升级成本可接受。

重新选择实现时必须保持 `EnvironmentRepository` 和数据库 migration 语义不变，并增加旧数据库升级和回滚测试。

## 验证证据

- `pnpm typecheck`
- `pnpm test`
- Windows x64 `electron-vite build`
- Windows x64 `electron-builder --dir`
- 未压缩客户端首次启动并创建 `contextweave.sqlite`
