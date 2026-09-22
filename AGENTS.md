# ContextWeave Agent Development Rules

**适用仓库：** `mik-myp/contextweave`  
**当前阶段：** v0.1 开发中  
**当前状态：** v0.1 执行文档 r6 已确认，允许开始正式实现

本文档是仓库级开发约束。任何设备、任何对话、任何自动化代理或协作者在修改本仓库前，都必须先读取本文件，以及当前版本对应的执行文档和项目规范。聊天记录不能替代仓库中的文档决定。

## 1. 规则优先级和当前基线

1. 用户在当前会话中的明确要求优先于本文件。
2. 已确认的版本执行文档优先于未确认的规划建议。
3. 本文件、`docs/development-process.md`、`docs/project-plan.md`、`docs/technology-stack.md` 和当前版本文档共同构成仓库开发基线。
4. 所有重要决定、问题答案、范围变化和例外都必须写回仓库文档，不能只保留在对话中。
5. 当前只推进 v0.1；不得提前实现 v0.2 及以后功能。

## 2. 版本开发闸门

每个版本必须按以下顺序推进：

```text
版本分析
→ 列出并确认问题
→ 编写执行文档
→ 用户确认执行文档及修订号
→ 实现
→ 测试与验收
→ 用户最终验收
→ 提交、tag、GitHub Actions 构建和 Release
```

在用户确认当前版本执行文档之前：

- 不创建正式应用代码、服务端代码、数据库 schema、依赖 lockfile 或构建配置。
- 不开始 v0.2 及以后功能的实现。
- 只允许创建或修改分析文档、执行文档、进度记录和本仓库规范文件。
- 不把“顺手实现”“临时验证代码”混入正式发布分支。

如果实现过程中发现需求范围、数据模型、权限、兼容性、协议或验收标准发生实质变化，必须暂停受影响的实现，更新执行文档修订号并重新请求用户确认。

## 3. 当前 v0.1 状态

- 当前阶段：`v0.1` 开发中。
- 当前分析文档：`docs/versions/v0.1-analysis.md`。
- 当前执行文档：`docs/versions/v0.1-execution-r6.md`，已由用户确认。
- 当前允许修改：v0.1 执行文档范围内的正式代码、依赖、构建配置、CI 和文档。
- 当前禁止修改：团队 API、PostgreSQL、WebUI、工作流、AI/RAG、远程执行和其他 v0.2 以后功能。

## 4. 文档读取顺序和文档目录

任何新设备、新对话或新协作者开始工作时，必须按以下顺序读取：

1. `AGENTS.md`：仓库级强制规则、当前版本闸门和文档目录。
2. `docs/development-process.md`：版本分析、执行文档、测试、提交和发布流程。
3. `docs/project-plan.md`：产品目标、阶段路线、架构边界和 v0.1-v1.0 规划。
4. `docs/technology-stack.md`：技术栈、库、协议、数据、安全和长期替换边界。
5. `docs/simprint-review-and-product-plan.md`：Simprint 审阅结论和后期工作流/业务规划。
6. `docs/research/ui-crud-settings-patterns.md`：B 端 CRUD、指纹环境管理和设置页 GitHub 源码研究。
7. `docs/versions/v0.1-analysis.md`：当前版本分析和已确认的 v0.1 决策。
8. `docs/versions/v0.1-execution-r6.md`：当前版本执行基线；用户未确认前只能审阅和维护文档。
9. `docs/progress/v0.1.md`：当前版本状态、证据和阻塞项。
10. `docs/adr/0001-local-sqlite-runtime.md`：v0.1 SQLite 运行时实现决策。
11. `docs/adr/0002-proxy-auth-transport.md`：v0.1 代理认证凭据传输边界。
12. `docs/compatibility-matrix.md`：v0.1 平台、运行时和内核支持矩阵。
13. `docs/risk-register.md`：v0.1 风险登记和复查条件。
14. `docs/README.md`：文档索引、状态和维护说明。

当前仓库文档清单：

