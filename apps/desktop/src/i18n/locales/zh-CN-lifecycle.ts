export const lifecycleMessages = {
  'kernel.installName': '内核名称（可选）',
  'kernel.installNameHelp': '留空使用默认名称，安装后仍可修改。',
  'table.deleteLimit': '每次最多删除 {count} 项，请减少选择后重试。',

  'logs.dateRange': '日期范围',
  'logs.pickRange': '选择开始和结束日期',
  'table.confirmDelete': '删除所选',
  'table.deleteSelected': '删除选中的 {count} 项？',
  'table.deleteResult': '已删除 {success} 项，{failed} 项失败',
  'table.deleteRetryHelp':
    '未成功的项目已保留。若数据已变化，请关闭此窗口，核对刷新后的列表再重新选择。',
  'kernel.rename': '修改名称',
  'kernel.renameHelp': '仅修改显示名称，不改变内核 ID、版本或环境绑定。留空可恢复默认名称。',
  'kernel.invalidName': '名称最多 80 个字符，不能包含控制字符。',
  'kernel.testing': '检测能力中…',
  'kernel.verify': '重新验证',
  'kernel.probeComplete': '基础能力检测完成，未覆盖的能力仍标为未验证。',
  'kernel.probeFailed': '能力检测未全部通过，请查看各项结果。',
  'kernel.installedProbeFailed': '已安装，但能力检测未完成，可在详情中重试',
  'kernel.bulkDeleteHelp':
    '仅删除应用下载的内核文件，保留环境和浏览器资料。所选内核被 {count} 个环境引用，删除后这些环境需要重新安装内核才能启动；运行中占用的内核不会删除。',
  'error.KERNEL_PROBE_FAILED':
    '能力检测未完成，安装文件已保留。可以关闭使用该内核的环境后重新验证。',
  'error.KERNEL_PROBE_CLEANUP_FAILED':
    '测试进程未能退出，已阻止继续修改该内核。请退出应用并检查测试浏览器进程后重试。',
  'error.KERNEL_CHANGED': '检测期间内核文件发生变化，未保存验证结果，请重新验证。',

  'about.diceUi':
    '拖拽排序采用 Dice UI 的 Base Sortable 注册表组件与 dnd-kit，适配了中文读屏提示、行内编辑和本项目主题。',
  'about.licenseBoundary':
    '致谢说明参考与改编范围，不替代许可证授权。仅在许可证允许的范围内采用源码，完整许可与版权声明见下方。',
  'table.searchCurrentPage': '搜索本页记录…',
  'table.cursorScope': '搜索和排序仅针对当前页，翻页查看更多记录。',
  'about.antBrowser':
    '书签参考其行内编辑、拖拽排序与启动开关交互，独立实现；不复制源码或同步覆盖已有环境。',
  'about.shadcnBase':
    '日期筛选采用官方 Base Date Picker 的 Calendar 与 Popover 组合，沿用现有主题。',
  'about.cossUi':
    '通过官方注册表安装 Kbd 快捷键提示，并参考去重 Toast 模式。仅采用其 MIT 许可的 UI 目录。',

  'logs.commandHistory': '环境操作',
  'logs.pickDate': '选择日期与时间',
  'logs.time': '时间',
  'logs.clearDate': '清除日期',
  'commands.resolve': '查看并处理',
  'batch.history': '批量操作历史',
  'batch.viewProgress': '查看进度',
  'batch.viewResult': '查看结果',
  'batch.progressUnavailable': '暂时无法读取批量操作进度，请重试查看，不要重复提交。',
  'error.BROWSER_CONTROL_FAILED':
    '与浏览器的控制连接中断，环境已停止。请重新启动；若再次出现，请查看运行记录。',
  'error.BROWSER_CONTROL_TIMEOUT':
    '浏览器长时间未响应控制请求，环境已停止。请重新启动；若再次出现，请查看运行记录。',
  'error.BROWSER_PROXY_CONTROL_FAILED':
    '无法继续自动处理代理认证，已停止环境以保护代理设置。请检查代理后重试。',
  'error.BROWSER_RESTORE_FAILED': '未能打开原有浏览器窗口，资料已保留，请重试启动。',
  'storage.maintenanceHelp': '仅清理已完成的历史记录，不删除环境、登录状态或浏览器数据。',
  'storage.showMaintenance': '查看清理选项',
  'storage.hideMaintenance': '收起清理选项',
  'storage.orphansNotice':
    '发现 {count} 个未关联目录。不代表目录无用或可安全删除；其中的浏览器资料可能是唯一副本。此处不执行删除或自动恢复。',
  'storage.diagnostics': '高级诊断：截图与任务产物',
  'storage.diagnosticsHelp':
    '用于开发测试和故障排查，不是日常环境管理或全盘空间清理。折叠此处不会删除文件、修改预算或停止任务。',
  'cleanup.details': '诊断详情',

  'error.ORGANIZATION_NAME_EXISTS': '此名称已存在。请使用不同的分组或视图名称。',
  'error.ORGANIZATION_CONFLICT': '组织信息已被其他操作修改。请先重新加载，再决定是否保存。',
  'error.ORGANIZATION_GROUP_MISSING': '选择的分组已不存在。请重新选择分组。',

  'error.WORKSPACE_CONTEXT_INVALID': '工作空间上下文缺失或无效，请重新打开应用后重试。',
  'error.WORKSPACE_MISMATCH': '请求不属于当前工作空间，已拒绝访问数据和凭据。',
  'error.WORKSPACE_PATH_UNSAFE':
    '数据目录与工作空间归属不符或包含不安全链接。请保留原数据并检查目录，不会自动移动或覆盖。',

  'error.DATABASE_WORKSPACE_INVALID':
    '本地工作空间身份无法读取。请保留数据目录并重试；不会自动创建新身份。',
  'history.loading': '正在读取历史…',
  'history.pageCount': '本页 {count} 条（未统计全部历史）',
  'history.latest': '返回首段',
  'history.cancel': '取消等待',
  'history.cancelled': '已取消等待。数据库查询可能仍在完成；未接纳其返回结果。',
  'error.HISTORY_CURSOR_INVALID': '分页标记无效或与当前查询不匹配，请返回首段重新读取。',
  'error.HISTORY_CURSOR_STALE': '分页边界记录已移除，请返回首段重新读取。',

  'error.WORKER_STOP_FAILED':
    '尚未确认任务进程已停止。控制权限已撤销，但退出前会继续保留环境占用，请勿重复启动该环境的任务。',
  'error.WORKER_OUTPUT_FAILED': '截图写入或校验失败。请检查磁盘空间和目录权限后重试。',
  'error.WORKER_OUTPUT_CLEANUP_FAILED':
    '尚未确认任务输出已安全清理。正在进行的写入完成前不会释放或复用文件描述符。',
  'error.IPC_UNAVAILABLE': '无法连接应用后台，请重新打开应用界面后重试。',
  'env.ipLocaleAuto': '跟随出口 IP（每次启动获取）',
  'env.ipLocaleTitle': '根据出口 IP 获取语言与时区',
  'env.ipLocaleDescription':
    '选择“跟随出口 IP”后，每次启动会通过当前直连或代理访问 IPWho.is；也可检测一次后填入固定值。第三方会看到出口 IP，不会收到环境名称或代理密码。语言只是地区推荐，可手动覆盖；代理失败不会改走直连，检测失败会阻止自动模式启动。',
  'env.ipLocaleDetect': '检测当前线路',
  'env.ipLocaleDetecting': '正在检测…',
  'env.ipLocaleFailed': '无法获取出口 IP 地区',
  'env.ipLocaleProxy': '代理出口检测结果',
  'env.ipLocaleDirect': '直连出口检测结果',
  'env.ipLocaleResultHint':
    '这是本次请求的地区推荐，并非实际语言识别。多语言地区或轮换代理请人工核对；“填入固定值”后需保存环境才生效。',
  'env.ipLocaleApply': '填入固定语言与时区',
  'error.IP_LOCALE_FAILED':
    '无法通过当前线路获取 IP 地区，请检查网络或代理后重试，或手动选择语言/时区。未改用直连或系统设置。',
  'error.IP_LOCALE_TIMEOUT': '获取 IP 地区超时，请重试或改为手动设置。',
  'error.IP_LOCALE_RATE_LIMITED': 'IP 地区服务已限流，请稍后重试，或改为手动设置。',
  'error.IP_LOCALE_INVALID_RESPONSE': 'IP 地区服务未返回有效的语言/时区信息，请重试或手动设置。',
  'error.IP_LOCALE_BUSY': '已有 IP 地区检测正在执行，请等待完成或取消后重试。',

  'proxy.typeHelp':
    'HTTP 代理也可通过 CONNECT 访问 HTTPS 网站；这里的 HTTPS 指连接代理服务器本身使用 TLS，必须与服务商提供的协议一致。',
  'error.UPDATE_SIGNATURE_INVALID': '无法可靠验证应用签名，已停止自动更新。',
  'error.UPDATE_UNMOUNT_FAILED': '安装镜像未能安全卸载，更新已停止；请检查文件占用后重试。',
  'error.APP_UPDATING': '应用正在准备更新，请稍后重试。',
  'error.UPDATE_DEVELOPMENT_MODE': '开发运行不能自动替换应用，请使用正式安装版。',
  'error.UPDATE_PORTABLE_UNSUPPORTED': 'Windows 便携版暂不支持自动替换，请从发行页安装新版。',
  'error.UPDATE_INSTALL_LOCATION':
    '当前应用不在支持的安装位置，请使用 Windows 安装版或将 macOS 应用安装到可写目录。',
  'error.UPDATE_INSTALL_PERMISSION':
    '安装目录不可写或空间不足，更新未替换当前应用。请检查权限和磁盘空间。',
  'error.UPDATE_INSTALL_INVALID': '安装包中的应用身份、版本或结构不符合要求，已停止安装。',
  'error.UPDATE_SIGNATURE_MISMATCH': '新版本的签名身份与已安装应用不一致，已拒绝更新。',
  'error.UPDATE_QUIT_TIMEOUT': '等待旧应用退出超时，原应用没有被替换。',
  'error.UPDATE_REPLACE_FAILED': '替换失败，已保留或恢复原应用。请检查安装目录权限后重试。',
  'error.UPDATE_ROLLBACK_FAILED':
    '替换与自动恢复未完成。原应用保留在安装目录的 .contextweave-update-* 内，请勿删除该备份，可从发行页重新安装。',
  'error.UPDATE_RESTART_FAILED':
    '新版已放入安装位置，但系统未能启动它。请按系统提示处理权限或验证问题；旧应用备份仍保留。',
  'proxy.httpOnly': 'HTTP 连通；HTTPS 尚未验证',
  'proxy.ipUnavailable': '出口 IP 查询不可用，不影响本次连通结果',
  'proxy.import.title': '批量新增代理',
  'proxy.import.description': '一行一个代理，支持 HTTP、HTTPS 和 SOCKS5。未写协议时统一使用 HTTP。',
  'proxy.import.lines': '代理列表',
  'proxy.import.help': '每次最多 200 个非空行，空行忽略。',
  'proxy.import.formatDetails': '格式说明',
  'proxy.import.formats':
    '支持 host:port、[scheme://]user:password@host:port 与 [scheme://]host:port:username:password；IPv6 地址需加方括号。',
  'proxy.import.credentials':
    'URI 凭据中的 @、:、#、%、/ 等特殊字符需百分号编码；冒号分隔格式的凭据按原文保存，密码可含冒号，但含 @ 时须改用编码后的 URI。有歧义的格式会被拒绝，不会猜测凭据。',
  'proxy.import.duplicates': '相同协议、地址、端口和用户名会跳过，已有密码不会被覆盖。',
  'proxy.import.limit': '请填写代理，最多 200 个非空行、65,536 个字符。',
  'proxy.import.summary':
    '成功 {created} 项，失败 {failed} 项，重复跳过 {skipped} 项。输入已清空以保护凭据；失败代理仅显示脱敏信息，请修正后重新粘贴。',
  'proxy.import.failures': '失败代理（凭据已脱敏）',
  'proxy.import.hidden': '无法安全识别代理，原文已隐藏',
  'proxy.import.line': '第 {line} 行',
  'proxy.import.duplicate': '该连接已存在，已跳过',
  'proxy.import.invalid': '格式无效或有歧义，请检查协议、主机、端口或凭据',
  'proxy.import.secureUnavailable': '系统安全存储不可用，密码未保存',
  'proxy.import.saveFailed': '保存失败，未保存的行可以重试',
  'proxy.import.submit': '导入代理',
  'proxy.cleanup.title': '凭据清理尚未完成',
  'proxy.cleanup.description':
    '有 {count} 项凭据等待安全清理。已提交的代理配置保持有效；仍被使用的凭据不会删除。可修复存储权限后重试，应用下次启动也会重试。',
  'proxy.cleanup.temporary': '还有遗留临时文件未能清理，请检查应用数据目录的权限或文件占用。',
  'proxy.cleanup.retry': '重试清理',
  'proxy.cleanup.failed': '无法读取或执行凭据维护，请检查存储状态后重试。',
  'error.UPDATE_RELEASE_INVALID': '发行信息无效或不是可用的正式版本，请稍后重试。',
  'error.UPDATE_CHECKSUM_UNAVAILABLE':
    '此安装包缺少可信 SHA-256，暂不能下载。请等待发布者补全发行信息。',
  'error.UPDATE_RATE_LIMITED': 'GitHub 请求被限制，请稍后再检查。',
  'error.UPDATE_CHECK_FAILED': '无法检查更新，请检查网络后重试。',
  'error.UPDATE_TIMEOUT': '更新请求超时，请检查网络后重试。',
  'error.UPDATE_FAILED': '更新操作未完成，请检查网络、存储空间及目录权限后重试。',
  'error.UPDATE_MOUNT_FAILED':
    '无法挂载更新安装包。请先退出应用并推出已打开的同版本安装镜像，再重新打开应用重试；也可从发行说明手动安装。',
  'error.UPDATE_COPY_FAILED':
    '无法准备新版本，请检查应用安装目录的剩余空间与写入权限。当前版本未被替换。',
  'error.UPDATE_CLEANUP_FAILED': '更新暂存目录未能清理，当前版本未被替换。请退出应用后重试。',
  'error.UPDATE_NOT_AVAILABLE': '请先检查更新并选择可用的本机安装包。',
  'error.UPDATE_NOT_READY': '安装包尚未准备好，请先完成下载和校验。',
  'error.UPDATE_FILE_INVALID': '已下载的安装包丢失或被修改，请重新下载。',
  'error.UPDATE_ENVIRONMENTS_ACTIVE': '请先停止正在运行的环境并完成异常恢复，再进行自动更新。',
  'error.UPDATE_OPEN_FAILED': '系统无法打开安装包或发行说明，请重试。',

  'error.KERNEL_VERSION_MISMATCH':
    '实际浏览器版本与环境绑定版本不一致，已停止启动，请安装正确的版本。',

  'error.CUSTOM_SOURCE_DETAILS_REQUIRED':
    '自定义下载源需要填写内核版本、可信 SHA-256，并确认来源和许可。',
  'error.RELEASE_UNREVIEWED':
    '此发行物尚未纳入应用的固定版本与摘要集合，不能自动下载。已安装环境不会被删除或降级；自定义来源需自行确认版本、摘要与许可。',
  'error.ADAPTER_UNSUPPORTED': '该内核版本尚无兼容的参数适配，请选择受支持的版本。',

  'error.PLATFORM_UNSUPPORTED': '此内核版本尚不支持当前平台或架构。',
  'error.DOWNLOAD_FAILED': '内核下载失败，请检查网络后重试。',
  'error.DOWNLOAD_TIMEOUT': '下载超时，请稍后重试。',
  'error.DOWNLOAD_SOURCE_INVALID': '下载来源不在受信任的清单中，已阻止下载。',
  'error.PACKAGE_SIZE_MISMATCH': '下载文件大小不正确，已取消安装，请重试。',
  'error.PACKAGE_HASH_MISMATCH': '内核 SHA-256 校验失败，已拒绝安装，请重新下载。',
  'error.ARCHIVE_UNSAFE': '内核归档包含不安全的路径或异常内容，已拒绝解包。',
  'error.ARCHIVE_UNMOUNT_FAILED':
    '内核镜像未能安全卸载，安装已停止并保留临时资源。请先推出占用的镜像再重试；不要直接删除挂载目录。',
  'error.ARCHIVE_INVALID': '内核归档结构无效，请重新下载。',
  'error.EXECUTABLE_INVALID': '内核包缺少有效的可执行文件。',
  'error.ARCHIVE_MOUNT_FAILED':
    '无法挂载内核磁盘映像。请先推出已打开的同版本磁盘映像，再重试安装。',
  'error.ARCHITECTURE_MISMATCH': '内核架构与当前平台不匹配。',
  'error.INSTALL_FAILED': '内核安装失败，已有安装与环境数据保持不变，请重试。',
  'error.PROXY_TEST_FAILED': '代理认证或 HTTPS 请求失败，请检查代理设置。',
  'error.PROXY_TEST_TIMEOUT': '代理连接测试超时，请检查网络。',

  'life.active': '环境',
  'life.trash': '回收站',
  'life.restore': '恢复环境',
  'life.restored': '环境已恢复',
  'life.trashedAt': '移入时间',
  'life.trashEmpty': '回收站为空',
  'life.trashHelp':
    '环境配置、运行记录和浏览器数据会保留。恢复后可重新打开；此阶段不提供永久删除。',
  'life.preflight': '启动预检',
  'life.preflightSaved': '基于已保存的配置进行检查。修改后保存，启动时会再次检查。',
  'life.preflightNew': '保存环境后可查看完整预检结果，启动前会检查内核、代理、凭据和数据目录。',
  'life.preflightReady': '可以启动',
  'life.preflightBlocked': '需要处理以下问题',
  'life.preflightCheck': '重新检查',
  'life.revision': '配置修订',
  'life.native': '原生隔离环境',
  'life.nativeHelp': '使用本机 Chromium 系浏览器及独立数据目录；不提供已验证的内核级指纹修改。',
  'life.cap.unverified': '未验证',
  'life.cap.verified': '已验证',
  'life.cap.unsupported': '不支持',
  'life.cap.failed': '验证失败',
  'life.capHelp':
    '未验证表示只有内核的能力声明，尚无本机测试证据。下载校验完成后会用临时资料和离线页面检测 CDP、截图、文件上传、User-Agent 与时区；代理和 WebRTC 仍需专门的网络场景验证。基础检测不代表提供方或指纹效果认证。',
  'life.sessions': '运行会话',
  'life.operations': '操作记录',
  'life.endedAt': '结束时间',
  'life.phase': '阶段',
  'life.result': '结果',
  'life.startedAt': '开始时间',
  'life.kind': '操作',
  'life.orphans': '待处理数据目录',
  'life.orphansHelp': '以下目录没有关联的环境记录。系统仅列出供检查，不自动清理或猜测如何恢复。',
  'life.orphansEmpty': '没有发现未关联目录。',
  'life.op.start': '启动',
  'life.op.stop': '停止',
  'life.op.recover': '恢复运行状态',
  'life.op.create': '创建',
  'life.op.update': '更新配置',
  'life.op.trash': '移入回收站',
  'life.op.restore': '恢复环境',
  'life.op.install': '安装内核',
  'life.result.running': '执行中',
  'life.result.succeeded': '成功',
  'life.result.failed': '失败',
  'life.result.cancelled': '已取消',
  'life.phase.queued': '等待执行',
  'life.phase.preflight': '预检',
  'life.phase.launch': '启动浏览器',
  'life.phase.configure': '应用设置',
  'life.phase.completed': '完成',
  'life.phase.failed': '失败',
  'life.phase.interrupted': '客户端中断',
  'life.phase.ended': '结束',
  'life.phase.legacy': '历史记录',
  'life.phase.running': '运行中',
  'life.phase.starting': '启动中',
  'life.phase.stopping': '停止中',
  'error.FINGERPRINT_CPU_UNSUPPORTED':
    '此内核要求身份中的逻辑核数不超过当前设备。配置未被修改，请在足够核数的设备上使用此环境。',
  'error.CONFIG_INVALID': '环境配置无效，请检查并重新保存。',
  'error.ENVIRONMENT_TRASHED': '环境已移入回收站，请先恢复。',
  'error.KERNEL_UNAVAILABLE':
    '未发现绑定版本的可用内核，请在内核页面下载指纹内核或安装本机 Chrome、Edge。',
  'error.PROVIDER_UNVERIFIED': '此指纹提供方尚未验证，暂时不能启动或安装。',
  'error.PLATFORM_MISMATCH': '环境的平台或架构与当前设备不匹配。',
  'error.RUNTIME_BUSY': '环境仍被浏览器占用，请先停止。',
  'error.ENVIRONMENT_BUSY': '请先停止浏览器并完成恢复，再修改或移入回收站。',
  'error.RECOVERY_REQUIRED': '存在上次运行的遗留状态，请先恢复。',
  'error.RECOVERY_MANUAL_REQUIRED':
    '旧运行进程仍存在。请先手动关闭该浏览器，再重试恢复；系统不会仅凭旧 PID 终止进程。',
  'error.RECOVERY_LOCK_UNREADABLE':
    '运行锁损坏或不完整，请在确认浏览器关闭后检查数据目录中的运行锁。',
  'error.PROXY_CREDENTIAL_TARGET_CHANGED':
    '代理协议、地址、端口或用户名已更改，请重新输入密码或明确清除已存密码后再测试或保存。',
  'error.PROXY_MISSING': '绑定的代理已不存在，请重新选择代理。',
  'error.PROXY_UNREACHABLE': '无法连接代理。请检查地址和网络；不会自动降级为直连。',
  'error.PROXY_IN_USE': '代理仍被环境或回收站中的环境引用，请先解除绑定。',
  'error.CREDENTIAL_UNAVAILABLE': '系统无法解密代理凭据，请重新保存密码或检查系统安全存储。',
  'error.CREDENTIAL_STORE_UNREADABLE': '凭据存储无法读取，原文件已保留。',
  'error.DIRECTORY_UNWRITABLE': '浏览器数据目录无法写入，请检查权限和目录是否存在。',
  'error.LOW_DISK': '可用磁盘空间不足，请释放空间后重试。',
  'error.NATIVE_MODE': '当前为原生隔离模式，不宣称已具备内核级指纹修改。',
  'error.VERSION_CHANGED': '本机浏览器版本已变化，启动可能升级用户目录格式。',
  'error.LEGACY_SETTINGS_UNSUPPORTED': '旧配置包含当前内核不支持的设置，需要先修正。',
  'error.CONFIG_CONFLICT': '配置已被其他操作修改。请保留当前输入，重新打开最新配置后再保存。',
  'error.OPERATION_IN_PROGRESS': '此环境已有操作正在执行，请稍后重试。',
  'error.ALREADY_RUNNING': '环境已在启动或运行中。',
  'error.CANCELLED': '操作已取消。',
  'error.BROWSER_PREFERENCES_INVALID':
    '浏览器首选项损坏或结构不受支持，原文件已保留。请先备份该环境，在 Default 目录中检查或手动修复 Preferences 后重试；不会自动重置会话。',
  'error.BROWSER_PREFERENCES_TOO_LARGE':
    '浏览器 Preferences 超过 16 MiB 安全读取上限，原文件已保留。请备份并检查异常增长后重试。',
  'error.BROWSER_PROFILE_IO_FAILED':
    '无法安全读写浏览器配置，请检查磁盘空间、文件权限和占用状态后重试；不会清空原配置。',
  'error.BROWSER_PROFILE_UNSAFE':
    '浏览器配置目录或文件不是受支持的普通目录/文件，已停止写入。请先备份并检查链接或异常文件。',
  'error.START_FAILED': '浏览器启动失败，请查看预检和运行记录。',
  'error.CONTROL_UNAVAILABLE': '浏览器私有控制连接不可用，请停止或恢复环境后重试。',
  'error.CONTROL_PIPE_UNAVAILABLE': '该浏览器无法建立私有控制管道，请使用受支持的内核。',
  'error.CONTROL_TIMEOUT': '浏览器控制连接超时，请检查内核或恢复环境。',
  'error.STOP_TIMEOUT': '浏览器未能停止，已保留运行锁，请手动关闭后恢复。',
  'error.SPAWN_FAILED': '无法创建浏览器进程，请检查内核和权限。',
  'error.NOT_FOUND': '记录已不存在，请重新加载。',
  'error.INVALID_INPUT': '请求参数无效，请检查输入。',
  'error.COMMAND_FAILED': '操作未完成，请检查环境状态并重试。',
  'error.CLIENT_INTERRUPTED': '客户端在操作完成前退出。',
  'error.USER_STOPPED': '由用户停止。',
  'error.BROWSER_CLOSED': '浏览器正常关闭。',
  'error.PROCESS_CRASHED': '浏览器进程异常退出。',
  'error.PROCESS_SIGNAL': '浏览器进程被外部信号终止。',
  'kernel.remove': '删除内核',
  'kernel.removed': '内核已删除，环境配置和浏览器数据已保留。',
  'kernel.removeTitle': '删除 {name}？',
  'kernel.removeDescription':
    '仅删除下载的内核文件，不会删除环境配置、标签或网站数据。当前有 {count} 个环境（含回收站）引用此内核；再次启动前必须重新下载相同版本。运行中或待恢复的环境会阻止删除。未纳入当前固定清单的旧版本不能直接重新下载；自定义来源若已失效，需重新确认地址和摘要。请先确认有可用的恢复来源。',
  'kernel.removalPending': '删除未完成 · 可重试',
  'error.KERNEL_NOT_MANAGED': '只允许删除本应用下载管理的内核，不能删除系统浏览器或外部安装。',
  'error.KERNEL_PATH_UNSAFE':
    '安装目录校验失败，未删除文件。请检查目录是否被移动或替换为符号链接。',
  'error.KERNEL_REMOVE_FAILED':
    '删除未完成，内核已禁用。请关闭占用文件的程序，检查目录权限后重试删除。',
  'error.KERNEL_REMOVAL_PENDING': '此内核有未完成的删除，请先在内核列表重试删除，再重新下载。',
  'life.op.remove-kernel': '删除内核',
  'error.KERNEL_IN_USE':
    '此内核仍被启动中、运行中、停止中或待恢复的环境占用。请先停止相关环境并完成恢复，再重试删除。',
  'kernel.pinnedVersion': '环境固定版本',
  'cleanup.title': '清理应用运行记录',
  'cleanup.help':
    '仅清理指定期限之前已结束的会话和操作记录。需先预览，再确认本批次；不会自动执行或继续下一批。',
  'cleanup.protected':
    '运行中、启动/停止中及待恢复环境的关联记录、未完成或语义不明的记录，以及每个环境最近一次内核版本判断所需的记录都会保留。',
  'cleanup.retention': '保留最近',
  'cleanup.days': '{days} 天',
  'cleanup.preview': '预览清理范围',
  'cleanup.discard': '放弃本批预览',
  'cleanup.batch': '本批最多清理 {sessions} 条会话记录和 {operations} 条操作记录。',
  'cleanup.cutoff': '仅考虑结束时间早于 {date} 的记录。',
  'cleanup.cutoffLabel': '截止时间',
  'cleanup.expires': '预览有效期至 {date}；到期后需重新预览。',
  'cleanup.more':
    '仍有后续候选记录。本页数量不是全库总数；本批完成后，如有需要，请重新预览并单独确认下一批。',
  'cleanup.review': '确认本批清理…',
  'cleanup.empty': '本批没有可清理的记录',
  'cleanup.emptyHelp': '这不代表没有历史记录；近期、受保护或无法安全判断的记录不会进入候选。',
  'cleanup.limit':
    '每批最多 500 条会话和 500 条操作。候选数量有限，但查询耗时仍受历史规模影响。不会清理浏览器文件、凭据、回收站或截图，不自动压缩数据库，也不保证数据库文件立即变小。',
  'cleanup.uncertain':
    '本次确认尚未得到可核实的结果，错误不一定代表未提交。请查询最近已提交回执，或重新确认同一批次。重试同一批次不会清理新记录；放弃预览也不会撤销已经提交的清理。',
  'cleanup.committed': '本批清理已提交，详情见最近回执。状态变化或已不存在的候选已跳过。',
  'cleanup.replayed': '已核对到本批之前提交的回执，没有再次删除或执行新批次。',
  'cleanup.receipt': '最近已提交的清理回执',
  'cleanup.checkReceipt': '查询回执',
  'cleanup.completedAt': '提交时间',
  'cleanup.batchId': '批次标识',
  'cleanup.sessions': '会话记录',
  'cleanup.operations': '操作记录',
  'cleanup.outcome': '候选 {selected} · 已删除 {deleted} · 已跳过 {skipped}',
  'cleanup.noReceipt': '尚无已提交的清理回执。',
  'cleanup.receiptHelp':
    '仅保留最近一次已提交结果，重开应用后可查询；不是永久审计或备份。查询不会执行删除，也不会把不同批次的回执当作本次成功。',
  'cleanup.confirmTitle': '永久删除本批历史记录？',
  'cleanup.confirmHelp':
    '此操作不可撤销。确认时会再次核验保护条件，跳过已变化的记录，不会扩大本批范围或自动继续。',
  'cleanup.confirm': '永久删除本批',
  'error.HISTORY_CLEANUP_PREVIEW_INVALID':
    '预览已被替换、失效或在重启后丢失；请先核对最近回执，再重新预览。',
  'error.HISTORY_CLEANUP_PREVIEW_EXPIRED': '预览已过期，本次没有执行清理。请重新预览并确认。',
  'error.HISTORY_CLEANUP_EMPTY': '本批没有候选记录，未执行清理。',
  'error.HISTORY_CLEANUP_RECEIPT_INVALID':
    '最近清理回执无法安全读取，已停止清理。请保留数据库并检查诊断信息。',
  'artifacts.title': '已登记截图',
  'artifacts.help':
    '只读查看本版起成功登记的截图，刷新或重启后可核对任务结果。容量为登记时的字节数，不代表当前文件仍然存在。',
  'artifacts.limitations':
    '不包含旧的未登记输出、浏览器目录和备份；不会扫描认领或删除未知文件。本视图不是全盘用量、备份或配额管理。',
  'artifacts.total': '已登记 {count} 个产物 · 合计 {bytes} 字节',
  'artifacts.recorded': '仅表示登记时已校验，不表示当前文件已重新校验。',
  'artifacts.completedAt': '登记时间',
  'artifacts.environment': '环境',
  'artifacts.identity': '产物 ID / 任务 ID',
  'artifacts.bytes': '登记大小',
  'artifacts.empty': '本页没有已登记截图',
  'artifacts.emptyHelp': '成功完成截图任务后将显示在这里；旧输出不会自动纳入。',
  'artifacts.pagination': '截图产物分页',
  'artifacts.previous': '上一页',
  'artifacts.next': '下一页',
  'error.WORKER_OUTPUT_INVALID': '截图归属或内容校验失败，未登记为完成产物。',
  'error.WORKER_OUTPUT_REGISTRATION_UNCONFIRMED':
    '截图登记结果未确认，文件已保留。请刷新列表或重启核对；重新运行会生成另一产物，不会自动补登旧文件。',
  'error.ARTIFACT_RECORD_INVALID': '产物记录无法安全读取，已停止查询。请保留数据并检查诊断信息。',
  'error.ARTIFACT_STORAGE_UNAVAILABLE':
    '截图登记连接已安全关闭，环境管理仍可使用。请重启应用后核对已提交的产物记录。',
  'artifactBudget.title': '截图容量预算',
  'artifactBudget.help':
    '每项新截图先持久预留最多 32 MiB，完成后按登记字节计费。降低预算不删除文件，也不会取消已准入任务；额度不足只阻断新的截图。',
  'artifactBudget.scope':
    '仅统计已登记截图与未解除预留，不是全盘磁盘配额；不包含旧的未登记输出、浏览器目录、内核、备份或目录元数据。',
  'artifactBudget.registered': '已登记字节',
  'artifactBudget.reserved': '预留字节 · 项数（含待核对）',
  'artifactBudget.available': '可用预算字节',
  'artifactBudget.limit': '容量上限（MiB）',
  'artifactBudget.range': '默认 1024 MiB。可设置 32～102400 MiB 的整数；1 MiB = 1048576 字节。',
  'artifactBudget.invalid': '请输入 32～102400 之间的整数 MiB。',
  'artifactBudget.saving': '正在保存截图预算…',
  'artifactBudget.save': '保存截图预算',
  'artifactBudget.reset': '采用当前设置',
  'artifactBudget.conflict': '设置已在其他操作中更新。请采用当前设置后重新编辑，避免覆盖新的配置。',
  'artifactBudget.saved': '截图预算已保存。现存文件未被删除，已准入任务继续运行。',
  'artifactBudget.uncertain':
    '中断或结果未确认的预留会在重启后继续计费；不会自动重新运行、删除文件或解除未知占用。本版尚未提供显式文件清理。',
  'error.ARTIFACT_BUDGET_EXCEEDED':
    '截图预算不足以预留本次最多 32 MiB，任务未启动。请在本地存储设置中检查占用或调整预算。',
  'error.WORKER_OUTPUT_RESERVATION_UNCONFIRMED':
    '截图任务未启动；容量预留或空分配结果未确认，可能的占用将保守保留。请重启后核对，不会自动重试。',
  'error.ARTIFACT_BUDGET_CONFLICT': '截图预算设置已变化，请刷新核对后重新编辑。',
  'error.ARTIFACT_BUDGET_UPDATE_UNCONFIRMED':
    '截图预算保存结果未确认。请刷新或重启核对，不要将本次错误视为一定没有保存。',
  'error.ARTIFACT_BUDGET_REVISION_LIMIT': '截图预算修订已达到安全上限，请保留数据并联系维护者。',
} as const
