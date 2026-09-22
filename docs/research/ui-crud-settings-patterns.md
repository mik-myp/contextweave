# B 端 CRUD、指纹环境管理与设置页研究

**修订号：** r8
**状态：** 分析中
**日期：** 2026-09-22
**适用范围：** ContextWeave v0.1 个人版 UI 设计与后续环境管理
**关联文档：** [项目总体规划](../project-plan.md)、[v0.1 执行文档](../versions/v0.1-execution-r6.md)、[v0.1 进度](../progress/v0.1.md)

本文记录对 GitHub 上通用 B 端项目、指纹浏览器项目和管理端项目的静态源码审阅结果。它用于支持 ContextWeave 的页面和交互设计，不自动扩大已经确认的 v0.1 执行范围，也不等同于对这些项目完整运行行为的测试。

## 1. 研究方法和证据边界

本次研究使用 GitHub 仓库的固定 commit 查看组件源码，优先检查列表页、筛选工具栏、行操作、批量操作、编辑表单、设置导航和主题偏好。以下链接都指向审阅时的 commit，而不是会随时间变化的默认分支。

- 研究对象是源码结构和交互状态表达，不是对线上 Demo 的可用性承诺。
- 代码中出现的组件名称和状态只说明该 commit 中存在相应实现，不代表每个项目在所有平台、后端或数据量下都已验证。
- AGPL 项目只用于交互和信息架构参考。ContextWeave 不直接复制其实现代码、样式或资源。
- 许可证信息来自 GitHub 仓库元数据和仓库声明；`NOASSERTION` 不代表可以自由复用。

## 2. 审阅项目

