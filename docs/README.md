# ContextWeave 文档索引

**状态：** 生效  
**修订号：** r15
**日期：** 2026-09-22
**维护规则：** 以根目录 [`AGENTS.md`](../AGENTS.md) 为准

任何设备、对话或协作者开始工作时，先读取根目录 `AGENTS.md`，再按下列顺序读取当前版本相关文档。

## 文档读取顺序

1. [`../AGENTS.md`](../AGENTS.md)：强制开发规则、当前版本状态和完整文档目录。
2. [`development-process.md`](development-process.md)：版本开发、测试、提交和发布流程。
3. [`project-plan.md`](project-plan.md)：产品目标、架构边界和阶段规划。
4. [`technology-stack.md`](technology-stack.md)：技术栈、库、协议和安全约束。
5. [`simprint-review-and-product-plan.md`](simprint-review-and-product-plan.md)：Simprint 审阅和后期业务规划。
6. [`research/ui-crud-settings-patterns.md`](research/ui-crud-settings-patterns.md)：B 端 CRUD、指纹环境管理和设置页 GitHub 源码研究。
7. [`versions/v0.1-analysis.md`](versions/v0.1-analysis.md)：v0.1 分析和已确认决策。
8. [`versions/v0.1-execution-r6.md`](versions/v0.1-execution-r6.md)：v0.1 执行基线，已确认开发中。
9. [`progress/v0.1.md`](progress/v0.1.md)：v0.1 实际进度和验证证据。
10. [`adr/0001-local-sqlite-runtime.md`](adr/0001-local-sqlite-runtime.md)：v0.1 SQLite 运行时实现决策。
11. [`adr/0002-proxy-auth-transport.md`](adr/0002-proxy-auth-transport.md)：v0.1 代理认证凭据传输边界。
12. [`compatibility-matrix.md`](compatibility-matrix.md)：客户端、运行时和内核平台兼容矩阵。
13. [`risk-register.md`](risk-register.md)：v0.1 风险、措施和复查条件。

## 文档职责

| 文档类型 | 位置 | 作用 |
|---|---|---|
| 仓库规则 | `AGENTS.md` | 所有设备和对话必须遵守的规则 |
| 开发流程 | `development-process.md` | 版本闸门、质量门禁、GitHub Actions 和 Release |
| 总体规划 | `project-plan.md` | 产品目标、架构和版本路线 |
| 技术栈 | `technology-stack.md` | 库、协议、数据、安全和替换边界 |
| 研究文档 | `research/` | 外部项目源码审阅、设计模式和借鉴边界 |
| 分析文档 | `versions/vX.Y-analysis.md` | 当前版本问题、风险和决策 |
| 执行文档 | `versions/vX.Y-execution-rN.md` | 用户确认后执行的版本基线 |
| 进度文档 | `progress/vX.Y.md` | 事实、测试、构建、Release 和已知问题 |
| 架构决策 | `adr/NNNN-title.md` | 可替换成本较高的技术决策 |

当前已生效 ADR：

- [`adr/0001-local-sqlite-runtime.md`](adr/0001-local-sqlite-runtime.md)：v0.1 使用 `node:sqlite`，保留 Drizzle schema，暂缓 `better-sqlite3`。
- [`adr/0002-proxy-auth-transport.md`](adr/0002-proxy-auth-transport.md)：代理密码不进入浏览器命令行，使用安全存储、Worker 标准输入和 CDP 认证挑战。
- [`compatibility-matrix.md`](compatibility-matrix.md)：v0.1 平台和内核验证状态。
- [`risk-register.md`](risk-register.md)：v0.1 风险登记。

历史执行基线：[`versions/v0.1-execution-r2.md`](versions/v0.1-execution-r2.md)、[`versions/v0.1-execution-r3.md`](versions/v0.1-execution-r3.md)、[`versions/v0.1-execution-r4.md`](versions/v0.1-execution-r4.md) 和 [`versions/v0.1-execution-r5.md`](versions/v0.1-execution-r5.md) 已归档，由 r6 替代。

## 新文档规范

- 新文档必须使用 UTF-8，并在文件头写明修订号、状态、日期和适用范围。
- 新文档必须登记到根目录 `AGENTS.md` 和本索引。
- 同一主题只能有一个权威文档；其他文档应链接到它，而不是复制一份会漂移的内容。
- 状态只能使用：`草案`、`分析中`、`待确认`、`生效`、`已废弃`、`已归档`。
- 实质修改必须增加修订号；已确认执行文档的范围、数据、权限、兼容性或验收变化必须重新确认。
- 文档之间发生冲突时，按 `AGENTS.md` 和开发流程中的优先级处理；无法判断时暂停代码修改。
- 文档不得包含真实密钥、Cookie、登录会话、代理密码、生产连接串或真实业务数据。

## 变更记录

- `r2`：登记 ADR 0002，补充 v0.1 代理认证凭据传输边界。
- `r3`：登记 v0.1 Base UI 迁移、未使用 `react-router-dom` 清理和当前执行基线。
- `r4`：登记官方 `base-nova` `sidebar-07` 重生成、业务布局暂缓和官方空白主体占位。
- `r5`：登记第一版主题预设、圆角、密度、字体和官方 Sidebar 布局变体范围。
- `r6`：登记恢复 v0.1 UI 闭环、工程门禁和 GitHub Actions 发布验证范围。
- `r7`：登记 B 端 CRUD、指纹环境管理和设置页 GitHub 源码研究文档，并明确其不自动扩大 v0.1 范围。
- `r8`：补充企业级 Renderer 目录、单职责组件和 React Router Data Mode 目录规范。
- `r9`：登记 GitHub CRUD 与设置页源码复核结果，研究文档更新至 r5。
- `r10`：登记按 shadcn-admin/new-api 复核主体数据表面，研究文档更新至 r6。
- `r11`：登记主体组件布局收敛为 WorkspacePage 的 toolbar/content/selectionBar 插槽结构。
- `r12`：登记 Electron sandboxed Preload 的 CommonJS 输出修复和真实窗口验证结果。
- `r13`：登记指定 B 端页面源码复核结果，研究文档更新至 r7。
- `r14`：登记指定页面技术栈对照结果，研究文档更新至 r8。
- `r15`：登记 TanStack Router 文件路由、官方 Base UI DataTable 和 shadcn 组件清理实现。
