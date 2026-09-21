# ContextWeave 风险登记

**修订号：** r2  
**状态：** 生效  
**日期：** 2026-09-21  
**适用范围：** v0.1 个人本地客户端  
**维护责任：** 每次版本验收和依赖/内核变更时复查

| ID | 风险 | 可能性 | 影响 | 当前措施 | 下一次复查 |
|---|---|---:|---:|---|---|
| R-001 | fingerprint-chromium 来源、许可证、下载地址或哈希未确认 | 高 | 高 | 只注册未配置 manifest；禁止进入 Release；保留通用安装器 | 配置真实内核前 |
| R-002 | `node:sqlite` 在后续 Electron/Node major 发生 API 或稳定性变化 | 中 | 中 | repository 隔离实现；ADR 0001 记录退出条件；CI 验证 | Electron major 升级 |
| R-003 | 外部浏览器进程异常退出或客户端崩溃造成 profile 锁残留 | 中 | 高 | runtime session、PID 检查、原子锁和 `needs-recovery` | v0.1 跨平台验收 |
| R-004 | 代理认证实现与不同 Chromium 内核行为不一致，或认证挑战处理失败 | 中 | 中 | 浏览器参数只包含代理地址；密码使用 safeStorage，经 Worker 标准输入传递并由 CDP `Fetch.authRequired` 处理；不回退到命令行密码 | 真实代理矩阵测试 |
| R-005 | pnpm workspace 外部依赖导致打包后加载 TypeScript 源文件 | 中 | 高 | electron-vite 显式排除所有 workspace 包；检查 asar 和未压缩目录 | electron-vite/Electron 升级 |
| R-006 | 未签名 Windows/macOS 产物被系统拦截 | 高 | 中 | Release 说明首次启动放行方法和 SHA-256；暂不承诺自动更新 | 每次 Release |
| R-007 | 浏览器内核用户目录跨版本不兼容造成数据丢失或启动失败 | 中 | 高 | 记录内核版本、数据目录兼容范围；启动失败不覆盖旧目录 | 新内核版本 |
| R-008 | Worker、截图或页面内容进入日志造成敏感数据泄露 | 中 | 高 | Worker 返回结构化摘要；禁止日志记录 Cookie、密码和完整页面内容 | 增加诊断导出前 |

风险关闭必须有测试、构建日志或用户验收证据；不能只修改风险状态文字。

## 变更记录

- `r2`：补充 R-004 的 CDP 代理认证和禁止命令行密码回退措施。
