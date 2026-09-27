export type StartupErrorCode =
  | 'WORKSPACE_PATH_UNSAFE'
  | 'DATABASE_WORKSPACE_INVALID'
  | 'DATABASE_CORRUPT'
  | 'DATABASE_INTEGRITY_FAILED'
  | 'DATABASE_SCHEMA_UNSUPPORTED'
  | 'DATABASE_FOREIGN_KEYS_UNAVAILABLE'
  | 'DATABASE_VERSION_UNSUPPORTED'
  | 'DATA_ACCESS_DENIED'
  | 'DATA_BUSY'
  | 'DISK_FULL'
  | 'DATA_IO_FAILED'
  | 'UI_LOAD_FAILED'
  | 'INITIALIZATION_FAILED'

/** Use structured OS/SQLite codes, never raw paths, SQL, stack traces or error bodies. */
export function classifyStartupError(error: unknown): StartupErrorCode {
  if (typeof error !== 'object' || error === null) return 'INITIALIZATION_FAILED'
  const code = 'code' in error && typeof error.code === 'string' ? error.code : ''
  const sqlite = 'errcode' in error && typeof error.errcode === 'number' ? error.errcode & 255 : 0
  const message = error instanceof Error ? error.message : ''
  if (
    message === 'WORKSPACE_PATH_UNSAFE' ||
    message === 'DATABASE_WORKSPACE_INVALID' ||
    message === 'DATABASE_INTEGRITY_FAILED' ||
    message === 'DATABASE_SCHEMA_UNSUPPORTED' ||
    message === 'DATABASE_FOREIGN_KEYS_UNAVAILABLE'
  )
    return message
  if (message === 'UI_LOAD_FAILED') return 'UI_LOAD_FAILED'
  if (message === 'DATABASE_CORRUPT' || [11, 26].includes(sqlite)) return 'DATABASE_CORRUPT'
  if (message === 'This database requires a newer ContextWeave version')
    return 'DATABASE_VERSION_UNSUPPORTED'
  if (['EACCES', 'EPERM', 'EROFS'].includes(code) || [3, 8, 14, 23].includes(sqlite))
    return 'DATA_ACCESS_DENIED'
  if (['EBUSY', 'EAGAIN'].includes(code) || [5, 6].includes(sqlite)) return 'DATA_BUSY'
  if (code === 'ENOSPC' || sqlite === 13) return 'DISK_FULL'
  if (code === 'EIO' || sqlite === 10) return 'DATA_IO_FAILED'
  return 'INITIALIZATION_FAILED'
}

