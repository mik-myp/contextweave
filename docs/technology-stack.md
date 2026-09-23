# ContextWeave 技术栈与长期库选型

**修订日期：2026-09-23**

**对应路线：** [项目总体规划与技术方案](project-plan.md)

**职责：** 记录当前技术基线、下一步采用的技术、引入条件、替换边界和维护责任。

本轮重设计保留现有 Electron/TypeScript 技术基础，优先完善稳定环境、能力验证、运行与数据恢复。参考项目的桌面框架、内核和服务端分别评估；不把一个参考仓库整套迁入 ContextWeave。

“已采用”表示当前源码有相应实现；“计划采用”需在对应工作包加入依赖与测试；“候选”尚未通过接入验证。下文不表示所有库已经安装或所有能力已发布。精确版本以各 `package.json` 与 `pnpm-lock.yaml` 为准。

## 1. 当前可复用基线

| 范围       | 当前基线                                               | 本轮决定                                                    |
| ---------- | ------------------------------------------------------ | ----------------------------------------------------------- |
| 桌面       | Electron 44.4.3、electron-vite 5、electron-builder 26  | 保留；把业务职责从入口移出，继续使用外部浏览器进程          |
| 开发运行时 | Node.js `>=22.15.0 <23`，pnpm 10.26.2 workspace        | 当前不改锁文件；独立工作包升级开发/CI 到受支持 LTS          |
| Renderer   | React 19、TypeScript strict、Tailwind CSS 4            | 保留，业务逻辑按 feature 和应用服务组织                     |
| UI         | shadcn base-nova / Base UI，Lucide                     | 保留；已有组件源码按项目语义 token 维护                     |
| 路由       | TanStack Router 文件路由与 Hash History                | 保留，配置页与设置分区用嵌套路由                            |
| 表格       | TanStack Table 9.2.4 + 共享 DataTable                  | 保留，不复制参考项目旧版本 API                              |
| 表单       | React Hook Form + Zod + Resolver                       | 保留，一套字段/校验支持新建和编辑                           |
| 数据       | `node:sqlite` DatabaseSync、repository、Drizzle schema | 保留驱动；补可重复迁移、一致性备份和恢复测试                |
| 凭据       | Electron safeStorage                                   | 保留；凭据引用与业务配置分离                                |
| 浏览器     | Kernel Registry/Adapter、playwright-core、CDP          | 保留抽象方向，替换指纹占位参数并补完整运行协议              |
| 质量       | ESLint、Prettier、TypeScript、Vitest                   | 保留，补真实浏览器与安装/恢复测试，不以单元测试替代内核实测 |

