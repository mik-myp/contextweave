export const bookmarkMessages = {
  'bookmarks.title': '默认书签',
  'bookmarks.description': '管理当前工作空间的新浏览器资料使用的书签模板。',
  'bookmarks.scopeHelp':
    '仅在首次启动、确认浏览器资料尚未初始化时，按列表顺序写入书签栏。已有资料（包括克隆、导入的资料）不会修改；保存模板不会更新已启动过的资料，也不会自动打开网址或更改启动页。',
  'bookmarks.add': '新增书签',
  'bookmarks.edit': '编辑书签',
  'bookmarks.delete': '删除书签',
  'bookmarks.up': '上移',
  'bookmarks.down': '下移',
  'bookmarks.name': '名称',
  'bookmarks.url': '网址',
  'bookmarks.urlHelp': '仅支持 HTTP(S) 网址，不能包含 URL 用户名、密码、空格或控制字符。',
  'bookmarks.invalidName': '请输入 1–120 个字符的名称。',
  'bookmarks.apply': '应用到列表',
  'bookmarks.empty': '尚无默认书签',
  'bookmarks.emptyHelp': '默认列表为空。可以新增书签，或保持为空，不为新资料添加书签。',
  'bookmarks.save': '保存模板',
  'bookmarks.saving': '正在保存…',
  'bookmarks.saved': '模板已保存，仅影响之后首次初始化的浏览器资料。',
  'bookmarks.unsaved': '列表更改尚未保存。',
  'bookmarks.reset': '放弃更改',
  'bookmarks.conflict': '模板已在其他位置更改。请先记下当前编辑内容，再放弃更改并重新编辑。',
  'bookmarks.deleteConfirm': '从默认书签列表中删除？',
  'bookmarks.deleteHelp': '保存模板后生效，不会删除已有浏览器资料中的书签。',
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