| 项目 | 固定 commit | GitHub 许可证元数据 | 本次重点 |
|---|---|---|---|
| [shadcn-admin](https://github.com/satnaing/shadcn-admin/tree/e16c87f213a5ba5e45964e9b67c792105ec74d26) | `e16c87f213a5ba5e45964e9b67c792105ec74d26` | MIT | 通用用户 CRUD、数据表格、筛选、批量操作、设置页 |
| [new-api](https://github.com/QuantumNous/new-api/tree/9310231b3c27fea933e939b46cf26e0ce67192e3) | `9310231b3c27fea933e939b46cf26e0ce67192e3` | AGPL-3.0 | 渠道管理、服务端筛选、复杂 Drawer、设置注册表、主题切换 |
| [Simprint](https://github.com/Simprint/simprint/tree/d2dc939bfae8efda8e4e4d791587d7a364ca4dd8) | `d2dc939bfae8efda8e4e4d791587d7a364ca4dd8` | AGPL-3.0 | 指纹环境工作台、状态视图、批量环境操作、环境编辑、系统设置 |
| [CloakBrowser Manager](https://github.com/CloakHQ/CloakBrowser-Manager/tree/c393d88c66fe2790ed8ea753c095ad48b9498486) | `c393d88c66fe2790ed8ea753c095ad48b9498486` | GitHub API 返回 `NOASSERTION` | Electron/桌面管理器中的 Profile 列表、搜索、运行状态、设置 |
| [vue-vben-admin](https://github.com/vbenjs/vue-vben-admin/tree/edbc42caaaa5b33fe61349063cc94cd36a1c5f30) | `edbc42caaaa5b33fe61349063cc94cd36a1c5f30` | MIT | 企业级用户 CRUD、部门树、表单 Drawer、详情 Drawer、偏好设置 |

## 3. 共同的 CRUD 页面结构

五个项目虽然技术栈和业务不同，但成熟的管理列表基本都收敛到下面的顺序：

```text
页面标题和说明
→ 工具栏：搜索、筛选、刷新、视图选项、创建
→ 数据列表：表格或卡片
→ 行级操作：低频动作进入菜单
→ 分页和加载状态
→ 选中行后出现批量操作
```

### 3.1 工具栏

- 搜索通常位于左侧，输入宽度在桌面端受控，在窄屏上改为整行。
- 状态、类型、分组等离散条件使用筛选菜单；文本条件使用输入框。
- 有筛选条件时提供“重置筛选”，避免用户逐项清空。
- 刷新、列显示、视图切换和创建属于工具栏动作，不塞到行操作菜单。
- 对需要服务端查询的列表，搜索、筛选、排序和分页应统一进入查询状态，避免前端只过滤当前页。

### 3.2 数据列表

- 表格列展示稳定的识别信息、状态、关键关联项、最近活动时间和更新时间。
- 状态直接显示在行内，不能要求用户打开详情才能判断环境是否运行。
- 行选中使用复选框；没有选中行时不显示批量操作栏。
- 数据为空、筛选后为空、加载中和请求失败要分别表达。
- 数据量或字段宽度较大时，允许列显示、列宽和卡片视图成为用户偏好。

### 3.3 行操作

- 高频动作可以保留一个明显的主按钮，例如“启动/停止”或“启用/禁用”。
- 编辑、复制、导出、代理、标签、清理缓存等低频动作集中在最后一列的 `DropdownMenu`。
- 删除必须通过确认对话框；危险动作放在菜单分隔线之后，并使用 destructive 语义。
- 同一对象的“删除”“恢复”“永久删除”不能共用一个模糊按钮，必须根据当前视图明确表达。

### 3.4 编辑容器

- 两三个字段的简单修改适合 `Dialog`。
- 复杂对象适合大尺寸 `Sheet`/`Drawer`，内部再按逻辑分区。
- 编辑过程要有提交中状态、防重复提交、字段校验、失败保留输入和成功反馈。
- 离开有未保存内容的页面或 Drawer 时，应出现二次确认。

## 4. 各项目源码观察

### 4.1 shadcn-admin：通用 B 端表格的清晰基线

相关源码：

- [用户表格](https://github.com/satnaing/shadcn-admin/blob/e16c87f213a5ba5e45964e9b67c792105ec74d26/src/features/users/components/users-table.tsx)
- [数据表格工具栏](https://github.com/satnaing/shadcn-admin/blob/e16c87f213a5ba5e45964e9b67c792105ec74d26/src/components/data-table/toolbar.tsx)
- [设置页壳层](https://github.com/satnaing/shadcn-admin/blob/e16c87f213a5ba5e45964e9b67c792105ec74d26/src/features/settings/index.tsx)
- [用户编辑对话框](https://github.com/satnaing/shadcn-admin/blob/e16c87f213a5ba5e45964e9b67c792105ec74d26/src/features/users/components/users-action-dialog.tsx)

观察结果：

1. `UsersTable` 同时维护行选中、排序、列可见性、列筛选和分页；筛选与分页可以同步到路由查询状态。
2. `DataTableToolbar` 把文本搜索、faceted filter、重置筛选和列视图选项组织成一个可复用工具栏。
3. 表格底部固定放分页，选中行后渲染批量操作组件；这让批量动作不会长期占用页面空间。
4. 设置页是独立路由，左侧是 Profile、Account、Appearance、Notifications、Display 等分类，右侧通过 Outlet 渲染当前内容。
5. 用户编辑采用 Action Dialog，说明简单对象不需要为每次编辑打开全屏工作区。

适合 ContextWeave 借鉴的部分：列表页骨架、筛选重置、选中行批量栏、设置页左右分栏。需要调整的部分：指纹环境字段远多于普通用户对象，不能把完整环境表单塞进小 Dialog。

### 4.2 new-api：服务端表格和复杂编辑的完整组合

相关源码：

- [渠道表格](https://github.com/QuantumNous/new-api/blob/9310231b3c27fea933e939b46cf26e0ce67192e3/web/src/features/channels/components/channels-table.tsx)
- [渠道行操作](https://github.com/QuantumNous/new-api/blob/9310231b3c27fea933e939b46cf26e0ce67192e3/web/src/features/channels/components/data-table-row-actions.tsx)
- [渠道批量操作](https://github.com/QuantumNous/new-api/blob/9310231b3c27fea933e939b46cf26e0ce67192e3/web/src/features/channels/components/data-table-bulk-actions.tsx)
- [渠道编辑 Drawer](https://github.com/QuantumNous/new-api/blob/9310231b3c27fea933e939b46cf26e0ce67192e3/web/src/features/channels/components/drawers/channel-mutate-drawer.tsx)
- [设置页通用壳层](https://github.com/QuantumNous/new-api/blob/9310231b3c27fea933e939b46cf26e0ce67192e3/web/src/features/system-settings/components/settings-page.tsx)
- [设置区块导航注册表](https://github.com/QuantumNous/new-api/blob/9310231b3c27fea933e939b46cf26e0ce67192e3/web/src/components/layout/config/system-settings.config.ts)
- [未保存修改导航保护](https://github.com/QuantumNous/new-api/blob/9310231b3c27fea933e939b46cf26e0ce67192e3/web/src/features/system-settings/components/form-navigation-guard.tsx)
- [主题快速切换](https://github.com/QuantumNous/new-api/blob/9310231b3c27fea933e939b46cf26e0ce67192e3/web/src/components/theme-quick-switcher.tsx)

观察结果：

1. 渠道列表把搜索、状态/类型/分组/模型筛选、排序、服务端分页和查询缓存组合在一个表格控制器中；移动端降低默认分页大小。
2. 部分筛选状态写入 URL 或 localStorage，刷新页面后仍能恢复用户上次的工作上下文。
3. 支持表格和卡片两种视图，并允许列可见性和列宽保存；这对环境管理的宽字段和窄窗口都有参考价值。
4. 行操作集中在菜单中，批量操作单独作为组件挂载；敏感字段还提供显示/隐藏控制。
5. 渠道编辑使用大型 Sheet，表单按连接、认证、模型、代理等区域组织，并承载多个高级子编辑器。
6. 设置页以可注册 section 为中心，不把所有系统配置写成一个超长组件；表单有导航保护，存在未保存内容时阻止离开。
7. 主题快速切换只处理跟随系统、浅色和深色；完整的系统设置再承载更多分区和表单。

适合 ContextWeave 借鉴的部分：查询状态分层、服务端分页的边界、表格/卡片切换、复杂 Drawer 的分区、未保存保护。v0.1 只有本地 SQLite 和个人模式，不应照搬其服务端权限、账单、成员和多租户设置。

### 4.3 Simprint：指纹环境是资源工作台，不是普通用户表

相关源码：

- [环境页头部](https://github.com/Simprint/simprint/blob/d2dc939bfae8efda8e4e4d791587d7a364ca4dd8/plugins/pages/environment-manager/src/components/environment-header.tsx)
- [环境批量操作](https://github.com/Simprint/simprint/blob/d2dc939bfae8efda8e4e4d791587d7a364ca4dd8/plugins/pages/environment-manager/src/components/environment-batch-actions.tsx)
- [环境行和行操作菜单](https://github.com/Simprint/simprint/blob/d2dc939bfae8efda8e4e4d791587d7a364ca4dd8/plugins/pages/environment-manager/src/components/environment-table-row.tsx)
- [环境创建/编辑工作区](https://github.com/Simprint/simprint/blob/d2dc939bfae8efda8e4e4d791587d7a364ca4dd8/plugins/pages/create-window/src/components/create-window-content.tsx)
- [环境配置摘要](https://github.com/Simprint/simprint/blob/d2dc939bfae8efda8e4e4d791587d7a364ca4dd8/plugins/pages/create-window/src/components/window-summary.tsx)
- [系统设置 Drawer](https://github.com/Simprint/simprint/blob/d2dc939bfae8efda8e4e4d791587d7a364ca4dd8/plugins/pages/system-settings/src/components/settings-dialog.tsx)
- [设置导航配置](https://github.com/Simprint/simprint/blob/d2dc939bfae8efda8e4e4d791587d7a364ca4dd8/plugins/pages/system-settings/src/config/index.ts)

观察结果：

1. 环境页提供“全部、已打开、回收站”视图，搜索使用独立对话框并支持快捷键唤起，另有标签管理和导出入口。
2. 选中环境后，底部出现批量启动、批量停止、移动分组、分配标签、删除等操作；回收站视图换成批量恢复和永久删除。
3. 行菜单把编辑、启动/停止、导出、代理、账号、名称、备注、URL、标签、Cookie、缓存和删除分层组织，避免表格末列堆满按钮。
4. 创建/编辑窗口按基本信息、网络地域、指纹伪装、屏幕硬件、浏览器行为分区；旁边显示实时配置摘要，底部提供保存和取消。
5. 系统设置按账户、通用、浏览器、网络、存储分区，使用全屏 Drawer 承载长内容。

这说明指纹浏览器的核心对象是带生命周期、关联资源和运行状态的环境。普通 CRUD 的“编辑一行数据”模型不足以覆盖它；环境配置最终需要独立工作区、摘要、运行状态和恢复策略。

### 4.4 CloakBrowser Manager：轻量桌面 Profile 列表

相关源码：

- [Profile 列表](https://github.com/CloakHQ/CloakBrowser-Manager/blob/c393d88c66fe2790ed8ea753c095ad48b9498486/frontend/src/components/ProfileList.tsx)
- [Profile 表单](https://github.com/CloakHQ/CloakBrowser-Manager/blob/c393d88c66fe2790ed8ea753c095ad48b9498486/frontend/src/components/ProfileForm.tsx)
- [设置面板](https://github.com/CloakHQ/CloakBrowser-Manager/blob/c393d88c66fe2790ed8ea753c095ad48b9498486/frontend/src/components/SettingsPanel.tsx)

观察结果：

1. 列表顶部显示运行数量和搜索框，Profile 行显示运行状态、代理和标签。
2. 支持拖拽排序；搜索时关闭拖拽，避免过滤后的子集无法确定排序语义。
3. 空列表和无匹配结果分开提示，底部固定“新建 Profile”按钮。
4. 设置面板保持很窄的字段范围，保存中禁用相关操作，保存失败保留错误信息。

适合 ContextWeave 借鉴的部分：运行数量、状态和标签的高密度表达、搜索与排序的冲突处理、底部固定创建入口。它的设置字段很少，不足以直接作为 ContextWeave 的系统设置结构。

### 4.5 vue-vben-admin：企业级筛选、树形范围和 Drawer 表单

相关源码：

- [用户列表页](https://github.com/vbenjs/vue-vben-admin/blob/edbc42caaaa5b33fe61349063cc94cd36a1c5f30/playground/src/views/system/user/list.vue)
- [用户编辑表单](https://github.com/vbenjs/vue-vben-admin/blob/edbc42caaaa5b33fe61349063cc94cd36a1c5f30/playground/src/views/system/user/modules/form.vue)
- [用户详情](https://github.com/vbenjs/vue-vben-admin/blob/edbc42caaaa5b33fe61349063cc94cd36a1c5f30/playground/src/views/system/user/modules/detail.vue)
- [偏好设置 Drawer](https://github.com/vbenjs/vue-vben-admin/blob/edbc42caaaa5b33fe61349063cc94cd36a1c5f30/packages/effects/layouts/src/widgets/preferences/preferences-drawer.vue)
- [主题偏好](https://github.com/vbenjs/vue-vben-admin/blob/edbc42caaaa5b33fe61349063cc94cd36a1c5f30/packages/effects/layouts/src/widgets/preferences/blocks/theme/theme.vue)

观察结果：

1. 用户页左侧用部门树缩小数据范围，右侧用分页表格展示结果。
2. 工具栏提供搜索、刷新、缩放等常驻动作；新增和编辑使用 Drawer，详情单独使用另一个 Drawer。
3. 删除使用确认流程；状态开关在提交前二次确认，失败时不改变当前状态。
4. 偏好设置集中在 Drawer 中，覆盖主题模式、半深色侧栏和布局相关选项。

适合 ContextWeave 借鉴的部分：把过滤范围和数据列表并列、区分编辑与详情、偏好设置集中管理。个人版当前没有部门树和团队权限，因此不引入其组织管理结构。

## 5. 从研究中提炼的设计规则

### 5.1 环境页要围绕“可运行资源”设计

环境列表至少要让用户快速回答：

- 这是什么环境？
- 当前能否启动、是否正在运行或需要恢复？
- 使用哪个浏览器内核？
- 绑定了哪个代理？
- 上次何时运行？
- 下一步是启动、编辑、停止还是恢复？

因此环境表格的核心列建议是：

```text
选择 | 名称 | 状态 | 内核 | 代理 | 最近运行 | 更新时间 | 操作
```

名称、状态和主动作应保持可见；Cookie、缓存、标签、备注等低频操作进入行菜单。

### 5.2 批量操作必须和数据模型一起设计

启动、停止、删除、恢复、移动分组、分配标签、导出都需要明确：

- 是否允许跨状态执行。
- 部分失败如何展示。
- 取消后哪些任务已经生效。
- 是否需要逐项结果。
- 是否会影响运行锁、Profile 目录和运行历史。

因此不能只在 UI 上增加一个“批量操作栏”就算完成。批量启动/停止、回收站和分组标签会增加 IPC、持久化和异常恢复成本，应在有对应数据模型和测试后进入版本。

### 5.3 复杂环境编辑需要工作区

指纹环境不是几个字符串字段的集合。后续完整编辑工作区建议采用：

```text
顶部：环境名称、运行状态、关闭/保存
左侧或顶部：基本信息 / 网络地域 / 指纹 / 屏幕硬件 / 浏览器行为
中间：滚动表单
右侧：配置摘要和风险提示
底部：取消、保存、另存模板
```

第一版仍可以使用较宽的 `Dialog` 或 `Sheet` 完成名称、内核和代理绑定；真正的指纹分区表单应在数据契约和内核能力明确后实现。

### 5.4 设置页应该是分类工作区

设置不应成为一个不断增长的长表单。建议按下面的个人版结构组织：

```text
设置
├── 外观
│   ├── 主题模式
│   ├── 颜色预设
│   ├── 圆角
│   ├── 密度
│   ├── 字体
│   └── 侧栏布局
├── 浏览器
│   ├── 默认内核
│   ├── 默认启动行为
│   └── 环境目录
├── 网络
│   ├── 默认代理行为
│   └── 凭据安全存储状态
├── 数据与诊断
│   ├── 数据目录
│   ├── 缓存和日志
│   └── 诊断信息
└── 关于
    ├── 版本和平台
    └── 许可证
```

设置页的推荐交互：

- 左侧分类导航，右侧卡片分区；分类在窄窗口变成横向滚动或 Select。
- 主题、圆角、密度、字体和侧栏布局属于全局偏好，修改后立即预览并持久化。
- 浏览器、网络和数据目录属于应用配置，使用“编辑 → 保存”流程。
- 有未保存内容时阻止离开；保存中禁用相关控件；失败保留表单；成功显示反馈。
- 每个危险或迁移动作都说明影响范围，并提供恢复默认或回滚路径。

## 6. ContextWeave 当前建议

### 6.1 v0.1 个人环境页

保留当前 v0.1 已实现的个人版壳层和 CRUD 交互，但移除每个业务页面顶部的大标题和说明。当前页面名称由官方 Sidebar 和顶部面包屑表达：

```text
顶部 Sidebar 和面包屑显示当前页面
→ 搜索/刷新/新建环境
→ 环境 Table
→ 行级 DropdownMenu
→ Dialog 新建/编辑
→ AlertDialog 删除确认
→ Empty、加载、错误和提交反馈
```

当前表格建议保持以下信息优先级：

1. 名称和状态。
2. 内核和代理。
3. 最近运行或更新时间。
4. 启动/停止主动作。
5. 编辑、删除等行菜单动作。

组件约束继续使用项目当前的 shadcn/ui `base-nova` + Base UI 源码：

- 文本搜索使用 `Input`。
- 状态、内核和代理筛选使用 `Select`，不使用原生 `<select>`。
- 行动作使用 `DropdownMenu`。
- 新建/编辑使用 `Dialog` 或后续更宽的 `Sheet`。
- 删除确认使用 `AlertDialog`。
- 空态使用 `Empty`，加载使用 `Skeleton`，状态使用 `Badge`。
- 表格选择、分页、刷新和错误反馈沿用现有组件和 IPC 契约。

### 6.2 v0.1 代理页

代理页可沿用同一 CRUD 壳层，表格列建议为：

```text
名称 | 协议 | 主机和端口 | 认证状态 | 引用环境数 | 更新时间 | 操作
```

代理密码继续遵守 [ADR 0002](../adr/0002-proxy-auth-transport.md)：页面只显示脱敏状态，不回填明文；被环境引用时禁止删除，运行中的环境引用代理时禁止编辑。

### 6.3 v0.1 侧栏和底部用户菜单

个人版侧栏顶部暂不显示团队切换。主导航可以保持：

```text
环境
代理
内核
运行记录
```

侧栏底部用户菜单至少提供：

```text
设置
关于
```

账户、账单、订阅、通知、退出登录和团队管理没有个人本地数据语义，暂不放入可点击菜单；未来引入团队身份后再新增对应入口。

### 6.4 后续环境管理版本候选

以下能力在研究项目中反复出现，但会新增数据模型、批量 IPC、恢复语义或权限边界，当前只作为后续候选：

```text
环境
├── 全部
├── 运行中
├── 已停止
├── 需恢复
└── 回收站
```

候选能力包括分组、标签、批量启动/停止、批量删除/恢复、导出、卡片视图、环境详情摘要和最近运行记录。进入 v0.1 必须先修订已确认的执行文档并补齐数据、协议和测试标准。

## 7. 不应直接照搬的部分

- 不复制 Simprint 或 new-api 的 AGPL 代码、样式、图标和资源；只借鉴公开可观察的交互结构。
- 不因为其他项目有“指纹模式”就向用户承诺 Canvas、Audio、WebGL、字体或 WebRTC 的隐身效果；ContextWeave 仍以已验证的内核能力为准。
- 不把回收站、批量启动、标签、分组、导出当成纯前端开关；它们需要本地数据库、IPC、运行锁和异常恢复设计。
- 不把复杂环境表单塞入一个高度受限的小弹窗；当字段扩展到指纹、网络、屏幕和行为时，必须切换到分区工作区。
- 不把系统设置、团队设置、账单设置和账户中心混在个人版菜单中。

## 8. 当前验收建议

后续实现或调整时，至少检查：

- 空数据、筛选后为空、加载中、提交中、失败和成功状态是否各自可理解。
- 新建、编辑、删除和取消是否不会重复提交或误删。
- 运行中或 `needs-recovery` 环境是否被正确限制编辑和删除。
- 代理被引用时的编辑/删除限制是否与页面提示一致。
- Select、DropdownMenu、Dialog、Sheet、AlertDialog 是否使用 Base UI 正确组合并包含可访问标题。
- 主题、圆角、密度、字体和侧栏布局修改后是否立即生效、可恢复默认并持久化。
- 设置有未保存内容时离开是否得到确认。
- 桌面窄窗口下工具栏、表格或卡片视图是否仍可完成搜索和核心操作。

## 9. 研究结论

当前最适合 ContextWeave 的组合是：

1. 使用 shadcn-admin 的表格工具栏、筛选、分页、批量栏和独立设置路由作为通用 B 端骨架。
2. 使用 Simprint 的状态视图、环境行菜单、批量环境操作和“表单 + 配置摘要”作为指纹环境方向。
3. 使用 new-api 的大型 Drawer、分区设置、查询状态和未保存保护作为复杂配置参考。
4. 使用 CloakBrowser Manager 的运行数量、Profile 搜索和轻量桌面密度作为个人版体验参考。
5. 使用 vue-vben-admin 的编辑/详情 Drawer 分离和偏好设置组织方式作为企业级扩展参考。

因此，v0.1 继续保持“无页面级大标题、使用官方壳层面包屑、个人环境和代理的 Table + Dialog/AlertDialog”是合理的；完整分组、标签、回收站、批量环境操作和指纹配置工作区应作为后续版本的独立设计任务。

### 9.1 本轮主体内容设计落地

结合上述项目的工具栏、资源表格和轻量桌面工作区模式，v0.1 主体采用以下统一骨架：

```text
数量/当前选择
→ 搜索、筛选、刷新、创建
→ 单一数据表面或资源行
→ 选中对象的底部动作条
```

- 环境和代理不再各自包一层带标题和描述的 Card；工具栏只显示当前数量与操作，列表直接进入单一内容流，仅用必要的表头/行分隔线表达层级，空态继续使用 `Empty`。
- 环境的启动、停止、恢复和 Worker Smoke 只在选中环境后出现在底部动作条，避免把高频动作和表格行操作混成多个卡片。
- 内核采用资源行表达名称、版本、平台、状态、能力和安装动作，避免每个内核独占一张结构相同的卡片。
- 设置、运行记录、关于和指纹策略使用局部标签和必要说明，不再为每个页面生成重复的页面标题/描述层。
- 表格行分隔线、设置运行时路径分隔线和面板内分区线只用于表达信息层级；页面不再使用多重外框、卡片背景或阴影叠加。

该方案保留了 shadcn-admin/new-api 的工具栏和动作聚合、Simprint 的环境状态工作台方向，以及 CloakBrowser Manager 的桌面密度；复杂指纹配置仍应在后续版本用独立 Sheet/工作区实现。

### 9.2 2026-09-22 源码复核后的统一抽象

本轮重新读取了五个固定 commit 中的代表性源码，重点确认前一版研究结论是否真的落在组件状态和数据流上：

| 参考项目 | 源码证据 | 可迁移的结构结论 |
|---|---|---|
| shadcn-admin | `UsersTable`、`DataTableToolbar` | 表格状态不是页面临时变量：排序、列可见性、选择、筛选和分页独立建模；筛选可同步 URL；工具栏统一搜索、faceted filter、重置和列视图；选中行后挂载批量动作。 |
| new-api | `ChannelsTable`、通用 `SettingsPage` | 服务端列表把查询、筛选、分页、移动端页大小和敏感字段显示分开；列宽、列可见性、视图模式和筛选可持久化；设置页以 section 元数据和 Provider 组织，内容、操作区、标题状态和错误/重试边界分离。 |
| Simprint | `EnvironmentHeader`、`EnvironmentTableRow`、`CreateWindowContent`、`SettingsDialog` | 指纹环境是带生命周期和关联资源的工作台：全部/已打开/回收站视图、快捷搜索、标签/导出/批量动作、行级资源菜单；编辑按基本信息、网络地域、指纹、屏幕硬件、浏览器行为分区，并提供配置摘要；设置使用大尺寸 Drawer 和分类导航。 |
| CloakBrowser Manager | `ProfileList`、`SettingsPanel` | 桌面 Profile 列表优先显示运行数量、搜索和状态；有筛选时禁用拖拽排序；设置异步加载/保存、错误保留、凭据掩码和显式清除动作。 |
| vue-vben-admin | 用户 `list.vue`、Form/Detail Drawer、Preferences Drawer | 复杂 B 端页面可把范围树与结果表并列；编辑和详情使用不同 Drawer；工具栏提供刷新、搜索、缩放；状态变更先确认再提交；偏好设置按可组合区块和恢复默认组织。 |

从这些源码可以归纳出 ContextWeave 后续页面应遵守的六条规则：

1. **列表先建状态模型，再画表格。** 搜索、筛选、排序、选择、分页、列布局和视图模式必须明确是本地状态、URL 状态还是持久化偏好，不能把它们混在一个页面 `useState` 中。
2. **工具栏只放查询和资源动作。** 搜索/筛选/重置位于同一工具栏；创建、刷新、导出、视图切换与查询状态并列；批量动作只在有选中项时出现。
3. **行菜单承载低频和危险动作。** 编辑、代理、标签、导出、恢复和删除进入行级菜单；删除位于分隔线之后，明确 destructive 语义，并在运行中、被引用或需要恢复时拒绝。
4. **简单对象用 Dialog，复杂环境用 Sheet/Drawer。** 代理和少量元数据可以在 Dialog 内完成；指纹环境达到网络、指纹、屏幕和行为多个分区后，必须切换到独立工作区，并显示配置摘要和风险提示。
5. **设置页按 section 组合，而不是无限增长单表单。** 外观、浏览器、网络、数据与诊断、关于分别建 section；每个 section 有自己的加载、保存、错误、恢复默认和未保存保护。
6. **环境状态、业务状态和同步状态分离。** “运行中/需恢复”是资源生命周期状态；“任务成功/失败”是业务结果；“同步中/同步失败”是后续团队能力，不能用一个 Badge 混淆三种状态。

这些结论只作为当前 UI 信息架构和后续版本设计依据，不复制被审阅项目的代码、组件实现、样式或资源；AGPL 项目仍需遵守许可证边界。

本轮在 v0.1 Renderer 中落成统一组件关系：跨页面 `WorkspacePage` 提供 `toolbar`、`content` 和可选 `selectionBar` 插槽；环境、代理和内核页面分别把领域 Toolbar、Table/List 和选中动作作为插槽内容，表单与删除确认作为 overlay children。这样页面组件只负责状态和领域操作，主体布局由共享容器保持一致。

### 9.3 指定页面源码结构复核

本轮进一步复核以下四个具体页面族：new-api 的 `usage-logs/common`、shadcn-admin 的 `tasks` 和 `users`。重点不是页面颜色，而是组件之间的职责边界、数据表格状态和 overlay 的挂载关系。

#### new-api：`usage-logs/common`

页面入口是两层路由：无 section 时重定向到默认 `common`，带 section 的路由负责校验 section 和 URL search schema。`common` 专属的 `type` 筛选在切换到 drawing/task 时从 URL 清除，说明页面状态先由路由契约约束，再交给页面组件消费。

组件树可以概括为：

```text
UsageLogs
└── UsageLogsProvider
    └── SectionPageLayout
        ├── Title：Common Logs / Task Logs
        ├── Actions：All / Only Mine（按权限显示）
        └── Content
            ├── Task section tabs（仅 drawing/task 且有多个可见 section 时）
            └── UsageLogsTable
                ├── CommonLogsFilterBar
                │   ├── 统计徽标：Usage / RPM / TPM
                │   ├── 敏感值显示切换
                │   ├── 日期范围、模型、分组、类型
                │   ├── Advanced filters：Token、User、Channel、Request ID
                │   └── Search / Reset / mobile filter panel
                ├── Desktop DataTable
                ├── MobileCardList
                ├── Loading / Empty / Fetching state
                └── Footer pagination
```

`UsageLogsProvider` 只保存跨子组件状态：当前用户详情、敏感值显示、渠道亲和规则弹窗和 All/Self 视图范围；数据请求和表格状态留在 `UsageLogsTable`。表格使用 manual pagination/filter，查询条件来自 URL，React Query 的 key 同时包含 category、权限范围、分页和筛选；切换筛选后主动 invalidate logs/stats。`DataTablePage` 将 toolbar、桌面表格、移动卡片、空态、加载态、分页和批量动作作为可替换插槽，过滤栏通过 `toolbar` 覆盖默认工具栏。

#### shadcn-admin：`tasks`

任务页的页面组件只做组装：

```text
Tasks
├── TasksProvider
├── Header：Search / ThemeSwitch / ConfigDrawer / ProfileDropdown
├── Main
│   ├── PageHeading：标题 + 描述
│   ├── TasksPrimaryButtons：Import / Create
│   └── TasksTable
│       ├── DataTableToolbar：搜索、Status、Priority、View options
│       ├── bordered Table
│       ├── DataTablePagination
│       └── DataTableBulkActions（有选中项时出现）
└── TasksDialogs
    ├── TasksMutateDrawer：创建/编辑
    ├── TasksImportDialog
    └── ConfirmDialog：删除
```

`TasksTable` 把 row selection、sorting、column visibility 作为本地 UI 状态，把 global filter、column filters 和 pagination 通过 URL state 管理。表格用 TanStack Table 的 faceted row model 支持筛选选项和计数；行菜单负责编辑、禁用中的未来动作、标签子菜单和删除；批量动作独立于表格，通过状态、优先级、导出和删除按钮操作当前选中行。

创建/编辑不是小 Dialog，而是右侧 Sheet：顶部标题和说明，中间可滚动表单，底部固定 Close/Save。删除是独立 ConfirmDialog。Provider 只维护打开的 overlay 类型和当前行，避免页面把每个弹窗的布尔状态散落在表格里。

#### shadcn-admin：`users`

用户页沿用相同页面骨架，但对象编辑策略不同：

```text
Users
├── UsersProvider
├── Header：Search / ThemeSwitch / ConfigDrawer / ProfileDropdown
├── Main
│   ├── PageHeading：User List + 描述
│   ├── UsersPrimaryButtons：Invite User / Add User
│   └── UsersTable
│       ├── DataTableToolbar：username 搜索、Status、Role、View options
│       ├── bordered Table
│       ├── DataTablePagination
│       └── Users bulk actions：Invite / Activate / Deactivate / Delete
└── UsersDialogs
    ├── UsersActionDialog：Add/Edit，宽 Dialog 内滚动表单
    ├── UsersInviteDialog
    └── UsersDeleteDialog
```

用户表与任务表同样把筛选、分页和列视图状态分层管理。用户编辑使用 `sm:max-w-lg` Dialog 而不是 Sheet，表单内部滚动，字段采用标签对齐的六列 grid；密码校验根据 add/edit 场景切换规则。也就是说，编辑容器由表单复杂度决定：任务表单适合 Sheet，用户表单适合宽 Dialog，二者都由页面外层 `UsersDialogs` 统一挂载。

#### 对 ContextWeave 的直接启示

1. 页面组件应只负责 `Provider → Header/Toolbar → DataSurface → Overlay` 的组装，不能同时实现表格状态、每个弹窗和每个领域字段。
2. URL 可表达的列表状态（搜索、筛选、分页、视图）应与短暂 UI 状态（当前行、打开哪个 Dialog、敏感值显示）分开。
3. 统计摘要和安全边界属于页面 header/action 区；过滤工具栏只承载查询条件和 Apply/Reset，不把所有说明文字塞进表格上方。
4. 表格容器应统一提供 desktop table、mobile list、loading、empty、fetching、pagination 和可插入的 bulk actions；领域页面只提供 columns、toolbar 和 row renderer。
5. overlay 由页面级 dialogs orchestrator 统一挂载；简单元数据使用 Dialog，复杂多段表单使用 Sheet/Drawer，危险操作使用独立确认组件。
6. ContextWeave 当前个人版没有批量编辑、服务端分页或敏感数据查询，因此只吸收组件关系和状态分层，不把 new-api/shadcn-admin 的团队权限、URL 查询字段或批量业务动作直接加入 v0.1。

### 9.4 两个项目的技术栈对照

| 层次 | new-api `usage-logs/common` | shadcn-admin `tasks/users` |
|---|---|---|
| 应用 | React 19 + TypeScript，`@rsbuild/core`/Rsbuild 构建；项目整体后端是 Go，本次页面研究只涉及 `web/` | React 19 + TypeScript + Vite |
| 路由 | `@tanstack/react-router` 文件路由；路由 loader/beforeLoad 校验 section，search schema 校验 URL 查询 | `@tanstack/react-router` 文件路由；页面通过 `getRouteApi` 读取 search 和 navigate |
| 数据请求 | `@tanstack/react-query`；query key 包含日志类别、权限范围、分页和筛选，支持 placeholderData、fetching 状态和 invalidate | 页面示例主要使用本地 fixture；列表状态通过自定义 `useTableUrlState` 与 URL 同步，项目依赖中同时包含 TanStack Query |
| 表格 | `@tanstack/react-table` + 自定义 `useDataTable` + `DataTablePage`；manual pagination/filter、移动卡片、固定高度、分页 footer、可插入 toolbar/bulk/mobile | `@tanstack/react-table` + 自定义 `DataTableToolbar`、`DataTablePagination`、bulk action；本地排序、筛选、选择、列可见性和分页 |
| UI primitives | shadcn 风格组件，当前源码基线使用 `@base-ui/react`；Tailwind CSS 4、`class-variance-authority`、`clsx`、`tailwind-merge` | shadcn/ui + Radix UI primitives；Tailwind CSS 4、`class-variance-authority`、`clsx`、`tailwind-merge` |
| 表单与校验 | `react-hook-form`、`@hookform/resolvers`、Zod；usage logs 过滤器主要是受控输入/Select 和 URL draft | `react-hook-form`、`@hookform/resolvers`、Zod；tasks 用 Sheet 表单，users 用宽 Dialog 表单 |
| 状态 | UsageLogsProvider 保存当前用户、敏感值、权限视图和弹窗；React Query 保存服务端数据 | TasksProvider/UsersProvider 保存当前行和 overlay 类型；表格内部保存排序、列可见性、选择等 UI 状态 |
| 国际化与反馈 | `i18next`、`react-i18next`、Sonner；日志错误由 server-error helper 转换 | 页面示例使用英文静态文案；Sonner 用于批量动作异步反馈 |
| 响应式 | `useMediaQuery`，桌面 DataTable 与移动 MobileCardList 两套渲染 | 主要依赖 Tailwind 响应式布局；表格页面保留桌面表格结构 |
| 测试与质量 | Vitest、Testing Library、`oxlint`/`oxfmt`、`tsgo` | Vitest Browser、Playwright、Testing Library、ESLint、Prettier |

技术栈差异带来的实际行为差异是：new-api 把日志页当作服务端数据工作区，路由查询、权限范围、请求缓存、移动端列表和分页都是一等结构；shadcn-admin 把 tasks/users 当作可复用的前端 CRUD 模板，重点在 TanStack Table 状态、Provider 管理 overlay 和表单容器选择。两者都不是“一个页面组件里直接写完整表格”的模式。

## 10. 变更记录

- `r1`：固定五个 GitHub 项目 commit，整理 CRUD、环境工作台、设置页模式和 ContextWeave 的 v0.1/后续版本边界。
- `r2`：根据用户确认移除业务页面顶部的大标题和说明，保留 Sidebar、顶部面包屑和卡片内部必要说明。
- `r3`：根据用户要求重新设计 v0.1 主体内容，统一工具栏、单一列表表面、资源行和轻量设置面板，减少边框和重复页面标题描述。
- `r4`：根据用户进一步反馈移除主体内容的卡片背景、圆角和阴影，明确以单一内容流和必要分隔线作为 v0.1 视觉基线。
- `r5`：复核五个固定 commit 的代表性源码，补充表格状态、设置 section、指纹环境工作台和后续目录拆分规则。
- `r6`：按 shadcn-admin/new-api 的主体结构复核 v0.1 数据表面，统一工作区画布、单一表格表面、选中动作条和空态层级。
- `r7`：指定复核 new-api `usage-logs/common`、shadcn-admin `tasks` 和 `users` 的页面组件树、数据表状态、过滤工具栏、批量动作和 overlay 容器。
- `r8`：补充 new-api 与 shadcn-admin 的页面实际技术栈、数据请求、表格、UI primitives、表单和测试工具对照。
