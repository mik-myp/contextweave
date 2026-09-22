# ContextWeave 兼容矩阵

**修订号：** r4
**状态：** 生效  
**日期：** 2026-09-22
**适用范围：** v0.1 个人本地客户端  
**关联文档：** [v0.1 进度](progress/v0.1.md)、[v0.1 执行文档](versions/v0.1-execution-r6.md)

状态含义：

- **开发验证**：代码或单元测试已在该组合运行。
- **构建验证**：目标平台的 Electron 构建已完成。
- **正式支持**：版本验收后允许在 Release 中承诺。

| 组件 | Windows x64 | macOS x64 | macOS arm64 | 说明 |
|---|---|---|---|---|
| Electron 44.4.3 | 开发验证、构建验证 | 构建验证 | 构建验证 | GitHub Actions Release run 35635364171；首个 v0.1 基线 |
| Node.js 22.15 开发工具链 | 开发验证 | 构建验证 | 构建验证 | 用户不需要安装 Node.js；三平台 workflow 检查通过 |
| React/Vite Renderer | 开发验证、构建验证 | 构建验证 | 构建验证 | Electron 内置 Chromium 只用于管理界面 |
| SQLite `node:sqlite` | 开发验证、构建验证、启动验证 | 构建验证 | 构建验证 | Node 22 测试有实验性警告；CI 构建通过 |
| 标准 Chromium/Chrome/Edge 本机探测 | 开发验证、构建验证 | 构建验证 | 构建验证 | 不随项目分发专有二进制；跨平台实际启动仍需用户环境验收 |
| fingerprint-chromium | 适配器测试 | 适配器测试待平台验证 | 适配器测试待平台验证 | 当前 manifest 未配置下载地址、许可证和 SHA-256 |
| Worker CDP smoke | 协议和单元测试、打包 Worker 端到端验证 | 构建验证 | 构建验证 | CI 构建通过；打包 Worker 的真实启动 smoke 仍以 Windows x64 为证据，代理认证仍需专用测试代理 |

v0.1 Release 前必须把目标平台的“待验证”更新为实际证据，不能把 CI 构建成功直接标记为正式支持。

## 变更记录

- `r2`：记录 Windows x64 打包 Worker 的 CDP smoke 证据，并保留代理认证矩阵待验证状态。
- `r3`：记录 v0.1.0-alpha.4 GitHub Actions 三平台构建验证；构建验证不等同于三平台正式支持或真实浏览器启动验收。
- `r4`：记录 v0.1.0-alpha.5 三平台构建、SPDX SBOM 和 Release 验证；仍保留真实浏览器启动和代理认证矩阵待验收状态。