| 文件 | 用途 | 当前状态 |
|---|---|---|
| [`AGENTS.md`](AGENTS.md) | 所有设备、对话和协作者必须遵守的仓库规则 | 生效 |
| [`README.md`](README.md) | 项目入口和公开说明 | 维护中 |
| [`docs/development-process.md`](docs/development-process.md) | 版本开发、测试和发布流程 | 生效 |
| [`docs/project-plan.md`](docs/project-plan.md) | 产品总体规划和架构方案 | 生效 |
| [`docs/technology-stack.md`](docs/technology-stack.md) | 技术栈与长期库选型 | 生效 |
| [`docs/simprint-review-and-product-plan.md`](docs/simprint-review-and-product-plan.md) | Simprint 审阅和后期产品规划 | 生效 |
| [`docs/research/ui-crud-settings-patterns.md`](docs/research/ui-crud-settings-patterns.md) | B 端 CRUD、指纹环境管理和设置页 GitHub 源码研究 | 分析中 |
| [`docs/versions/v0.1-analysis.md`](docs/versions/v0.1-analysis.md) | v0.1 分析、问题和决策 | 已完成，执行文档 r6 已确认 |
| [`docs/versions/v0.1-execution-r6.md`](docs/versions/v0.1-execution-r6.md) | v0.1 实施范围、任务、测试和验收 | 已确认，开发中 |
| [`docs/versions/v0.1-execution-r5.md`](docs/versions/v0.1-execution-r5.md) | v0.1 实施范围、任务、测试和验收（历史基线） | 已归档，替代文档为 r6 |
| [`docs/versions/v0.1-execution-r4.md`](docs/versions/v0.1-execution-r4.md) | v0.1 实施范围、任务、测试和验收（历史基线） | 已归档，替代文档为 r5 |
| [`docs/versions/v0.1-execution-r3.md`](docs/versions/v0.1-execution-r3.md) | v0.1 实施范围、任务、测试和验收（历史基线） | 已归档，替代文档为 r4 |
| [`docs/versions/v0.1-execution-r2.md`](docs/versions/v0.1-execution-r2.md) | v0.1 实施范围、任务、测试和验收（历史基线） | 已归档，替代文档为 r3 |
| [`docs/progress/v0.1.md`](docs/progress/v0.1.md) | v0.1 进度和可复核证据 | 开发中 |
| [`docs/adr/0001-local-sqlite-runtime.md`](docs/adr/0001-local-sqlite-runtime.md) | v0.1 SQLite 运行时实现和替换条件 | 生效 |
| [`docs/adr/0002-proxy-auth-transport.md`](docs/adr/0002-proxy-auth-transport.md) | v0.1 代理认证凭据传输边界 | 生效 |
| [`docs/compatibility-matrix.md`](docs/compatibility-matrix.md) | 平台、运行时和内核兼容状态 | 生效 |
| [`docs/risk-register.md`](docs/risk-register.md) | v0.1 风险、措施和复查条件 | 生效 |
| [`docs/README.md`](docs/README.md) | 文档索引和文档维护规范 | 生效 |

### 文档新增和维护规则

- 新建文档前先判断是否已有权威文档，禁止为同一主题创建两个互相独立的“最终版本”。
- 每个文档必须在文件头写明标题、修订号或版本、状态、日期和适用范围；长期文档还要写明关联文档。
- 新文档必须登记到本节、`docs/README.md` 和相关入口文档；删除或移动文档时同步更新所有链接。
- 文档状态使用：`草案`、`分析中`、`待确认`、`生效`、`已废弃`、`已归档`。只有用户确认的执行文档才能标记为生效。
- 执行文档按 `docs/versions/vX.Y-execution-rN.md` 命名；版本进度按 `docs/progress/vX.Y.md` 命名；架构决策按 `docs/adr/NNNN-title.md` 命名。
- 文档的实质变化必须增加修订号，并在变更记录中写明原因；用户确认过的执行文档发生范围、数据、权限、兼容性或验收变化时必须重新确认。
- 规划文档描述方向，分析文档描述问题和决策，执行文档描述当前版本可执行范围；同一版本发生冲突时，以用户已确认的执行文档为准。
- 被替代的文档不能直接删除，改为标记 `已废弃` 或 `已归档`，并链接到替代文档。
- 文档不得包含真实密钥、Cookie、登录会话、代理密码、生产连接串或真实业务数据。
- 新对话或新设备发现文档缺失、链接失效、状态冲突或修订号不明确时，必须暂停代码修改，先修正文档并记录原因。

## 5. 文件和编码