Node 官方计划中，22 的支持结束日期为 **2027-04-30**，24 为 **2028-04-30**。建议下一次运行时维护工作包评估 Node 24 LTS；必须同时验证构建工具、SQLite 和 CI，不能只改 `engines`。开发 Node、Electron 内嵌 Node 与被启动的浏览器版本独立管理。来源见[官方发布计划](https://github.com/nodejs/Release/blob/main/schedule.json)。

## 2. 应用边界和目录演进

### 2.1 保留的进程边界

```text
Renderer → Preload → Application Services → Runtime / Repository / Credentials
                                             ↓
                                      独立浏览器进程
后续 Local API / CLI / MCP → 同一 Application Services
后续团队服务             → 远程元数据与快照接口，不直接控制 Renderer
```

- Renderer 不接触数据库、Node、任意 IPC、可执行路径或原始浏览器调试端点。
- Preload 暴露类型化白名单。输入、响应和事件都通过 contracts 校验，Main 验证发送方。
- 应用服务负责环境、代理、修订和快照；Runtime Supervisor 负责运行锁、子进程、端点、会话与依赖连接。
- Runtime Supervisor 首期位于桌面应用内，保持可独立测试；未来需要脱离应用常驻时再迁往独立进程。
- Worker 用于耗时操作，必须有任务身份、进度、取消和资源上限。普通 Node 子进程不自动成为可执行任意不可信脚本的安全沙箱。

### 2.2 当前目录的渐进拆分

```text
apps/desktop/
├── electron/
│   ├── main.ts                 # 应用生命周期与装配
│   ├── preload.ts              # 最小白名单桥接
│   ├── ipc/                    # 校验与协议适配
│   ├── services/               # 环境、代理、安装、快照应用服务
│   ├── runtime/                # 进程所有权、锁、会话、运行事件
│   └── infrastructure/         # 系统凭据、目录、受控下载等适配
└── src/
    ├── app/                    # Shell、Provider、路由装配
    ├── features/               # 领域页面、表单、hooks、查询
    ├── components/             # 通用组合与 shadcn UI
    ├── i18n/                   # 字典、类型、Provider
    └── routes/                 # 路由参数与页面组合

packages/
├── contracts/                  # 按 environment/runtime/proxy/kernel/theme 拆 schema
├── storage/                    # repository、迁移、锁/恢复元数据
├── kernel-core/                # manifest、能力、提供方接口与安装协议
├── kernel-standard-chromium/
├── kernel-fingerprint-chromium/ # 完成真实验证后替换占位实现
└── worker-protocol/
```

目录按实施进度建立，不创建一批空 packages。只有第二个真实消费者出现时，才把桌面内部应用服务提为共享包；`contracts` 不依赖 Electron/React/数据库驱动。共享包使用公开入口，不能用跨目录内部引用绕开边界。

## 3. 前端选型与状态管理

### 3.1 已确认的 UI 方案

- 管理页面与 CRUD 使用 shadcn-admin 风格的组件组合；保留根目录 `THIRD_PARTY_NOTICES.md` 与应用内声明。
- 主题参考 New API 的交互与视觉，代码、SVG、CSS 自主实现；使用现有 Base UI Drawer，不增加第二套浮层基础库。
- 大型环境表单使用独立路由页，代理等小表单使用 Dialog。系统设置使用页内左右结构，主题/语言入口只在右上角。
- DataTable 统一搜索、Popover+Command 多选、排序/隐藏、列设置、选择范围、分页与批量结果；业务列与命令留在 feature。
- 路由文件仅组合页面与参数，不承担数据库访问或运行状态机。页面和列表状态继续可恢复。
- 主题类别、ThemeConfig v2、Public Sans 本地字体、语义状态色、RTL 和密度规则按总体规划保留；默认全宽，居中最大 64 rem。

### 3.2 下一步状态拆分

| 状态                      | 技术与位置                                                         | 约束                                            |
| ------------------------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| 持久化领域数据            | Main 服务/repository 为权威来源                                    | UI 不独立决定运行结果                           |
| 列表与详情查询            | 计划采用 `@tanstack/react-query`，queryFn 调类型化 feature service | 以领域/资源 ID 组织缓存，订阅运行事件后精确失效 |
| 表单与校验                | React Hook Form + Zod                                              | 草稿不含明文凭据，提交冲突保留输入              |
| 主题和语言                | 现有专用 Provider                                                  | 不合并到环境业务缓存                            |
| 列选择、打开状态、临时 UI | 组件状态或有边界的 Zustand store                                   | 不复制整个数据库和任务结果                      |
| 长操作                    | Main 的 Operation 协调与事件                                       | 页面卸载不终止已提交任务                        |

TanStack Query 用于替换 AppDataProvider 的跨领域整体轮询，而不是让多个 store 同时持有相同环境列表。先迁移一个领域，验证旧请求不覆盖新修改、事件失效和断线对账，再扩展。运行事件带递增序号或等价游标；事件丢失时重新读取快照。

`@tanstack/react-query` 为 MIT、纯 JS，无原生模块；业务 `queryFn` 才决定 IPC/网络访问，不增加产品遥测。替换成本限定在查询 hooks。当前不安装，随 v0.1 对应工作包单独提交依赖、锁文件和行为验证。技术入口：[TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview)。

## 4. 指纹配置与内核提供方

### 4.1 选择顺序

| 提供方/工具                            | 状态               | 决策与退出条件                                                                        |
| -------------------------------------- | ------------------ | ------------------------------------------------------------------------------------- |
| 本机 Chromium/Chrome/Edge              | 当前基础能力       | 用于原生环境和回归；目录兼容性、实际版本与路径均要核验，不声明内核级指纹保护          |
| fingerprint-chromium                   | 首个接入验证候选   | 复用 Chromium/CDP 路径；源码与二进制不匹配、维护不足、关键实测失败则不进入产品分发    |
| Fury Core                              | 替代 Chromium 候选 | 验证其源码补丁、配置传输、许可和各平台集成；不因其自带 Rust agent 就重写 ContextWeave |
| Camoufox + camoufox-js                 | 第二家族候选       | JS 客户端是实验性；需验证持久目录、独立控制协议和进程接管。与 Chromium 分开验收       |
| BrowserForge / Apify Fingerprint Suite | 生成器研究/候选    | 只映射到实际支持的字段。生成结果、seed 和生成器版本同时持久化；不默认开启 JS 注入器   |
| CloakBrowser / Wayfern 等第三方内核    | 非默认方案         | 管理端开源不等于内核授权；先完成独立分发、源码与维护核查，再决定是否提供可选适配      |

完整调研、许可文件和提交快照见总体规划附录。此表不批准下载或执行未经验证的二进制。

### 4.2 Provider 接口需要提供的职责

当前 `validateConfig` / `buildLaunchPlan` / `getCapabilities` 不足以表达全部行为，逐步补充：

- **Manifest**：提供方 ID、家族、确切版本、平台/架构、来源与校验、许可材料、控制协议和目录兼容条件。
- **Resolve**：把用户配置解析为固定版本的实际配置，返回不可用字段与不一致诊断；不能丢弃不支持输入后继续报告成功。
- **Prepare/Launch**：安装/目录/网络准备、启动、就绪检查及失败清理；不限定所有提供方都只能生成 Chromium 参数。
- **SessionHandle**：查询健康状态、订阅退出、协调停止、取得受控的控制会话。
- **Capabilities**：能力来源、已测平台/版本、支持范围、变更需重启/重建、证据时间与测试 ID。
- **Migration**：检查现有用户目录能否升级或迁移，提供拒绝原因和恢复要求。

具体接口先由一个真实提供方的验证结果驱动；首期不建设能执行任意第三方代码的插件商店。

### 4.3 自动化协议

- Chromium 采用 CDP 和 `playwright-core`，直接 CDP 用于必要的生命周期/配置控制。避免多个连接同时争抢同一页面的自动附加与调试控制。
- Playwright 官方明确 `connectOverCDP` 仅支持 Chromium，能力低于其原生连接。Firefox 提供方使用独立适配器，不复用 Chromium 端口探测协议。
- `playwright-core` 不替用户定义安全的浏览器版本。运行库版本、外部内核版本、适配器与测试矩阵分别固定。
- 人工、工作流和外部工具的写操作协调由应用控制；API 连接成功不能绕过环境运行锁或配置修订。
- 不以绕过验证码、网站风控或访问限制作为支持承诺。检测工具只用于观察具体行为。

依据：[Playwright BrowserType](https://playwright.dev/docs/api/class-browsertype)、[Camoufox](https://github.com/daijro/camoufox)、[camoufox-js](https://github.com/apify/camoufox-js)。

## 5. 完整内核安装和维护

现有 installer 的单文件写入流程不足以安装完整 Chromium 包。第一个真实提供方接入时必须实现以下完整协议：

1. 可信 manifest 固定产物 URL、格式、大小上限、哈希、目标平台、可执行入口和文件布局。
2. 受控下载流式写入临时目录，支持取消、超时与错误恢复，不将不受限的整个包读入内存。
3. 在隔离暂存目录解包，校验路径、符号链接与解压后大小，保留 Chromium 资源文件和 macOS `.app` 结构。
4. 校验内容与许可，探测版本并完成最小启动验证，成功后原子登记安装目录。
5. 多版本并存；环境绑定固定版本。升级环境之前停止、检查数据兼容性并生成恢复点，不覆盖运行中的安装。
6. 失败清理只移除本次暂存资源；保留旧版本和操作记录，重启后可对账。

具体解包库随候选产物格式选定，必须记录许可与原生依赖，不通过任意 shell 命令拼接下载或解压。哈希验证说明“内容与 manifest 一致”，可信来源和 manifest 的发布真实性另行验证，不能把下载包自行算出的哈希视为来源认证。

## 6. 数据、凭据与恢复

### 6.1 SQLite 与 repository

保留 `node:sqlite`。当前 Drizzle 只描述 schema，读写由 repository 执行；迁移要建立一个可执行的权威流程，避免 Drizzle schema 和手写 SQL 各自演进。

- 配置修订、Operation 和 RuntimeSession 独立建模，运行记录补结束时间和结构化失败阶段。
- 普通写入用事务，迁移有版本、校验和、失败恢复和幂等测试。
- 同步 SQLite 查询保持短小；大量历史查询采用索引和分页。确认阻塞超过可接受范围后再把存储迁入单独线程/进程，不先增加第二个数据库驱动。
- 数据量增长时，分页/筛选由 repository 执行。前端 TanStack Table 的选中集合与服务端查询范围分开，不依赖一次读取全部数据。
- 备份采用 SQLite 支持的一致性方式；浏览器用户目录快照要求停止写入。数据库事务不覆盖文件系统操作，需操作日志和恢复对账。

### 6.2 凭据

继续使用 safeStorage，保存加密内容与引用；Renderer 只能知道是否已配置密码。编辑时留空表示保持，明确清除表示删除。安全存储不可用时显示可操作错误，不回退到明文。

凭据管理抽象出保存/读取/删除/恢复失败，避免领域服务直接操作全局凭据文件。代理密码、CDP 地址令牌、Cookie 和团队令牌不进入日志、表格、普通草稿、URL 或进程参数。

### 6.3 归档、回收站和兼容性

配置导出与完整快照分开。完整快照包含格式版本、清单、内核/平台/配置修订和完整性信息；敏感快照需要明确的加密、密钥恢复与传输设计。

归档库先评估 ZIP 的 `yauzl`/`yazl`（MIT，JS 实现），用于本项目导入导出；它们不自动提供加密或安全解包策略。内核下载的归档格式另行处理，不强制把所有上游包当作 ZIP。

浏览器内部凭据可能与操作系统/应用身份绑定，不能将“复制目录”当作跨设备登录态迁移协议。恢复只在声明支持的组合上开放；不兼容时允许恢复配置或建立新环境，不悄悄丢失数据后报告成功。

回收站是明确的逻辑状态与可恢复数据，不是删除数据库记录后留下无索引目录。永久删除、数据库清理、文件清理和旧版本 GC 分阶段记录结果，重启后能够继续。

## 7. Local API、CLI、MCP 与工作流

### 7.1 v0.4 接口层

- 同一应用命令层提供输入/输出 Zod schema、业务错误码、资源作用域、幂等和取消能力。
- Local API 计划使用 Fastify；只监听 loopback，默认关闭，开启后使用可撤销令牌和明确权限。浏览器来源/Host 校验与防止跨站调用一起设计。
- CLI/MCP 先提供 stdio 接入，采用官方 TypeScript SDK；诊断写入 stderr，stdout 保持协议内容。HTTP MCP 不是首个交付要求。
- 外部工具默认获取受控命令，不默认发放任意 CDP 连接。确有需要的高级连接单独授权、限时并记录访问。
- MCP 是工具协议，不要求安装 LLM，也不让环境启动依赖 AI 服务。

Fastify 为 MIT、JS 实现。MCP TypeScript SDK 的当前 [LICENSE](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/LICENSE) 正在从 MIT 迁往 Apache-2.0，尚未取得重新许可同意的旧贡献仍适用 MIT；引入时必须按选定版本保留对应许可，不能沿用旧的单一 MIT 结论。两者的网络行为由应用显式配置，并锁定与 Node、Zod 的兼容组合；工具描述和接口文档从同一 schema 生成。当前阶段不安装这些依赖。

### 7.2 v1.3 工作流

先做可持久化的顺序执行器、输入输出、取消、重试和人工暂停，再采用 `@xyflow/react`（MIT）构建画布。图编辑器不是执行引擎；已完成的外部副作用不能因重试而默认为可重复执行。

单机调度先使用本地持久化任务与有限并发。出现多 Worker/团队调度需求再引入 BullMQ 的开源部分与明确兼容的队列服务；不为首期浏览器启动引入 Redis 和分布式队列。

脚本节点默认只运行用户信任的本地脚本；若要执行第三方脚本，需要独立的权限与隔离设计，不能只套一个 Node `vm` 或 Worker 后宣称安全。

## 8. 自托管团队技术路线

团队是个人稳定版之后的独立部署边界：

| 能力       | 计划技术                                | 引入条件与边界                                                             |
| ---------- | --------------------------------------- | -------------------------------------------------------------------------- |
| API        | Fastify + TypeScript + Zod/OpenAPI      | 与本地接口共用契约和领域规则，不共用桌面权限                               |
| 元数据     | PostgreSQL + Drizzle                    | 团队成员、项目权限、资源版本、租约、审计；浏览器数据不塞入 JSON 字段       |
| 文件       | S3 兼容接口；优先 AWS SDK v3 的所需子包 | 只上传已完成的版本化快照；兼容的对象存储部署另行核验许可                   |
| 身份       | 成熟 OIDC 提供方和服务端会话            | 不自创密码认证；服务端逐资源授权，设备/成员撤销可验证                      |
| 加密交接   | 经过审查的 AEAD 与密钥封装实现          | 先定密钥归属、恢复、轮换和设备加入方案，再选定库；不承诺远程擦除已解密副本 |
| 部署       | Docker Compose                          | API、数据库、对象存储最小组合；Redis/额外 Worker 按负载需求加入            |
| Web 管理端 | 复用 React、路由、UI 和 API 客户端      | 用于成员/设备/审计；不赋予网页任意本地能力                                 |

不同时引入 NestJS 和 Fastify 两套应用架构。若团队模块、组织规模和依赖注入需求使 Fastify 的显式组织方式不足，另作有迁移证据的评估。当前不为未实施的团队版本创建空服务或搭建云基础设施。

租约使用服务端时间、版本条件提交与 fencing token；客户端网络分区和离线浏览器是明确的产品限制。快照是不可变版本对象，不用逐文件最后写入胜出替代团队并发控制。

## 9. AI、数据处理与长期库边界

- 浏览器工具先由确定性命令和授权模型定义。AI 只调用这一边界，不直接访问 SQLite、任意 shell 或内核管理权限。
- LangGraph 可在需要可恢复的模型决策流程时评估；LangChain 按所需模型/文档适配器引入，不作为普通 CRUD 或环境启动依赖。
- RAG 从团队已有 PostgreSQL + pgvector 候选开始；只有具体检索质量/数据规模验证需要时再加向量系统。
- Python 仅用于无法合理在 JS 内完成的特定内核、OCR、文档或数据任务，以独立打包 Worker 提供，不能要求普通用户自行配全套开发环境。
- HTTP/文件/CSV/XLSX 等按实际业务模板选择小范围库；原路线中的长依赖清单不作为提前安装承诺。
- 数据处理与 AI 的库、许可、网络目的地、资源上限和取消行为随功能进入开发时核查。基础环境管理保持离线可用。

## 10. 引入与替换决策表

| 决策                              | 原因                                                         | 重新评估的触发条件                                                     |
| --------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 保留 Electron，不迁移 Wails/Tauri | 已有行为、UI、IPC 与构建可复用；当前缺口集中于领域和运行职责 | 实测资源成本/平台约束无法通过模块改进解决，且有完整迁移样例            |
| 保留一套 Base UI/shadcn           | 支持现有主题、RTL 与组件组合，减少基础组件重复               | 出现无法修复的无障碍/平台问题，不因参考项目使用另一套 primitive 就迁移 |
| 先一个生产指纹提供方              | 控制平台与能力组合数量，建立真实验证基线                     | 第二提供方有明确用户价值并独立通过完整矩阵                             |
| 计划引入 TanStack Query           | 消除 AppDataProvider 的跨领域读取与缓存混合                  | 独立试点证明事件、查询与提交一致性后扩展                               |
| SQLite 单驱动                     | 现有数据可保留，迁移/恢复的投入优先于换 ORM                  | 持久化阻塞或团队需求出现，有基准与迁移方案                             |
| API/MCP 早于可视化工作流          | 先建立可编排命令和运行闭环                                   | 有真实用户需求改变顺序时更新产品路线                                   |
| 团队晚于个人稳定版                | 团队放大运行和数据恢复问题                                   | 本地闭环和数据兼容性已验证，才开启服务器和跨设备交接                   |

## 11. 依赖、验证与发布

新增依赖在实际引入的提交中记录用途、精确版本、许可、原生模块、网络行为/遥测和替换边界。方案中的候选列表不是依赖安装授权清单；本轮没有新增任何依赖。

- 版本以锁文件和已验证组合为准，不在规划文档中长期宣称某库是“最新”。
- 原生模块按 OS/架构/Electron ABI 验证。当前 node:sqlite 路线不因引入备份就换用另一个 SQLite 原生模块。
- 上游源码、下载资源、字体、图标、内核及测试数据分别审查许可。应用的 MIT/AGPL 标记不能覆盖第三方二进制。
- Renderer 继续采用 contextIsolation、sandbox 和限制性 CSP；外部浏览器与管理端不共享本地权限。
- 格式、lint、类型和契约/单元测试保留；运行状态、安装、指纹和恢复增加真实集成验证。
- 发布前核查受支持 Electron/Node 版本、签名/公证、安装包完整性、SBOM 与升级路径；是否签名如实按平台列出，不能由 CI 构建通过推导。
- 回退应用代码、回退数据库、回退浏览器内核与恢复用户目录是四项独立操作，发布说明必须写明可行范围。

## 12. 官方依据与参考入口

指纹产品的提交快照和源码路径统一维护在 [项目规划附录](project-plan.md#附录-a调研快照与关键源码)，本文件不重复维护另一份版本表。

- [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)
- [Node.js 发布计划](https://github.com/nodejs/Release/blob/main/schedule.json)与 [SQLite API](https://nodejs.org/api/sqlite.html)
- [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview)、[TanStack Router](https://tanstack.com/router/latest/docs/framework/react/overview)、[TanStack Table](https://tanstack.com/table/latest/docs/introduction)
- [shadcn/ui](https://ui.shadcn.com/docs)、[Base UI](https://base-ui.com/react/overview/quick-start)、[shadcn-admin 许可](https://github.com/satnaing/shadcn-admin/blob/main/LICENSE)
- [Playwright BrowserType](https://playwright.dev/docs/api/class-browsertype)
- [Fastify](https://github.com/fastify/fastify)、[MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)、[React Flow](https://github.com/xyflow/xyflow)
- [Drizzle](https://github.com/drizzle-team/drizzle-orm)、[AWS SDK v3](https://github.com/aws/aws-sdk-js-v3)、[BullMQ](https://github.com/taskforcesh/bullmq)
- [yauzl](https://github.com/thejoshwolfe/yauzl)、[yazl](https://github.com/thejoshwolfe/yazl)
- [Chrome App-Bound Encryption](https://security.googleblog.com/2024/07/improving-security-of-chrome-cookies-on.html)
