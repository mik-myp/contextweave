# ContextWeave 项目总体规划与技术方案

**文档日期：2026-09-22**
**项目名称：ContextWeave（织境）**  
**项目定位：目标为开源、可自托管、面向个人与团队的多内核浏览器工作台**
**文档性质：** ContextWeave 的总体产品、版本路线和架构规范
**维护规则：** 后续版本开发必须按本文件确定的路线推进；需求、范围或架构变化时，先更新本文件并记录原因、影响和迁移方式
**最近审查：** 2026-09-22；依据 Electron、Node.js、TanStack Router、GitHub 仓库和 SLSA 官方资料复核

配套文档：[技术栈与长期库选型](technology-stack.md)

---

## 1. 项目目标

项目不是简单的浏览器启动器，而是一款面向个人和团队的桌面浏览器工作平台，底层提供相互隔离的浏览器环境，后续逐步扩展：

- 多浏览器环境管理
- 独立代理和指纹配置
- 个人空间与团队空间
- 团队成员接力使用同一个环境
- 环境版本、备份、同步和恢复
- 可视化工作流
- 商品巡检、订单报表整理和网站功能测试
- 数据采集与数据处理
- LangChain、LangGraph、RAG 和 AI Agent
- 自托管团队服务和可选远程执行节点

项目通过 GitHub Releases 分发，当前预览阶段暂不把代码签名作为发布前提。团队服务属于后续阶段，由使用者自行部署；v0.1 客户端不连接团队 API。

第一阶段先把个人本地环境管理和独立浏览器进程闭环做稳定，再增加团队服务、工作流和业务自动化。

本文件覆盖当前实现和后续版本路线。路线会随着产品验证持续更新；任何版本开始开发前，必须以本文件的最新内容为范围、数据、权限、依赖、许可证和验收基线。

---

## 2. 参考项目与借鉴范围

### 2.1 Ant Browser