- 所有新建和修改的文本文件必须使用 UTF-8 编码。
- 读写已有文件时必须显式指定 UTF-8，并保持已有中文文本内容和编码不被无意改变。
- 默认使用 UTF-8 无 BOM，除非某个工具或平台明确要求 BOM。
- 修改前先读取文件；修改后检查 UTF-8 有效性、意外控制字符、换行和敏感信息。
- 不把真实 Cookie、登录会话、代理密码、模型密钥、生产连接串或真实业务数据写入仓库。

## 6. ContextWeave 架构边界

- Electron 只负责管理界面和本地协调；Electron 自带 Chromium 不是指纹浏览器内核。
- 实际网站访问使用独立浏览器进程和独立用户目录。
- 内核通过 `Kernel Registry`、`Kernel Manifest`、`Kernel Adapter` 和 `Browser Runtime` 接入；不能把内核专属参数散落在 React 页面或业务代码中。
- Renderer 不直接访问文件系统、数据库、任意 IPC 或外部网站控制端口；通过受限、类型化、运行时校验的 Preload API。
- React 页面不持有长任务状态；长任务交给独立 TypeScript Worker 或本地服务。
- 客户端不直接连接 PostgreSQL；PostgreSQL 只由自托管团队服务访问。
- 工作流、LangChain、LangGraph 和 AI Worker 必须通过版本化的 contracts/tool schema 接入，不能绕过权限、审计、租约和幂等控制。

## 7. v0.1 范围控制

v0.1 只在执行文档明确的范围内实现。默认候选方向是个人本地环境和多内核启动验证；团队服务、PostgreSQL、环境接力、备份恢复、可视化工作流、电商业务和 AI/RAG 必须在执行文档中明确是否属于本版本。

每个新增功能必须说明：

- 用户价值和所属版本。
- 数据、IPC、协议、内核和权限影响。
- 测试方式和验收标准。
- 是否会增加后续迁移或替换成本。

## 8. 测试、验收和证据

- 实现完成不等于版本完成；必须通过执行文档中的自动化检查、关键路径手动验收、异常恢复验证和目标平台构建。
- 测试必须记录命令、平台、架构、内核版本、测试数据和结果。
- 失败、取消、重复启动、异常退出、断网、低磁盘和下载校验失败等行为必须有明确结果。
- CI 失败、Flaky Test、许可证问题和已知限制必须写入进度文档，不能用“构建成功”掩盖。

## 9. Git 和发布

- `main` 保持可构建；功能使用短期分支或 Pull Request。
- 不强制推送、不覆盖已发布 tag、不把未确认范围直接合并到主分支。
- 使用 Conventional Commits；一个提交表达一个逻辑变化。
- 只有用户验收通过并满足 Definition of Done 后，才能推送提交、创建 SemVer tag 和 GitHub Release。
- Release 构建 Windows 和 macOS 产物，前期不签名，但必须生成 SHA-256；以后再单独接入签名和公证。
- 发布流程必须从 tag 对应提交构建，并记录产物、哈希、构建环境、已知限制和回滚方式。

## 10. 依赖和安全

- 新增依赖前记录用途、版本、许可证、原生模块、网络行为和替换成本。
- 不在 Renderer、Main、服务端或 Worker 中执行没有权限边界的任意脚本。
- 下载的浏览器内核必须经过 manifest、平台/架构和 SHA-256 校验后才能执行。
- 代理凭据、Cookie、登录会话和模型密钥默认不上传团队服务；日志和诊断必须脱敏。
- 指纹、自动化和数据采集功能只面向用户授权场景，不把绕过验证码、访问控制、风控或平台限制作为产品承诺。

## 11. 对其他设备和对话的要求

任何新的设备、对话或协作者开始工作时，必须先执行：

1. 读取根目录 `AGENTS.md`。
2. 读取 `docs/development-process.md`、`docs/project-plan.md`、`docs/technology-stack.md` 和当前版本文档。
3. 查看 `git status`、当前分支、最近提交和远程状态。
4. 确认当前版本闸门状态，不能假设聊天中的“准备开始”就是执行文档已确认。
5. 将新的决定、问题答案和变更写回仓库文档。

无法确认当前阶段、执行文档修订号或用户授权范围时，停止代码修改，先补充文档和问题确认。
