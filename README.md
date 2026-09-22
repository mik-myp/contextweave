# ContextWeave

**ContextWeave（织境）** 是一个面向个人与团队的开源、可自托管多内核浏览器工作台。

项目计划提供：

- 独立浏览器环境、代理和内核版本管理
- fingerprint-chromium、标准 Chromium/Chrome/Edge、Camoufox 等多内核适配
- 个人空间与团队空间
- 团队成员接力使用同一个环境
- 环境版本、备份、同步与异常恢复
- 后续扩展可视化工作流、电商运营、数据采集、网站测试和 LangChain/LangGraph/RAG

当前项目处于 v0.1 个人本地客户端开发阶段，预览版本 `v0.1.0-alpha.5` 已发布；仍有真实浏览器启动、代理认证矩阵和跨平台手动验收项待关闭。

本地开发首次运行 `pnpm dev` 时，桌面端会通过 Electron 官方 `install-electron` 准备当前平台的 Electron 二进制；如果下载被中断，重新执行 `pnpm dev` 即可重试。

开发本仓库前必须先阅读根目录的 [AGENTS.md](AGENTS.md)；版本开发还必须遵循 [开发与版本发布规范](docs/development-process.md) 和当前版本执行文档。

## 文档

- [项目总体规划与技术方案](docs/project-plan.md)
- [技术栈与长期库选型](docs/technology-stack.md)
- [开发与版本发布规范](docs/development-process.md)
- [Simprint v0.2.32 审阅与产品规划](docs/simprint-review-and-product-plan.md)
- [文档索引与维护规范](docs/README.md)
- [v0.1 版本分析](docs/versions/v0.1-analysis.md)
- [v0.1 执行文档（已确认，开发中）](docs/versions/v0.1-execution-r6.md)
- [v0.1 开发进度](docs/progress/v0.1.md)

## 技术方向

当前客户端基线为 Electron + React/TypeScript。Electron 只负责管理界面和本地协调，实际网站访问由独立浏览器内核进程完成。内核通过 Kernel Registry、Kernel Adapter 和 Browser Runtime 独立演进。