仓库：[black-ant/Ant-Browser](https://github.com/black-ant/Ant-Browser)

值得参考：

- 浏览器环境生命周期管理
- 代理池和实例绑定
- 内核管理
- 环境导入导出
- 备份恢复
- Launch API 和 CDP 入口
- Go + Wails + React/TypeScript 的桌面管理方式

注意事项：

- README 明确推荐外部 [fingerprint-chromium](https://github.com/adryfish/fingerprint-chromium) 内核。
- GitHub 仓库元数据当前没有声明许可证，不能默认认为代码可以直接商用或闭源复用；任何复用必须重新核查仓库、依赖和资产许可证。
- 管理端有配置项，不代表内核一定实现了相应的指纹行为，需要逐项验证。

### 2.2 Simprint

仓库：[Simprint/simprint](https://github.com/Simprint/simprint)

最新 Release：v0.2.32。

值得参考：

- Tauri + Rust + React/TypeScript 的桌面架构
- 本地优先数据模型
- 浏览器环境管理
- 工作流画布和节点配置
- 运行中点选网页元素
- 提取结果和截图预览
- 本地 API、MCP 和窗口同步方向
- 浏览器内核适配和 CDP 连接

许可证：AGPLv3。直接复用或修改代码时，需要遵守相应义务。

v0.2.32 已移除旧的独立服务端，业务请求主要转向本地数据库。因此，Simprint 的团队页面不能直接当作跨设备环境接力方案，需要重新设计服务端、租约、环境版本和快照同步。

### 2.3 Donut Browser

仓库：[zhom/donutbrowser](https://github.com/zhom/donutbrowser)

值得参考：

- 多环境管理
- 自托管同步
- 可选端到端加密
- 配置、代理和分组同步
- 本地 API 和 MCP

许可证：AGPLv3。其同步功能可以作为团队服务设计参考，但不能简单复制“同步文件”作为团队接力协议。

### 2.4 fingerprint-chromium

仓库：[adryfish/fingerprint-chromium](https://github.com/adryfish/fingerprint-chromium)

值得参考：

- Chromium 指纹补丁
- User-Agent 和 Client Hints
- Canvas、Audio、字体、WebGL、WebRTC 等配置
- 通过启动参数指定指纹种子和平台

许可证：BSD-3-Clause。

注意事项：

- 项目 README 说明当前版本二进制优先发布，源码补丁可能延迟到下一版本；ContextWeave 不把该项目的 GitHub Release 直接视为经过本项目供应链验证的下载源。
- 内核版本需要持续跟进 Chromium 安全更新。
- 内核授权、源码可获得性、构建流程、补丁完整性、下载哈希和安全更新责任必须单独核查；未完成核查前只能保留 Adapter 和 manifest 设计，不得进入正式 Release。

### 2.5 Camoufox、BrowserForge、CreepJS

- [Camoufox](https://github.com/daijro/camoufox)：研究 Firefox 源码级指纹修改和自动化控制。
- [BrowserForge](https://github.com/daijro/browserforge)：研究基于真实市场分布生成相互关联的浏览器配置。
- [CreepJS](https://github.com/abrahamjuliot/creepjs)：用于检查指纹泄漏和环境不一致。

这些项目只作为内核研究、配置生成和回归检测参考，不能直接等同于完整的桌面浏览器产品，也不能把检测工具结果当作“完整指纹隐身”证明。

---

## 3. 产品核心原则

### 3.1 管理端和浏览器内核分离

客户端负责管理环境和任务，真正访问网站的是独立的浏览器进程：

    桌面管理客户端
        ↓
    本地环境管理服务
        ↓
    独立浏览器进程

桌面框架的 WebView 只显示管理界面，不能把它直接当作指纹浏览器内核。

### 3.2 一个环境一个独立用户目录

每个环境需要拥有：

- 独立用户数据目录
- 独立 Cookies、LocalStorage 和扩展数据
- 独立代理配置
- 独立指纹配置
- 独立内核版本绑定
- 运行锁和状态记录

同一个环境默认禁止多个浏览器进程同时写入。

### 3.3 稳定优先于无意义随机化

指纹配置应保存稳定的配置版本和随机种子。默认重启后保持一致，避免同一个环境每次启动都产生完全不同的特征。

指纹项必须保持内部一致，例如：

- User-Agent 与 Client Hints 一致
- 平台、GPU、字体和分辨率合理匹配
- 时区、语言和代理地区相互协调
- 页面、iframe、Worker 等执行环境表现一致

不能只修改 User-Agent，也不能只靠 JavaScript 注入实现完整的指纹浏览器。

### 3.4 环境租约是团队接力的核心（后续阶段）

环境租约、心跳和 fencing token 不属于 v0.1。它们只在团队服务启动后作为服务端并发控制方案评估，不能提前进入个人客户端的数据模型或 UI。

团队成员接力使用同一个环境时，必须保证：

    成员 A 获取租约
        ↓
    下载最新版本
        ↓
    本地使用
        ↓
    关闭浏览器并提交新版本
        ↓
    成员 B 才能接手

同一环境需要区分：

- 使用中
- 同步中
- 可接手
- 同步失败
- 需要人工处理
- 版本冲突

---

## 4. 总体技术架构

### 4.1 当前 v0.1 架构

v0.1 只实现本地纵向闭环：

```text
Electron 管理客户端
├── Renderer：React/TypeScript + TanStack Router
├── Preload：类型化白名单 API
├── Main：窗口、IPC、SQLite、目录和进程协调
├── Worker：受限的 Playwright/CDP smoke task
└── Kernel Registry/Adapter：独立浏览器进程接入
```

当前代码以 `apps/desktop` 和 `packages/` 中的 contracts、storage、kernel 和 worker-protocol 为实现边界。目录规划不代表需要一次性创建未来的服务端、WebUI 或 AI Worker。

### 4.2 后续团队架构

团队服务启动后再评估以下组件：

- NestJS + Fastify adapter + TypeScript API。
- PostgreSQL 保存成员、权限、环境版本、租约和审计元数据。
- S3 兼容对象存储保存大型快照和产物。
- 独立 Worker、队列和可选远程执行节点。

这些组件必须通过版本化 contracts 接入；客户端不能直接连接 PostgreSQL，也不能因为规划存在就提前创建服务端 schema 或部署文件。

### 4.3 长期边界

- React 页面不直接管理长任务；长任务交给 Worker 或服务端任务系统。
- Electron Main 只负责本地协调和受控能力，不承担工作流或 AI 的长时间业务逻辑。
- Worker 不依赖 React、Electron Renderer 或窗口对象。
- 工作流定义、执行器协议、团队资源和 AI Tool Schema 独立于桌面框架。
- 大型环境快照、截图、报表和文件不放进前端状态或普通关系字段。

---

## 5. 为什么选择 Electron，以及它与浏览器内核的关系

在不把安装包体积作为主要约束、且项目由前端开发者主导的前提下，Electron 是当前合理的客户端基线。它便于学习桌面应用、Node.js 进程、IPC、文件系统和自动化工具整合，也与 Simprint 的 React/TypeScript 工作流方向一致。

Electron 的职责只包括管理界面和本地协调：

- Renderer：React 页面、环境列表、设置和后续工作流编辑器。
- Preload：向 Renderer 暴露经过限制、带类型的本地 API。
- Main：窗口、托盘、文件选择、本地服务和外部浏览器进程生命周期。
- Worker：自动化、数据处理、LangChain、LangGraph 和长时间任务。

Electron 自带的 Chromium 只渲染管理界面，不能作为指纹浏览器内核，也不能用 Renderer 中的 JavaScript 注入替代内核级指纹实现。用户访问网站时，必须启动独立的外部浏览器进程；不能混用 Electron session 与外部环境的用户数据目录。

Electron 需要遵守以下边界：

- 开启 `contextIsolation` 和 Renderer sandbox。
- 远程内容禁止 Node.js 集成，只加载 HTTPS 内容，并使用限制性的 CSP。
- 只通过 Preload 暴露有限的类型化 API。
- 严格校验 IPC 调用来源、窗口身份、参数和返回值。
- 限制导航、窗口创建、弹窗、权限请求和外部链接；不对不可信内容调用 `shell.openExternal`。
- 管理界面与网站页面分离，不能让不可信网页获得本地能力。
- Electron、Chromium 和 Node.js 依赖持续更新；Electron 官方只支持最新三个稳定大版本，发布前必须核查当前版本是否仍在支持窗口内。

Electron 的优点：

- Node.js 和 TypeScript 生态整合直接。
- UI 渲染版本相对一致。
- 适合接入 Playwright、CDP、数据处理和桌面工具。
- 便于前端开发者学习和贡献。
- 可以将 LangChain.js、LangGraph.js 和自动化 Worker 统一在 TypeScript 生态中。

主要代价是管理客户端安装包和基础资源开销较大，但这不改变独立浏览器内核的设计，也不是当前项目的首要限制。

Tauri 和 Wails 仍可作为备选，尤其适合以后对资源占用或原生能力有明确要求的场景。桌面框架不是浏览器内核，切换桌面框架不应影响内核适配、工作流协议、团队服务端和 AI Worker。

### 5.1 独立多内核架构

Ant Browser 已经验证了“管理端单独运行、浏览器内核外部下载并单独启动”的模式。我们的产品不限制于 `fingerprint-chromium`，可以接入：

- fingerprint-chromium
- 标准 Chromium
- 用户已有且有权使用的 Chrome 或 Edge 本地可执行文件；不默认下载或分发厂商专有二进制
- Camoufox 等 Firefox 系列内核
- 后续自行维护的 Chromium fork
- 其他满足适配协议的内核

不同内核不能统一当作 Chromium 处理。Camoufox 的内核家族、启动方式、用户目录、指纹配置和自动化协议都可能与 Chromium 不同；CDP、Juggler/Playwright 或其他协议必须由适配器负责。

建议拆为三层：

```text
Electron 管理客户端
        ↓
Kernel Registry
        ↓
Kernel Adapter
        ↓
独立 Browser Runtime
```

Kernel Registry 负责内核注册、下载、校验、版本和来源管理；Kernel Adapter 负责把标准环境配置转换为具体内核的启动参数、配置文件和控制协议；Browser Runtime 是实际执行网站访问的独立进程。

每个内核必须有自己的 manifest、配置 Schema 和适配器。清单至少包含：

```json
{
  "id": "fingerprint-chromium",
  "family": "chromium",
  "version": "148.0.7778.215",
  "platform": "windows",
  "arch": "x64",
  "executable": "chrome.exe",
  "package": {
    "url": "https://example.invalid/kernel.zip",
    "sha256": "..."
  },
  "controlProtocol": "cdp",
  "capabilities": {
    "canvas": true,
    "audio": true,
    "webgl": true,
    "fonts": true,
    "timezone": true,
    "webrtc": true,
    "fileUpload": true
  },
  "configSchema": "fingerprint-chromium-v1",
  "dataDirCompatibility": ["148.x"]
}
```

标准 Chromium、Chrome/Edge 和 Camoufox 使用各自的 manifest。不能把所有参数都当作 Chromium flags，也不能在 Electron 界面中写死大量 `if kernel === ...`。

适配器接口建议保持稳定：

```ts
interface BrowserKernelAdapter {
  getManifest(): KernelManifest;
  validateConfig(config: unknown): ValidationResult;
  buildLaunchPlan(input: LaunchInput): LaunchPlan;
  launch(plan: LaunchPlan): Promise<BrowserProcess>;
  attach(process: BrowserProcess): Promise<BrowserSession>;
  stop(process: BrowserProcess): Promise<void>;
  getCapabilities(): KernelCapabilities;
}
```

环境配置拆成通用配置和内核专属配置：

```json
{
  "environmentId": "env-001",
  "kernel": {
    "id": "camoufox",
    "version": "152.0"
  },
  "commonConfig": {
    "proxyId": "proxy-001",
    "language": "en-US",
    "timezone": "America/Los_Angeles",
    "window": { "width": 1440, "height": 900 }
  },
  "kernelConfig": {
    "platform": "windows",
    "hardwareConcurrency": 8,
    "canvasMode": "noise"
  }
}
```

前端根据 `configSchema` 显示当前内核支持的专属配置；适配器负责校验并生成启动计划。工作流、LangChain 和 LangGraph 只能通过统一的 Browser Control/Tool Schema 使用浏览器，不能直接拼接某个内核的参数。

需要分三层检查兼容性：

1. 启动兼容：操作系统、架构和可执行文件是否匹配。
2. 配置兼容：内核是否支持环境当前的指纹、代理和窗口配置。
3. 自动化兼容：工作流节点所需的 CDP、文件上传、截图或其他能力是否可用。

工作流运行前可以声明：

```json
{ "requiredCapabilities": ["cdp", "fileUpload", "elementScreenshot"] }
```

如果当前内核不支持，应在运行前提示，不要执行到中途才失败。

内核版本必须独立于 Electron 客户端。环境需要记录内核 ID、内核版本、操作系统和架构、指纹配置版本与 seed、启动参数版本、能力签名及用户目录兼容范围。内核升级流程为：

```text
下载 → SHA-256 校验 → 读取 manifest → 能力检查
→ 备份环境 → 测试启动 → 指纹与兼容性回归 → 允许切换
```

内核测试至少覆盖 User-Agent/Client Hints、Canvas、Audio、WebGL/WebGPU、字体、ClientRects、屏幕、时区语言、WebRTC/DNS/代理泄漏、iframe/Worker 一致性、自动化痕迹和用户目录升级兼容。CreepJS 和 BrowserLeaks 只能作为辅助工具，不能作为唯一质量指标。

内核来源、许可证、源码可获得性、构建方式、安全更新责任和下载地址必须记录在清单中。未来增加内核应只需新增 manifest、adapter 和测试，不修改 Electron UI、团队协议或工作流 Schema。

---

## 6. 客户端布局

参考：[shadcn/ui sidebar-07](https://ui.shadcn.com/blocks/sidebar#sidebar-07)

以下是长期布局方向。v0.1 只显示个人空间、环境、代理、内核、运行记录、设置和关于；团队切换、同步、备份和成员管理在对应版本实现前不得出现在当前 UI。

### 6.1 顶部：工作空间切换

顶部 Logo 区域点击后打开 DropdownMenu：

    ✓ 个人空间
      团队 A
      团队 B
    ────────────
    ＋ 创建团队

创建团队后填写：

- 团队服务地址
- 登录信息或接入凭据
- 团队名称

这里的服务地址是团队 API 服务地址，不是 PostgreSQL 地址。数据库由服务部署者在服务端配置，客户端不接触数据库凭据。

如果未来连接多个自建服务器，切换项应显示服务器名称，避免不同服务器上的同名团队混淆。

### 6.2 侧边栏菜单

个人空间：

    工作空间
      浏览器环境
      代理管理
      扩展管理

团队空间：

    工作空间
      浏览器环境
      代理管理
      扩展管理

    团队管理
      成员管理
      操作记录

前期不把备份、同步、内核下载和系统维护放入主侧边栏。它们属于设置或环境页面中的状态入口。

### 6.3 底部用户 DropdownMenu

底部显示用户头像、名称和当前账号状态：

    用户名称
    当前账号 / 本地用户
    ────────────
    设置
    关于
    ────────────
    退出登录

设置页面内部分类：

- 通用：主题、语言、启动行为
- 浏览器内核：下载、版本和本地路径
- 数据与存储：环境目录、磁盘使用和清理
- 备份与恢复：本地备份、导入和恢复
- 团队连接：服务地址、连接状态和重新认证
- 同步设置：同步策略和失败处理
- 团队设置：团队资料和管理策略，按权限显示

### 6.4 布局行为

- 切换空间不自动关闭其他空间正在运行的浏览器。
- 有未保存编辑时，提示保存或放弃。
- 异步请求返回时检查当前空间，避免显示其他团队数据。
- 正在运行的环境和同步任务应有全局状态入口。
- 服务器离线时显示离线或缓存状态，不能伪装成最新数据。
- 侧边栏可以折叠为图标模式，保持与 sidebar-07 类似的使用方式。

---

## 7. 个人模式与团队模式

长期不需要准备两套主要前端，采用：

- 一套 Electron 桌面客户端
- 一个可自托管团队服务端
- 客户端根据当前工作空间决定数据来源和可用菜单

### 7.1 个人模式

- v0.1 当前模式。
- 不需要服务器。
- 使用本地 SQLite 和环境目录。
- 本地管理浏览器环境、代理、内核和备份。
- 可以以后连接团队服务，但不是必需步骤。

### 7.2 团队模式

- 规划中的团队模式，按本文件的阶段路线进入实现。
- 客户端连接用户自建服务端。
- 服务端负责身份、权限、环境元数据、租约、版本和审计。
- 客户端负责本机浏览器、环境文件、快照和实际运行。
- PostgreSQL 只由服务端访问。

### 7.3 是否需要 WebUI

前期不需要单独准备完整 WebUI。团队管理先通过桌面客户端完成。

后期如果需要浏览器访问的管理后台，可以共享：

- React 组件
- 类型和 Zod 校验
- API 客户端
- 环境、团队和审计页面
- 数据表和图表

桌面端专属能力由 Electron Main/Preload 提供：

- 启动本机浏览器
- 读取本地文件
- 管理本机进程
- 访问本机环境目录

WebUI 适合管理成员、权限、设备、审计和任务状态；它不能直接操作成员电脑上的浏览器环境。

---

## 8. Simprint 工作流审阅结论

Simprint 工作流最值得沿用的是：

> 添加节点 → 配置少量参数 → 运行并点选网页元素 → 查看结果 → 保存复用

源码中的主要节点：

- 点击元素
- 输入文本
- 打开新页面
- 选择标签页
- 关闭标签页
- 截图
- 滚动页面
- 等待
- 条件判断
- 循环
- 退出循环
- 提取页面数据
- 上传文件
- 执行 JavaScript

优点：

- 节点分类清楚。
- 属性面板适合运营用户。
- 目标缺失时可以在浏览器中点选元素。
- 提取、脚本和截图结果可以回填预览。
- 工作流有版本字段和导入导出结构。
- TypeScript 执行器与 CDP 适配器边界清晰。

需要重新设计或补强：

- 点击面板中的双击、右键等选项必须真正传递给执行器。
- 输入的清空和慢速输入选项必须真正生效。
- 任务级重试、并发和超时需要完整执行链路。
- 正式执行不能依赖 React 页面生命周期。
- 提取节点需要支持列表、表格和结构化输出。
- 定位器需要支持候选选择器、匹配数量检查、iframe 和 Shadow DOM。
- 本地脚本不能要求用户自行安装系统 Node.js。
- 任务运行记录需要持久化，支持恢复和审计。
- 业务写操作需要区分成功、失败和未知状态，避免盲目重试。

---

## 9. 后期工作流与业务能力

可视化工作流、商品巡检、订单报表和网站测试放到个人与团队核心稳定之后。

### 9.1 建议增加的节点类型

通用浏览器节点：

- 打开或复用页面
- 选择标签页
- 点击、输入、下拉选择、键盘
- 悬停、滚动、上传、下载
- 截图
- 等待
- iframe 和 Shadow DOM 定位

数据节点：

- 读取 CSV/XLSX
- HTTP 请求
- JSON 解析
- 列表和表格提取
- 字段映射
- 过滤、排序、去重、合并
- 金额、币种和日期转换
- 写出文件和数据集

流程节点：

- 条件
- 按数据项循环
- 计数循环
- 分页循环
- 限速
- 错误分支
- 子流程
- 人工处理
- 结束

测试节点：

- 元素断言
- 文本断言
- URL 断言
- HTTP 状态断言
- 数据字段断言
- 金额和数量范围断言
- 截图比较

### 9.2 业务场景

#### 商品与价格巡检

流程：

    读取商品表
    → 获取商品页面或 API 数据
    → 提取价格、库存和上下架状态
    → 转换金额和币种
    → 与规则比较
    → 保存异常截图和结果

需要：

- SKU 和 URL 表格输入
- 逐行处理
- 金额类型和币种
- 历史结果比较
- 异常结果表
- 失败项重跑

#### 订单报表整理

流程：

    选择店铺和日期
    → 下载报表
    → 等待下载完成
    → 解析 CSV/XLSX
    → 字段映射
    → 去重合并
    → 输出标准报表

需要：

- 下载事件
- 文件产物
- CSV/XLSX 解析
- 字段映射
- 数据校验
- 下载失败重试
- 来源和时间记录

#### 网站功能测试

流程：

    启动测试环境
    → 登录
    → 搜索商品
    → 加入购物车
    → 提交测试操作
    → 执行断言
    → 保存截图和日志

需要：

- 测试数据
- 前置条件
- 清理步骤
- 断言
- 测试套件
- 历史结果
- 标准浏览器与定制内核的对照

#### 数据采集

需要：

- 列表和详情页采集
- 翻页和滚动加载
- 增量游标
- 去重键
- 限速
- 失败队列
- 批量数据集
- 导出数据库或文件

---

## 10. LangChain、LangGraph 与 RAG

LangChain 和 LangGraph 不应成为基础工作流引擎的强制依赖。

### 10.1 确定性工作流

例如：

    打开页面
    → 提取商品价格
    → 判断价格
    → 导出结果

使用自己的 Workflow Schema 和确定性执行器。

优点：

- 可复现
- 易测试
- 适合审计
- 适合电商写操作
- 适合团队权限控制
- 不依赖模型输出

### 10.2 Agent 工作流

LangGraph 适合：

- 根据自然语言生成工作流草稿。
- 动态选择工具和下一步。
- 根据采集结果决定是否翻页。
- 分析失败原因。
- 请求人工确认。
- 组织浏览器、HTTP、数据库和文件工具。
- 运行长时间任务并保存检查点。

推荐结构：

    LangGraph
      ↓
    生成计划或调用受控工具
      ↓
    统一 Workflow Schema / Tool Schema
      ↓
    确定性执行器
      ↓
    浏览器、API、文件和数据处理

涉及修改价格、上传资料、提交订单时，AI 应生成计划并请求确认，由确定性节点执行。

### 10.3 RAG 架构

个人 RAG：

- SQLite
- 本地向量索引
- 个人文档和操作说明

团队 RAG：

- PostgreSQL 或独立向量数据库
- 团队业务规则
- 平台文档
- 店铺运营规范

AI 相关组件建议放在独立 Worker：

- LangChain.js
- LangGraph.js
- Embedding
- 重排序
- 文档切分
- 检索和工具调用

复杂文档解析、OCR 或数据科学可以通过可选 Python Worker 提供。

### 10.4 运行时发布

普通用户不应手动安装 Node.js 或 Python。可选方式：

- 随客户端发布受管理的 Worker。
- 将 Worker 构建为独立可执行文件。
- 团队管理员在自建服务器上部署 AI Worker。
- 高级用户连接自己的 Ollama、云模型或外部 AI 服务。

建议定义共享 TypeScript 契约包：

    packages/contracts
    ├── workflow-schema
    ├── tool-schema
    ├── agent-task-schema
    ├── rag-document-schema
    ├── execution-event-schema
    └── permission-schema

使用运行时校验，避免只依赖 TypeScript 编译期类型。

---

## 11. 团队同步与环境接力

团队服务端建议包含：

- API 服务
- 身份认证
- 成员和角色
- 环境元数据
- 运行租约
- 环境版本
- 审计记录
- PostgreSQL
- 对象存储
- 可选调度器和执行节点

### 11.1 环境版本

每次提交都携带：

- 环境 ID
- 基础版本
- 新版本
- 提交设备
- 提交用户
- 内核版本
- 配置版本
- 快照哈希
- 时间和结果

服务端拒绝基于旧版本提交的覆盖。

### 11.2 租约

客户端需要：

- 获取租约
- 周期续租
- 发送设备心跳
- 释放租约
- 网络异常时进入失联状态
- 恢复连接后重新确认状态

服务端不能简单通过一个 running 字段解决并发问题。

### 11.3 业务状态和同步状态分离

例如：

    业务操作：已完成
    环境同步：失败

不能把这两个状态合并成“任务失败后重新执行全部步骤”。

写操作恢复时先查询业务结果，再判断是否需要继续，避免重复改价、重复提交和重复上传。

---

## 12. 分阶段版本规划

### v0.1：架构与内核验证

- Electron 客户端启动
- 个人环境、代理、设置和运行状态管理
- 独立浏览器用户目录、运行锁和生命周期状态
- Kernel Registry、manifest 校验和标准 Chromium 本机探测/启动 smoke
- fingerprint-chromium Adapter 和配置 schema；在来源、许可证、URL、SHA-256 和安全更新责任确认前不分发二进制
- 独立 Worker 执行最小 CDP/Playwright smoke task
- Windows x64、macOS x64、macOS arm64 的 GitHub Actions 构建和 SHA-256

验收：普通用户无需开发工具即可启动客户端；环境不会互相串用；失败、取消、重复启动、崩溃和未校验内核都有可解释结果。

### v0.2：个人环境管理

- 本地备份、恢复和导入导出
- 环境配置版本和迁移
- 更完整的内核 manifest、下载和升级闭环
- 磁盘空间、诊断导出和数据目录维护
- 代理连通性和跨内核兼容性矩阵

验收：环境升级和恢复不会静默覆盖有效数据，旧版本数据可以得到明确处理。

### v0.3：个人数据可靠性

- 跨平台和长时间运行回归
- 内核、代理/DNS、跨 iframe/Worker 和用户目录兼容测试
- 可验证的诊断包和隐私审查
- 发布升级、回滚和迁移演练

验收：在支持的系统和内核组合下可恢复。

### v0.4：自托管团队基础

- 服务端 Docker Compose
- 个人空间和团队空间
- 团队创建、成员邀请和退出
- 角色与权限
- 设备登记
- 操作记录
- PostgreSQL 和文件存储

验收：服务端负责权限，团队数据隔离。

### v0.5：团队环境接力

- 环境快照和版本
- 运行租约与心跳
- 上传下载进度
- 版本冲突拒绝
- 同步状态
- 交接记录
- 人工和未来自动化共用占用机制

验收：成员 A 提交后，成员 B 可接手最新环境。

### v0.6：团队异常恢复

- 断网
- 客户端崩溃
- 浏览器异常退出
- 上传失败
- 下载中断
- 快照损坏
- 权限撤销
- 管理员接管
- 服务端重启恢复

验收：不会静默覆盖有效数据，恢复操作可解释。

### v0.7：日常使用完善

- 批量管理
- 批量分组
- 启动队列
- 代理批量导入
- 扩展管理
- 日志脱敏
- 诊断导出
- 设置页面完善
- sidebar-07 风格导航完善

### v0.8：跨平台和兼容性

- macOS 构建与验证
- Linux 构建与验证
- 客户端与服务端版本兼容
- 数据库迁移
- 服务端备份恢复
- 多架构构建

跨平台可编译不代表环境快照可以跨系统直接恢复，需要单独建立支持矩阵。

### v0.9：发布候选版

- 长时间运行测试
- 多环境测试
- 低内存测试
- 磁盘不足测试
- 异常关机演练
- 权限边界审查
- 依赖和许可证审查
- 安装卸载测试
- 文档和支持范围整理

### v1.0：个人与团队稳定版

v1.0 只承诺核心能力：

- 个人浏览器环境管理
- 自托管团队服务
- 成员与权限
- 同一环境接力
- 环境版本与备份
- 同步和异常恢复
- 经过验证的系统和内核组合
- 独立多内核注册、适配、能力检查和升级流程
- GitHub Releases 分发

### v1.1：自动化基础

- 本地 API
- 独立执行器
- 任务记录
- 浏览器适配器
- 基础运行事件

### v1.2：可视化工作流

- 节点画布
- 属性面板
- 变量
- 点选元素
- 单节点试运行
- 流程试运行
- 结果预览
- 配置完整性检查

### v1.3：数据处理与采集

- CSV/XLSX
- 列表提取
- 分页
- 数据集
- 清洗、过滤、去重
- 失败项重跑
- 文件产物

### v1.4：调度与测试

- 定时任务
- 远程执行节点
- 任务队列
- 断言
- 测试套件
- 截图和历史报告
- 节点重试和错误分支

### v1.5：业务模板

- 商品巡检
- 订单报表整理
- 网站功能测试
- 出海落地页检查
- 商品资料维护
- 平台连接器

### v1.6 以后：AI 与 RAG

- LangChain.js
- LangGraph.js
- AI 生成流程草稿
- 失败分析
- 知识库检索
- 团队 RAG
- 人工审批
- AI 工具调用
- 可选 Python、OCR 和本地模型

---

## 13. 前期必须提前设计的接口

即使工作流和 AI 放到 v1.0 以后，以下结构应在前期保留；其中内核接口必须在 v0.1 就开始验证：

### 内核与环境接口

内核接口必须支持多种内核，而不是只服务于 fingerprint-chromium。每个内核通过 manifest、configSchema 和 adapter 注册自己的参数、控制协议与能力。

- 创建
- 启动
- 停止
- 状态查询
- 代理刷新
- 版本查询
- 能力声明

### 资源接口

- 文件资源
- 快照资源
- 数据集资源
- 凭据引用
- 环境引用
- 设备引用

### 事件接口

- 环境启动
- 环境停止
- 同步开始
- 同步完成
- 同步失败
- 租约变化
- 权限变化
- 任务状态变化

### 版本接口

- 客户端版本
- 服务端版本
- 环境版本
- 内核版本
- 工作流版本
- 节点版本
- AI Worker 版本

这些接口可以避免后期加入工作流、LangGraph 或远程执行时重写个人和团队核心。

---

## 14. 第一阶段开发顺序

第一项开发任务不应是工作流编辑器，而是完成下面的个人纵向闭环：

    下载 GitHub Release
    → 打开客户端
    → 创建个人环境
    → 配置代理
    → 启动浏览器
    → 打开网页
    → 关闭浏览器
    → 保存环境
    → 再次启动并恢复状态

团队闭环进入开发前，必须在本文件中明确服务端、身份、租约、快照、权限、审计和恢复设计，并同步更新技术栈和验收边界。只有个人闭环和数据恢复稳定后，才按路线开始团队服务、工作流和业务自动化；当前个人阶段不以未配置的第三方内核二进制或完整指纹能力作为验收条件。

---

## 15. 总体结论

长期推荐方案：

> **Electron + electron-vite + React/TypeScript + Electron Main/Preload + 独立 TypeScript Worker + 多内核 Kernel Registry/Adapter/Runtime + NestJS/Fastify 自托管服务端 + PostgreSQL + 对象存储。**

当前 v0.1 专注：

- 个人环境管理
- 代理、内核引用和本地设置
- 独立浏览器进程、用户目录和 Worker
- 稳定的客户端布局和设置体系
- 构建、校验、失败恢复和发布证据

后续版本扩展：

- 团队空间、成员权限和环境租约
- 备份、同步和恢复
- Simprint 风格可视化工作流
- 商品巡检
- 订单报表整理
- 网站功能测试
- 数据采集
- LangChain/LangGraph
- RAG
- AI Agent
- 远程执行和业务连接器

框架选择的关键不是提前安装所有未来库，而是建立清晰边界：

- Electron 不负责整个业务系统，Main 只负责本地协调和受控能力。
- React 不负责长任务执行。
- Electron Main 不强行实现所有 AI 和自动化逻辑，长任务交给 Worker。
- LangChain/LangGraph 不取代确定性业务执行器。
- PostgreSQL 不直接暴露给客户端。
- 浏览器内核不与桌面框架耦合；内核通过 Registry、Adapter 和 Runtime 独立演进。
- 个人、团队、工作流和 AI 通过稳定的资源、事件和版本接口连接。

在这套架构下，未来增加工作流、RAG、AI Agent、电商连接器、Python 数据处理或新的浏览器内核，不需要更换 Electron 客户端。桌面框架可以更换，但 Kernel Registry/Adapter/Runtime、工作流协议、团队服务端和 AI Worker 才是长期稳定边界。

---

## 16. 资料核查与维护

2026-09-22 对以下资料进行了网络核查：

- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)：补充 context isolation、sandbox、CSP、权限请求、导航和 IPC sender 校验要求。
- [Electron Release Timeline](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)：Electron 官方支持最新三个稳定大版本，发布前必须检查当前 major 是否仍在支持窗口。
- [Node.js SQLite API](https://nodejs.org/api/sqlite.html)：`DatabaseSync` 从 Node 22.5.0 起提供，当前项目使用 Node 22.15.x 的内置 SQLite。
- [TanStack Router File-based Routing](https://tanstack.com/router/latest/docs/framework/react/guide/file-based-routing)：确认 Vite plugin 生成文件路由树的当前实现路径。
- [Ant Browser](https://github.com/black-ant/Ant-Browser)：GitHub 元数据当前未声明许可证，不能默认复用其代码或资产。
- [Simprint](https://github.com/Simprint/simprint/releases/tag/v0.2.32)：当前最新 Release 仍为 v0.2.32；只借鉴交互和架构思路，不把其实现当作 ContextWeave 依赖。
- [Donut Browser](https://github.com/zhom/donutbrowser)：仓库声明 AGPL-3.0，任何代码借鉴都必须单独完成许可证审查。
- [fingerprint-chromium](https://github.com/adryfish/fingerprint-chromium)：仓库声明 BSD-3-Clause，但二进制、补丁源码和安全更新仍须由 ContextWeave 单独验证。

外部资料只用于形成规划判断。依赖、内核和产品范围发生变化时重新核查，不把本节的日期或版本号当作永久事实。
