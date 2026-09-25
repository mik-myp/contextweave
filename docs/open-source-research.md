# 开源指纹浏览器调研与规划采纳记录

**核查日期：** 2026-09-25（UTC；本地 Asia/Shanghai 为 2026-09-26）

**项目基线：** `v0.1.5` 已发布，`master` 为 `407d053`；本轮只更新规划，不启动 `v0.1.6`、修改产品版本或发布。

**职责：** 保存外部证据、借鉴理由与取舍，不维护另一套版本路线。产品边界见[总体规划](project-plan.md)，具体小版本、依赖与验收见[版本台账第 3.1 节](version-roadmap.md#31-开源调研增补的执行口径)，实现边界见[技术栈](technology-stack.md)。

## 1. 方法与证据强度

- 从 GitHub 搜索发现候选，再通过仓库 API 核对默认分支提交、递归文件树、许可证文本、发行记录与部分相关 issues；有价值的交互继续阅读组件、服务与测试源码。
- 下列 11 个仓库在核查时均未被标记为归档；这只是时间点事实，不表示有维护保障。提交活跃、发布安装包和功能成熟是不同证据，不按 star 数、宣传截图或检测站分数排序。
- 所有源码链接固定到本次读取的 commit；默认分支可能领先发行包。未安装或运行这些参考产品，未执行它们的测试、安装脚本或内核；交互判断来自组件和流程代码，不是实机体验结论。
- **README 声明、源码可见、上游问题报告、本项目实测**分别记录。下文“采纳”只表示纳入设计，不表示借鉴对象已可靠实现，也不表示 ContextWeave 已实现。
- 本次不复制外部代码，不安装新依赖、不引入第二套运行时或服务端。根项目许可证仍待维护者决定；任何后续代码、数据集、字体或二进制复用都需单独检查授权与兼容条件。
- 保留个人 SQLite 本地优先、远程空间用户自备 PostgreSQL/S3、无官方托管服务、无独立 ContextWeave 业务服务端、不维护内核源码、单人顺序开发及三目标架构的边界。

## 2. 已核查的仓库快照

表中日期是默认分支提交的 UTC 日期，不是最新稳定版本的发布日期；许可栏描述检查到的文件，不构成整个产品或发行物的许可保证。

| 编号 | 仓库 / 固定快照                                                                                                                                            | 提交日期   | 实际开放范围                    | 许可观察                                                                                                                                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S01  | [black-ant/Ant-Browser](https://github.com/black-ant/Ant-Browser/tree/61feab721f71d65301dfa45397cb9e15e28e8fd8) / `61feab721f71`                           | 2026-09-20 | 桌面环境管理器                  | [未发现独立许可证；README 明示待补](https://github.com/black-ant/Ant-Browser/blob/61feab721f71d65301dfa45397cb9e15e28e8fd8/README.md)                           |
| S02  | [zhom/donutbrowser](https://github.com/zhom/donutbrowser/tree/b11161496cb5231d367fa0cc0d3919a42317afc6) / `b11161496cb5`                                   | 2026-09-23 | 桌面环境管理器                  | [AGPL-3.0；不等于内置内核同许可](https://github.com/zhom/donutbrowser/blob/b11161496cb5231d367fa0cc0d3919a42317afc6/LICENSE)                                    |
| S03  | [adryfish/fingerprint-chromium](https://github.com/adryfish/fingerprint-chromium/tree/3f61b0dfa665e883da8824b1450601fc529dd006) / `3f61b0dfa665`           | 2026-06-21 | 当前内核发行上游                | [仓库 BSD-3-Clause；内核源码对应关系待核验](https://github.com/adryfish/fingerprint-chromium/blob/3f61b0dfa665e883da8824b1450601fc529dd006/LICENSE)             |
| S04  | [daijro/camoufox](https://github.com/daijro/camoufox/tree/c769df8ea84c5cc04557f4cd133462459216d2ab) / `c769df8ea84c`                                       | 2026-09-25 | Firefox 衍生内核与启动库        | [MPL-2.0；仍需核对分发组件 notices](https://github.com/daijro/camoufox/blob/c769df8ea84c5cc04557f4cd133462459216d2ab/LICENSE)                                   |
| S05  | [daijro/browserforge](https://github.com/daijro/browserforge/tree/a8b798f37460d1dd02aea33f80c83647913a1bbd) / `a8b798f37460`                               | 2026-08-29 | Python 指纹/请求头生成库        | [Apache-2.0](https://github.com/daijro/browserforge/blob/a8b798f37460d1dd02aea33f80c83647913a1bbd/LICENSE)                                                      |
| S06  | [apify/fingerprint-suite](https://github.com/apify/fingerprint-suite/tree/67866a6196658076a7b61ecbe2c590a2ff3f4057) / `67866a619665`                       | 2026-09-21 | TypeScript 指纹工具库集合       | [Apache-2.0](https://github.com/apify/fingerprint-suite/blob/67866a6196658076a7b61ecbe2c590a2ff3f4057/LICENSE.md)                                               |
| S07  | [aitofy-dev/browser-profiles](https://github.com/aitofy-dev/browser-profiles/tree/1e1f00b21e00952e5f58003b4b9b851fbcc26e1f) / `1e1f00b21e00`               | 2026-09-11 | TypeScript 环境管理库及 CLI/MCP | [MIT；不等于原生指纹内核](https://github.com/aitofy-dev/browser-profiles/blob/1e1f00b21e00952e5f58003b4b9b851fbcc26e1f/LICENSE)                                 |
| S08  | [polyackiy/camoufox-profile-manager](https://github.com/polyackiy/camoufox-profile-manager/tree/f0bf3048887855c86fdaf3492beb757fa4fe7ab5) / `f0bf30488878` | 2026-09-15 | Camoufox 环境管理器             | [MIT；内核、依赖另行核验](https://github.com/polyackiy/camoufox-profile-manager/blob/f0bf3048887855c86fdaf3492beb757fa4fe7ab5/LICENSE)                          |
| S09  | [CloakHQ/CloakBrowser-Manager](https://github.com/CloakHQ/CloakBrowser-Manager/tree/c393d88c66fe2790ed8ea753c095ad48b9498486) / `c393d88c66fe`             | 2026-09-10 | 管理器源码与桌面/服务器包装     | [GUI 源码 MIT；依赖单独授权的二进制](https://github.com/CloakHQ/CloakBrowser-Manager/blob/c393d88c66fe2790ed8ea753c095ad48b9498486/LICENSE)                     |
| S10  | [CloakHQ/CloakBrowser](https://github.com/CloakHQ/CloakBrowser/tree/9bc5e374d7fc3a4099360bbd93e570b1e7ec8618) / `9bc5e374d7fc`                             | 2026-09-24 | 启动包装库及内核发行            | [包装代码 MIT；二进制使用单独的专有条款](https://github.com/CloakHQ/CloakBrowser/blob/9bc5e374d7fc3a4099360bbd93e570b1e7ec8618/BINARY-LICENSE.md)               |
| S11  | [gologinapp/gologin](https://github.com/gologinapp/gologin/tree/252caf67b8ccb116a5e6a33f77c80d75c9bc39b4) / `252caf67b8cc`                                 | 2026-09-16 | GoLogin/Orbita API SDK          | [package.json 声明 GPL-3.0，未发现独立 LICENSE；不是完整产品](https://github.com/gologinapp/gologin/blob/252caf67b8ccb116a5e6a33f77c80d75c9bc39b4/package.json) |

发行记录抽查：Ant 的 API 返回了 [`V1.8.0`](https://github.com/black-ant/Ant-Browser/releases/tag/V1.8.0) 安装包，但该源码 README 已出现 1.8.1 说明，不能视为同一已发布范围；Donut [`v0.31.2`](https://github.com/zhom/donutbrowser/releases/tag/v0.31.2) 有 Windows x64、两种 Mac 架构的应用包，但应用包不证明内核来源或三平台指纹能力合格。Camoufox 的发行列表还包含[字体包 tag](https://github.com/daijro/camoufox/releases/tag/font-bundle-v1) 和[带 beta 名称的内核](https://github.com/daijro/camoufox/releases/tag/v152.0.4-beta.30)，不能按列表第一项或 `prerelease=false` 自动判定“正式稳定内核”。本项目当前使用的 fingerprint-chromium `148.0.7778.215` 仍按自己的安装与验证记录管理。

搜索中发现的 `Zavy-Borzenko/camoufox-profile-manager` 与 `0xOmarA/BrowseForge` 候选在本次仓库 API 读取时返回 404，未作为实现或许可证据；另独立核实了上表 S08，未假定它与前一地址存在迁移关系。

## 3. 值得吸收的具体设计

### 3.1 Ant Browser：备份入口、冲突预览与异常信息

证据：[backend/app_backup_manifest.go](https://github.com/black-ant/Ant-Browser/blob/61feab721f71d65301dfa45397cb9e15e28e8fd8/backend/app_backup_manifest.go)、[backend/app_backup_import_flow.go](https://github.com/black-ant/Ant-Browser/blob/61feab721f71d65301dfa45397cb9e15e28e8fd8/backend/app_backup_import_flow.go)、[frontend/src/modules/backup/components/ProfilePackageConflictModal.tsx](https://github.com/black-ant/Ant-Browser/blob/61feab721f71d65301dfa45397cb9e15e28e8fd8/frontend/src/modules/backup/components/ProfilePackageConflictModal.tsx)、[frontend/src/modules/browser/components/BrowserProfileCopyForm.tsx](https://github.com/black-ant/Ant-Browser/blob/61feab721f71d65301dfa45397cb9e15e28e8fd8/frontend/src/modules/browser/components/BrowserProfileCopyForm.tsx)。

源码展示了清单检查、分阶段导入、实例包冲突选择和配置复制入口。值得借鉴的是让用户看见范围、冲突、进度与结果，而不是只提供“导入成功”按钮。

ContextWeave 的差异化约束：三渠道复用同一恢复引擎；恢复为新环境、明确覆盖或跳过必须事先可见；不按名称自动覆盖，不照搬全库合并导入；凭据仍走安全存储，不把参考项目的 `backup.local.yaml` 分类或界面脱敏视为安全存储要求的替代。全局 ZIP 备份与实例包导入是不同路径，不能因存在冲突弹窗就推断其所有恢复路径都具备事务回滚。对应 R03、R08、R09。

### 3.2 Donut：高密度环境管理与可预览的代理分配

证据：[src/components/profile-data-table.tsx](https://github.com/zhom/donutbrowser/blob/b11161496cb5231d367fa0cc0d3919a42317afc6/src/components/profile-data-table.tsx)、[src-tauri/src/proxy_distribution.rs](https://github.com/zhom/donutbrowser/blob/b11161496cb5231d367fa0cc0d3919a42317afc6/src-tauri/src/proxy_distribution.rs)、[src/components/proxy-distribution-dialog.tsx](https://github.com/zhom/donutbrowser/blob/b11161496cb5231d367fa0cc0d3919a42317afc6/src/components/proxy-distribution-dialog.tsx)、[src-tauri/src/fingerprint_consistency.rs](https://github.com/zhom/donutbrowser/blob/b11161496cb5231d367fa0cc0d3919a42317afc6/src-tauri/src/fingerprint_consistency.rs)、[src-tauri/src/extension_manager.rs](https://github.com/zhom/donutbrowser/blob/b11161496cb5231d367fa0cc0d3919a42317afc6/src-tauri/src/extension_manager.rs)。

可见分组/标签、行内状态、启动阶段、扩展组合，以及把代理分配先计算为计划再应用的逻辑；数量不足、正在运行的环境、已有绑定和剩余代理分别表达，而非默默循环分配。出口一致性检查也区分“比较过”和“没有足够信息进行比较”。

采纳轻量分组/标签/备注、保存筛选视图、批次计划、代理一对一分配预览和逐项诊断；不仿制整套界面、不立即增加 VPN/代理订阅/云同步。其 [同步预检](https://github.com/zhom/donutbrowser/blob/b11161496cb5231d367fa0cc0d3919a42317afc6/src-tauri/src/sync/preflight.rs) 分开检查服务与客户端所访问存储的可达性，值得借鉴分段诊断；团队租约与条件提交仍采用本项目自己的协议。它的自托管同步仍包含独立的 [donut-sync 服务](https://github.com/zhom/donutbrowser/blob/b11161496cb5231d367fa0cc0d3919a42317afc6/donut-sync/README.md)，不符合本项目不维护独立业务服务端的边界。AGPL 管理器源码也不能替 Wayfern 等发行内核完成开放范围和许可核验。对应 R01、R02、R04、R05、R07、R11。

### 3.3 当前内核与 Camoufox：能力证据比参数数量重要

证据：[fingerprint-chromium 文件树](https://github.com/adryfish/fingerprint-chromium/tree/3f61b0dfa665e883da8824b1450601fc529dd006)、[README-ZH.md](https://github.com/adryfish/fingerprint-chromium/blob/3f61b0dfa665e883da8824b1450601fc529dd006/README-ZH.md)、[pythonlib/camoufox/locales.py](https://github.com/daijro/camoufox/blob/c769df8ea84c5cc04557f4cd133462459216d2ab/pythonlib/camoufox/locales.py)、[pythonlib/camoufox/fingerprints.py](https://github.com/daijro/camoufox/blob/c769df8ea84c5cc04557f4cd133462459216d2ab/pythonlib/camoufox/fingerprints.py)、[pythonlib/camoufox/pkgman.py](https://github.com/daijro/camoufox/blob/c769df8ea84c5cc04557f4cd133462459216d2ab/pythonlib/camoufox/pkgman.py)。

上游 README 明确采用延迟公开补丁的策略，并将 Chrome 148 源码标为随 Chrome 149 发布。进一步核对发现，[旧版 `144.0.7559.132` 对应提交](https://github.com/adryfish/fingerprint-chromium/tree/831623f2965e34554304caabfc3a1e4e3741db1f)有 `patches/extra/fingerprint/` 等源码；而当前使用的 `148.0.7778.215` tag 指向 S03 快照，其文件树只有两份 README、LICENSE 与图片。因此不能笼统称该项目没有源码，准确缺口是**本次尚不能核对当前 148 发行物对应的改动补丁**。

仓库 BSD 声明、旧版源码和可下载的新版发行包是不同证据。将当前使用版本的源码/发行对应关系、第三方 notices、再分发条件与受支持架构纳入既有准入门槛；这不是侵权判断，也不擅自替换、降级已有环境或接手源码维护。不能让“已经接入”自动变成“正式合格”。

Camoufox 的源码可见语言/地区处理、指纹配置及按平台选包逻辑，适合作为能力分层与验证样本。它基于 Firefox，不能视作 Chromium 扩展或 CDP 的等价替代，更不能直接填上 Intel Mac 的现有指纹内核缺口。只借鉴显式能力报告、网络派生配置与固定版本策略，不在个人首发增加第二个正式提供方。对应 R05、R06。

### 3.4 BrowserForge 与 fingerprint-suite：受约束的配置而非独立乱填字段

证据：[browserforge/fingerprints/generator.py](https://github.com/daijro/browserforge/blob/a8b798f37460d1dd02aea33f80c83647913a1bbd/browserforge/fingerprints/generator.py)、[browserforge/headers/generator.py](https://github.com/daijro/browserforge/blob/a8b798f37460d1dd02aea33f80c83647913a1bbd/browserforge/headers/generator.py)、[packages/fingerprint-generator/src/fingerprint-generator.ts](https://github.com/apify/fingerprint-suite/blob/67866a6196658076a7b61ecbe2c590a2ff3f4057/packages/fingerprint-generator/src/fingerprint-generator.ts)、[packages/header-generator/src/header-generator.ts](https://github.com/apify/fingerprint-suite/blob/67866a6196658076a7b61ecbe2c590a2ff3f4057/packages/header-generator/src/header-generator.ts)。

这些工具把浏览器、系统、屏幕、语言与请求头等条件作为相关输入，启发我们区分“配置形状合法”与“组合可用”。采纳的是规则校验与冲突解释：对目标内核不支持、组合矛盾和未观察字段给出不同结果；不自动把所有字段都生成并注入。

本轮不安装它们：Python 运行时、生成数据的来源/更新、JS 注入与原生内核修改叠加、HTTP 与页面观察值不一致都需要独立评估。指纹生成库不是指纹内核，更不提供跨网站有效性保证。对应 R03、R05；实际依赖采用仍属 Q02。

### 3.5 browser-profiles 与 Camoufox Profile Manager：统一命令与身份稳定

证据：[docs/adr/0001-command-registry.md](https://github.com/aitofy-dev/browser-profiles/blob/1e1f00b21e00952e5f58003b4b9b851fbcc26e1f/docs/adr/0001-command-registry.md)、[src/commands/registry.ts](https://github.com/aitofy-dev/browser-profiles/blob/1e1f00b21e00952e5f58003b4b9b851fbcc26e1f/src/commands/registry.ts)、[src/camoufox_pm/core/fingerprint_store.py](https://github.com/polyackiy/camoufox-profile-manager/blob/f0bf3048887855c86fdaf3492beb757fa4fe7ab5/src/camoufox_pm/core/fingerprint_store.py)、[tests/browser/test_fingerprint_stability.py](https://github.com/polyackiy/camoufox-profile-manager/blob/f0bf3048887855c86fdaf3492beb757fa4fe7ab5/tests/browser/test_fingerprint_stability.py)、[tests/integration/test_api_contract.py](https://github.com/polyackiy/camoufox-profile-manager/blob/f0bf3048887855c86fdaf3492beb757fa4fe7ab5/tests/integration/test_api_contract.py)。

前者将 CLI/MCP 共用的命令与 schema 集中定义，并区分协议输出和诊断日志；后者区分长期硬件身份、随网络变化的地区属性、随版本变化的浏览器信息，并提供稳定性和接口契约测试代码。这些测试的存在不代表已在本项目运行通过。

采纳命令注册表、结构化错误/能力发现、稳定身份与配置来源分层、离线受控测试。不要照搬原始代理 URL 携密、开放原生 CDP、可选关闭凭据加密或可选关闭 API 认证等行为。首发仍使用现有 TypeScript/Electron 边界，不嵌入参考项目的 Python Web 服务。对应 R03、R05、R10、R12。

### 3.6 CloakBrowser 与 GoLogin：开放范围的反例筛选

证据：[LICENSE](https://github.com/CloakHQ/CloakBrowser-Manager/blob/c393d88c66fe2790ed8ea753c095ad48b9498486/LICENSE)、[frontend/src/components/ProfileForm.tsx](https://github.com/CloakHQ/CloakBrowser-Manager/blob/c393d88c66fe2790ed8ea753c095ad48b9498486/frontend/src/components/ProfileForm.tsx)、[BINARY-LICENSE.md](https://github.com/CloakHQ/CloakBrowser/blob/9bc5e374d7fc3a4099360bbd93e570b1e7ec8618/BINARY-LICENSE.md)、[package.json](https://github.com/gologinapp/gologin/blob/252caf67b8ccb116a5e6a33f77c80d75c9bc39b4/package.json)、[README.md](https://github.com/gologinapp/gologin/blob/252caf67b8ccb116a5e6a33f77c80d75c9bc39b4/README.md)。

CloakBrowser 的管理端/包装代码与实际浏览器二进制不是同一授权范围；二进制文本明确采用专有条款并限制再分发。GoLogin 仓库描述的是通过其 API 控制 Orbita 的 SDK，需要相应账号 token，不能据此认定完整产品开源或可脱离其服务使用。

因此只将它们作为交互与接入边界的对照，不列为本项目的开源内核替代、团队后端或必需依赖。凭据输入的显示/隐藏交互可以独立设计，但不引入其账号、付费授权、远程管理服务或“通过某检测”的宣传承诺。

## 4. 采纳清单：实际增量、优先级与维护成本

**P0**：既有安全/可靠性要求的细化，不新增业务方向。**P1**：已纳入规划的轻量功能增量，目标小版本在进入相应版本线前结合工作量冻结，不自动成为原先未承诺的个人首发门槛。**P2**：后期候选，需要先验证，不算已承诺交付。

成本仅作单人相对估计：**S** 为复用边界的交互/契约细化；**M** 涉及新元数据、任务或跨层测试，需拆工作包；**L** 为新内核/运行时/基础设施，不纳入本轮近期增量。不是工期承诺。

| 需求                   | 当前已有或已规划                                   | 本轮采纳的增量                                                               | 优先级 / 成本           | 来源与执行位置                                                                            |
| ---------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| R01 环境组织           | 已有搜索、筛选、排序与选择                         | 单层分组、多标签、备注和可保存筛选视图；分组不是权限边界                     | P1 / M                  | S01、S02；[个人底座](version-roadmap.md#51-调研增补环境组织与批量交互)                    |
| R02 批量任务交互       | 已有批量操作与部分失败；后台任务已有规划           | 固定本批目标、执行前预览、分阶段进度、仅重试失败项、可见跳过原因             | P0 / S                  | S02；[个人底座](version-roadmap.md#51-调研增补环境组织与批量交互)                         |
| R03 配置模板与安全复制 | 已有稳定 seed；已规划配置复用                      | 命名模板与仅配置克隆；新环境新 ID/目录/seed；不复制网站会话或秘密正文        | P1 / M                  | S01、S05～S08；[环境能力](version-roadmap.md#61-调研增补环境配置代理与扩展)               |
| R04 代理导入与分配     | v0.1.3 已有批量导入、逐行结果和去重                | 导入前预览、绑定使用情况与一对一分配计划；不足不循环复用，变化不暗改运行环境 | P1 / M                  | S01、S02；[环境能力](version-roadmap.md#61-调研增补环境配置代理与扩展)                    |
| R05 一致性与诊断       | v0.1.4 已有出口 IP 时区/推荐语言；已规划有效值检查 | 手工值/网络派生值/浏览器观察值并列；已验证、不一致、未检测、不支持、失败分开 | P0 / M                  | S02～S08；[环境能力](version-roadmap.md#61-调研增补环境配置代理与扩展)                    |
| R06 内核版本与来源     | 已有安装/删除；已规划升级回退与能力表              | 来源证据门禁、受影响环境清单与升级预检；已升级目录不直接用旧内核打开         | P0 / S                  | S03、S04；[环境能力](version-roadmap.md#61-调研增补环境配置代理与扩展)                    |
| R07 扩展配置组合       | 未打包扩展、来源/迁移已在首发规划                  | 可复用的扩展配置集合与权限差异；资源与每环境可写数据分开，更新需显式应用     | P1 / M；数据保护仍为 P0 | S01、S02；[环境能力](version-roadmap.md#61-调研增补环境配置代理与扩展)                    |
| R08 恢复预览           | 三渠道、一致性/加密/恢复已在规划                   | 大小与排除项预估、冲突映射、恢复为新环境/明确覆盖/跳过、完成后的待处理清单   | P0 / M                  | S01、S02；[本地备份](version-roadmap.md#71-调研增补恢复预览与冲突处理)                    |
| R09 备份状态           | 定时、互斥、保留上限已在规划                       | 分开显示最近尝试、最近成功、最近恢复验证；保留策略支持预览                   | P0 / S                  | S01；[远端与调度](version-roadmap.md#81-调研增补调度可见性与恢复点保护)                   |
| R10 统一命令入口       | GUI/API/CLI/MCP 共用命令已在规划                   | 由白名单命令元数据驱动工具说明/帮助/结构化错误，补接口一致性测试             | P0 / M                  | S02、S07、S08；[控制入口](version-roadmap.md#91-调研增补契约发现与诊断输出)               |
| R11 团队交接状态       | 权限、租约、快照发布已在规划                       | 配置/本地副本/运行占用/上传/提交状态分开；失败保留本地唯一修改与可操作提示   | P0 / S                  | S02 的同步预检作为对照；[团队交接](version-roadmap.md#121-调研增补交接状态与失败恢复入口) |
| R12 可复现诊断         | 网站测试与产物已有远期规划                         | 受控测试页、配置修订/内核版本绑定、跨重启观察值对比与脱敏报告                | P2 / M                  | S03～S08；[开发测试预排](version-roadmap.md#143-v16x开发与网站测试)                       |

其中 R01、R03、R04 和 R07 的轻量功能是主要净新增；其余大多把已有计划变成可验收的交互和失败行为。R12 只扩充远期候选，不把网站测试平台提前作为个人版依赖。

## 5. 验证后再决定或明确不采用

| 候选                                             | 决定                              | 原因与重新评估条件                                                                                         |
| ------------------------------------------------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Q01 Camoufox 等第二内核                          | 待验证，P2 / L；不纳入个人首发    | 独立验证控制协议、三平台发行、扩展兼容、数据目录和维护量；不能因有 Intel 包就当成 Chromium 等价替代        |
| Q02 指纹生成/注入库                              | 待验证，P2 / M～L；本轮不新增依赖 | 先证明需要、许可证和数据来源可接受、与原生内核不冲突；不要为校验少数字段引入另一运行时或叠加注入           |
| Q03 Cookie 导入与第三方浏览器完整迁移            | 待验证，P2 / L                    | 首先交付自身备份恢复；跨 OS 加密绑定、扩展数据、浏览器格式和授权范围必须可验证，不能承诺无损免登录         |
| Q04 书签组、系统默认浏览器、外链路由、全局快捷键 | 反馈驱动的后续候选，未排小版本    | 避免首发范围膨胀；需要显式配置，不能强塞推荐书签、推广链接或抢占系统默认项                                 |
| Q05 多窗口动作同步/录制回放                      | 仅作后续工作流候选，P2 / L        | 同一个动作会产生多份外部副作用；需目标预览、权限、暂停、窗口/焦点映射、失败隔离，不能等同普通批量启停      |
| Q06 VPN、代理订阅/轮换与多协议代理核心           | 暂不采用                          | 继续现有 HTTP/HTTPS/SOCKS5 范围；稳定绑定与出口可诊断优先，未经确认不自动更换 IP、不额外维护代理内核       |
| Q07 商业服务 SDK / 专有内核作为必需项            | 不采用当前方案                    | 不把公开 SDK、免费试用、source-available 或外层 MIT 等同完整开源；不让用户依赖另一家官方账号才能使用本项目 |
| Q08 云端自动合并、P2P 同步、独立业务服务端       | 不采用当前方案                    | 与本地优先、单一权威数据源、显式迁移、PostgreSQL/S3 用户自备及无业务服务端边界冲突                         |
| Q09 自动养号、验证码绕过或“防关联分数”           | 不纳入产品目标                    | 专注授权使用、隔离与可验证性，不接受宣传承诺代替能力证明                                                   |

## 6. 从公开问题报告提炼验收，而不是照抄结论

以下为核查时看到的上游问题报告，**均未在本项目复现**；用于设计测试，不将其描述为 ContextWeave 已知缺陷或上游当前版本必然仍有的问题。

| 公开报告                                                                                                     | 提炼的本项目验收场景                                                                         | 归属          |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------- |
| [Ant #67：跨机器恢复登录态丢失](https://github.com/black-ant/Ant-Browser/issues/67)                          | 恢复清单区分文件完整与凭据可用；不可迁移的登录状态明确提示，不承诺网站免登录                 | R08，备份恢复 |
| [Ant #61：扩展设置在重启后被重置](https://github.com/black-ant/Ant-Browser/issues/61)                        | 扩展升级/恢复不以安装包覆盖每环境的可写数据；冷启动后核对扩展存储，失败保留好副本            | R07、R08      |
| [Donut #573：不完整指纹结果被持久化](https://github.com/zhom/donutbrowser/issues/573)                        | 内核返回值也做 schema 与组合校验；失败不得污染已存配置，不把打开了窗口当作身份设置成功       | R05           |
| [Donut #570：Windows 阻止未签名内核启动](https://github.com/zhom/donutbrowser/issues/570)                    | 管理器签名与内核签名分别记录；系统安全策略拒绝时提供诊断，不指导关闭整机保护作为常规方案     | R06           |
| [fingerprint-chromium #88：Windows GPU 相关异常](https://github.com/adryfish/fingerprint-chromium/issues/88) | 在自有测试页验证 GPU/渲染能力及配置是否生效；不照抄关闭 GPU 等参数，也不用绕过检测站作为验收 | R05、R06      |
| [Camoufox #783：冷启动默认字体不稳定](https://github.com/daijro/camoufox/issues/783)                         | 同配置跨重启检查字体/渲染观察值；把不支持或不确定行为列为限制，不只比 seed 字段              | R05、R12      |

## 7. 本轮实施边界与后续复核

1. `v0.1.6` / `v0.1.7` 仍按既定缺陷、进程边界与发布基线收敛；上游证据缺口属于既有风险盘点，不增加成组新功能，更不直接宣称修复上游报告。
2. 按版本台账顺序建设底座、环境能力、备份、控制入口和团队交接；P1 开发前拆成单人可验收的工作包，不以复刻某个产品为目标。
3. 不新增长期维护的框架、内核分支或网络服务；借鉴交互与逻辑，独立实现。实际复用代码前重新核验许可证、版本、依赖、遥测与替换成本。
4. 在进入相关版本线时重新检查来源、发行物与 issues；固定快照保持为历史证据，不将本次提交日期长期写成“最新”。

### 7.1 本轮文档变更检查

- `pnpm check` 通过：格式、lint、类型检查与测试全部通过，本机 56 个测试文件、409 项测试通过。
- 四份变更 Markdown 另做 Prettier 检查；本地文件/标题链接及固定 GitHub 源码路径已核对。
- `git diff --check` 通过；原有 `README.md` 与未跟踪的 `BUGS.md` 内容校验值不变，已发布版本的实施台账未改写。
- 未修改应用代码、依赖或版本；未提交/推送、创建 tag 或发布。没有运行第三方产品或重新进行三平台浏览器验收。
