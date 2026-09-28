export const bookmarkMessages = {
  'bookmarks.openOnStart': '启动时打开',
  'bookmarks.drag': '拖动排序',
  'bookmarks.dragHelp': '按空格拾取，使用方向键移动，空格放下，Escape 取消。',
  'bookmarks.dragging': '已拾取书签',
  'bookmarks.dragPosition': '移至第 {position} 项',
  'bookmarks.dragged': '排序已更新，保存后生效',
  'bookmarks.dragCancelled': '已取消排序',
  'bookmarks.undoDelete': '撤销删除',
  'error.BOOKMARKS_STARTUP_FAILED': '启动书签未能打开。请检查内核状态与书签设置后重试。',
  'bookmarks.list': '书签列表',
  'bookmarks.title': '书签',
  'bookmarks.add': '新增书签',
  'bookmarks.delete': '删除书签',
  'bookmarks.name': '名称',
  'bookmarks.url': '网址',
  'bookmarks.urlHelp': '仅支持 HTTP(S) 网址，不能包含 URL 用户名、密码、空格或控制字符。',
  'bookmarks.invalidName': '请输入 1–120 个字符的名称。',
  'bookmarks.empty': '尚无书签',
  'bookmarks.emptyHelp': '新增书签，并选择是否在启动环境时打开。',
  'bookmarks.save': '保存更改',
  'bookmarks.saving': '正在保存…',
  'bookmarks.saved': '书签已保存，启动选项将在下次启动环境时生效。',
  'bookmarks.unsaved': '列表更改尚未保存。',
  'bookmarks.reset': '放弃更改',
  'bookmarks.conflict': '书签已在其他位置更改。请先记下当前编辑内容，再放弃更改并重新编辑。',
  'error.BOOKMARKS_CONFLICT': '默认书签已在其他位置更新。当前编辑内容已保留，请重新加载后再编辑。',
  'error.BOOKMARKS_SETTINGS_INVALID':
    '默认书签设置无法读取。原始数据未被覆盖，请检查工作空间数据或从备份恢复。',
  'error.BOOKMARKS_PROFILE_UNSAFE':
    '浏览器资料路径包含链接或不安全目录，未写入默认书签。请检查资料目录。',
  'error.BOOKMARKS_PROFILE_CHANGED':
    '浏览器资料在初始化期间发生变化，启动已停止。请确认没有其他程序修改该资料后重试。',
  'error.BOOKMARKS_PROFILE_IO_FAILED':
    '默认书签初始化失败，本次文件更改已撤销。请检查磁盘空间和目录权限后重试启动。',
  'error.BOOKMARKS_PROFILE_LOCK_REQUIRED': '未取得浏览器资料的独占运行锁，未写入默认书签。',
  'error.BOOKMARKS_PROFILE_RECOVERY_REQUIRED':
    '默认书签初始化曾中断或无法安全撤销，已停止启动以保护资料。请先备份资料并检查初始化记录，不要覆盖现有文件。',
} as const