const descriptions: Record<StartupErrorCode, [string, string]> = {
  WORKSPACE_PATH_UNSAFE: [
    '数据路径不属于当前工作空间或包含不安全链接，已停止打开。请保留完整原数据并检查目录；不会自动移动、覆盖或删除文件。',
    'A data path does not belong to this workspace or contains an unsafe link. Opening has stopped. Preserve the original data and inspect the directories; no files will be moved, overwritten or deleted automatically.',
  ],
  DATABASE_WORKSPACE_INVALID: [
    '本地工作空间身份缺失或不合法，已停止打开数据。请保留完整数据目录并反馈此错误代码；不会自动生成新身份或清空数据。',
    'The local workspace identity is missing or invalid. Opening has stopped. Preserve the full data directory and report this code; no replacement identity or empty database will be created.',
  ],
  DATABASE_INTEGRITY_FAILED: [
    '数据库存在不一致的关联或不合法的历史值，升级或打开已停止。请先保留完整数据目录并反馈此错误代码；不会自动删除或改写异常记录。',
    'The database contains inconsistent relations or invalid stored values. Opening or upgrading has stopped. Preserve the full data directory and report this code; invalid records will not be deleted or rewritten automatically.',
  ],
  DATABASE_SCHEMA_UNSUPPORTED: [
    '数据库结构与受支持的版本不一致，升级已停止。请保留完整数据目录并反馈此错误代码；不会丢弃额外的列、索引或数据。',
    'The database structure differs from the supported schema. Upgrading has stopped. Preserve the full data directory and report this code; extra columns, indexes or data will not be discarded.',
  ],
  DATABASE_FOREIGN_KEYS_UNAVAILABLE: [
    '数据库关系保护无法启用，已停止打开数据。请保留数据目录并重新安装受支持的应用版本。',
    'Database relationship enforcement could not be enabled. Opening has stopped. Preserve the data directory and reinstall a supported application version.',
  ],
  DATABASE_CORRUPT: [
    '本地数据库无法读取或已损坏。请先保留数据目录副本，再从已验证的备份恢复。',
    'The database is unreadable or damaged. Preserve a copy of the data directory before restoring a verified backup.',
  ],
  DATABASE_VERSION_UNSUPPORTED: [
    '数据由更新版本创建，请使用相应版本打开，不要覆盖或降级数据库。',
    'This database requires a newer application. Use that version; do not overwrite or downgrade the database.',
  ],
  DATA_ACCESS_DENIED: [
    '无法访问数据目录或数据库只读。请检查目录是否存在、磁盘挂载和读写权限。',
    'The data directory cannot be accessed or is read-only. Check its location, disk mount and permissions.',
  ],
  DATA_BUSY: [
    '数据正在被占用。请关闭使用此数据的其他程序后重试。',
    'Data is locked. Close other applications using this data before retrying.',
  ],
  DISK_FULL: [
    '磁盘空间不足。请释放空间后重试，不要删除唯一的数据副本。',
    'The disk is full. Free space and retry without deleting your only copy of the data.',
  ],
  DATA_IO_FAILED: [
    '读取或写入数据失败。请检查磁盘连接与状态并保留数据副本。',
    'A data I/O operation failed. Check the disk connection and preserve a copy of your data.',
  ],
  UI_LOAD_FAILED: [
    '管理界面加载失败。请重新启动，或从官方发布页重新安装应用。',
    'The interface failed to load. Restart or reinstall the application from the official release.',
  ],
  INITIALIZATION_FAILED: [
    '应用初始化失败。请保留原数据，检查磁盘和权限后重试；仍失败时反馈此错误代码。',
    'Initialization failed. Preserve your data, check disk access and retry. Report this error code if the problem persists.',
  ],
}

export function startupFailureMessage(code: StartupErrorCode, locale: string) {
  const zh = locale.startsWith('zh')
  return {
    title: zh ? 'ContextWeave 启动失败' : 'ContextWeave could not start',
    message: descriptions[code][zh ? 0 : 1],
    detail: zh
      ? `错误代码：${code}\n不会自动删除数据、重建空库或覆盖备份。\n“打开数据目录”仅用于查看和保留副本；.before-v*.bak 是迁移前数据库快照，不是完整环境备份。修复问题后选择“重新启动”。`
      : `Error code: ${code}\nNo automatic deletion, empty database replacement or backup overwrite will be performed.\nOpen the data folder to inspect or copy it. The .before-v*.bak files are pre-migration database snapshots, not full environment backups. Restart after addressing the problem.`,
    buttons: zh ? ['重新启动', '打开数据目录', '退出'] : ['Restart', 'Open data folder', 'Exit'],
  }
}

export async function recoverStartup(options: {
  error: unknown
  locale: string
  show(message: ReturnType<typeof startupFailureMessage>, folderFailed: boolean): Promise<number>
  openDataFolder(): Promise<boolean>
}): Promise<'restart' | 'exit'> {
  const message = startupFailureMessage(classifyStartupError(options.error), options.locale)
  let folderFailed = false
  for (;;) {
    let choice: number
    try {
      choice = await options.show(message, folderFailed)
    } catch {
      return 'exit'
    }
    if (choice === 0) return 'restart'
    if (choice !== 1) return 'exit'
    try {
      folderFailed = !(await options.openDataFolder())
    } catch {
      folderFailed = true
    }
  }
}
