// Real sandboxed Electron UI, isolated data, loopback-free fixtures, no user browser profiles.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const { _electron } = require('playwright-core')
const root = await mkdtemp(join(tmpdir(), 'cw-user-workflows-'))
async function verifyPinnedActions(page) {
  const state = await page.evaluate(() => {
    const table = document.querySelector('[data-slot="data-table"] table')
    const scroller = table?.parentElement
    const head = table?.querySelector('th[data-actions]')
    if (!table || !scroller || !head) return null
    const width = table.style.minWidth
    table.style.minWidth = '1800px'
    scroller.scrollLeft = 600
    const result = { position: getComputedStyle(head).position, right: getComputedStyle(head).right, align: getComputedStyle(head).textAlign,
      delta: Math.abs(head.getBoundingClientRect().right - scroller.getBoundingClientRect().right),
      cells: [...table.querySelectorAll('td[data-actions]')].map((cell) => getComputedStyle(cell).position) }
    table.style.minWidth = width; scroller.scrollLeft = 0
    return result
  })
  assert(state, 'A shared action column must be present')
  assert.equal(state.position, 'sticky'); assert.equal(state.right, '0px'); assert.equal(state.align, 'right')
  assert(state.delta < 3, `Action header must remain at the right scroll edge (${state.delta})`)
  assert(state.cells.every((position) => position === 'sticky'))
}
let app, clipboardText
try {
  app = await _electron.launch({
    executablePath: require('electron'),
    args: [resolve(fileURLToPath(new URL('../apps/desktop/', import.meta.url)))],
    env: { ...process.env, CONTEXTWEAVE_USER_DATA: root },
    timeout: 20000,
  })
  const page = await app.firstWindow()
  await page.waitForFunction(() => typeof window.contextweave?.app?.copyPath === 'function')
  await page.getByRole('link', { name: '环境', exact: true }).click()
  await page.getByRole('tab', { name: '环境', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '管理分组', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '保存的视图', exact: true }).count(), 0)

  await page.getByRole('link', { name: '系统设置', exact: true }).click()
  assert.equal(await page.getByRole('link', { name: '帮助与故障排查', exact: true }).count(), 0)
  assert.equal(await page.locator('nav[aria-label] a[href*="settings/bookmarks"]').count(), 0)
  clipboardText = await app.evaluate(({ clipboard }) => clipboard.readText())
  const paths = await page.evaluate(() => window.contextweave.app.getPaths())
  assert(paths.ok)
  await page.getByRole('button', { name: '复制 工作区数据', exact: true }).click()
  await page.getByText('已复制', { exact: true }).waitFor()
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), paths.data.dataRoot)

  await page.getByRole('link', { name: '书签', exact: true }).click()
  await page.getByRole('button', { name: '新增书签', exact: true }).waitFor()
  assert(page.url().endsWith('/bookmarks'))
  assert.equal(await page.locator('h1').count(), 0)
  for (let index = 1; index <= 2; index++) {
    await page.getByRole('button', { name: '新增书签', exact: true }).click()
    // Base UI's clipboard toast also has a dialog role; check actual modal editors.
    assert.equal(await page.locator('[data-slot="dialog-content"]:visible').count(), 0)
    await page.getByRole('textbox', { name: `名称 ${index}`, exact: true }).fill(`Local fixture ${index}`)
    await page.getByRole('textbox', { name: `网址 ${index}`, exact: true }).fill(`https://example.invalid/bookmark-${index}`)
  }
  const bookmarkRow = page.locator('[data-slot="sortable-item"]').first()
  const centers = await bookmarkRow.locator('input:not([type="hidden"]):not([type="checkbox"]), [role="checkbox"], button[aria-label^="删除书签"]').evaluateAll((items) => items.map((item) => { const rect = item.getBoundingClientRect(); return rect.y + rect.height / 2 }))
  assert(centers.length === 4 && Math.max(...centers) - Math.min(...centers) < 2, 'Bookmark inputs, checkbox and delete share a center line')
  const add = await page.getByRole('button', { name: '新增书签', exact: true }).boundingBox()
  const save = await page.getByRole('button', { name: '保存更改', exact: true }).boundingBox()
  assert(add && save && Math.abs(add.y - save.y) < 2, 'Add bookmark lives next to Save in the toolbar')
  await page.getByRole('checkbox', { name: '启动时打开', exact: true }).first().check()
  const firstHandle = page.getByRole('button', { name: '拖动排序: Local fixture 1', exact: true })
  await firstHandle.focus()
  await page.keyboard.press('Space')
  // Wait for the measured initial drop target, not only the synchronous pressed state.
  await page.waitForFunction(() => document.querySelector('[id^="DndLiveRegion"]')?.textContent === '移至第 1 项')
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.keyboard.press('ArrowDown')
  await page.waitForFunction(() => document.querySelector('[id^="DndLiveRegion"]')?.textContent === '移至第 2 项')
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('input[id$="-name"]').value === 'Local fixture 2')
  assert.equal(await page.getByRole('textbox', { name: '名称 1', exact: true }).inputValue(), 'Local fixture 2')
  await page.getByRole('button', { name: '保存更改', exact: true }).click()
  await page.getByText('书签已保存，启动选项将在下次启动环境时生效。', { exact: true }).waitFor()
  await page.reload()
  await page.getByRole('textbox', { name: '名称 1', exact: true }).waitFor()
  const bookmarks = await page.evaluate(async () => window.contextweave.bookmarks.get({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }))
  assert(bookmarks.ok && bookmarks.data.items.length === 2)
  assert.equal(bookmarks.data.items[0].name, 'Local fixture 2')
  assert.equal(bookmarks.data.items[1].openOnStart, true)
  // Mouse dragging is independent of the keyboard sensor above.
  const from = await page.getByRole('button', { name: '拖动排序: Local fixture 2', exact: true }).boundingBox()
  const to = await page.getByRole('button', { name: '拖动排序: Local fixture 1', exact: true }).boundingBox()
  assert(from && to)
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
  await page.waitForFunction(() => document.querySelector('[id^="DndLiveRegion"]')?.textContent === '移至第 2 项')
  await page.mouse.up()
  await page.waitForFunction(() => document.querySelector('input[id$="-name"]').value === 'Local fixture 1')
  // dnd-kit suppresses clicks for 50ms after a pointer drop; use a human-speed click.
  await page.getByRole('button', { name: '删除书签: Local fixture 1', exact: true }).click({ delay: 100 })
  assert.equal(await page.getByRole('alertdialog').count(), 0)
  await page.getByRole('button', { name: '撤销删除', exact: true }).click()
  await page.getByRole('button', { name: '放弃更改', exact: true }).click()

  await page.getByRole('link', { name: '日志查看', exact: true }).click()
  await page.getByRole('tab', { name: '环境操作', exact: true }).click()
  await page.locator('[data-slot="data-table"]').waitFor()
  await page.locator('[data-slot="data-table-toolbar"]').getByRole('button', { name: '刷新', exact: true }).waitFor()
  await verifyPinnedActions(page)
  await page.getByRole('tab', { name: '批量操作历史', exact: true }).click()
  await page.locator('[data-slot="data-table-toolbar"]').getByRole('button', { name: '刷新结果', exact: true }).waitFor()
  await verifyPinnedActions(page)
  await page.getByRole('tab', { name: '应用日志', exact: true }).click()
  await page.getByRole('button', { name: '高级筛选', exact: true }).click()
  await page.getByRole('button', { name: '日期范围', exact: true }).click()
  await page.locator('[data-slot="calendar"]').waitFor()
  assert.equal(await page.locator('input[type="datetime-local"]').count(), 0)
  const day = page.locator('[data-slot="calendar"] button[data-day]').filter({ hasText: /^15$/ }).first()
  await day.click()
  await page.locator('[data-slot="calendar"] button[data-day]').filter({ hasText: /^18$/ }).first().click()
  assert.equal(await page.locator('[data-range-start="true"]').count(), 1)
  assert.equal(await page.locator('[data-range-end="true"]').count(), 1)
  const time = page.locator('#log-range-from-time')
  await time.fill('10:30')
  assert.equal(await time.inputValue(), '10:30')
  await page.getByRole('button', { name: '清除日期', exact: true }).click()
  await page.getByRole('button', { name: '日期范围', exact: true }).waitFor()
  assert((await page.getByRole('button', { name: '日期范围', exact: true }).innerText()).includes('选择开始和结束日期'))
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.evaluate(async () => {
    const context = { workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }
    for (const name of ['Fixture A', 'Fixture B', 'Keep this tag']) {
      const result = await window.contextweave.organization.createTag(context, { name })
      if (!result.ok) throw Error(result.code)
    }
  })
  await page.getByRole('link', { name: '标签', exact: true }).click()
  await page.getByRole('cell', { name: 'Keep this tag', exact: true }).waitFor()
  await verifyPinnedActions(page)
  await page.locator('thead').getByRole('checkbox').check()
  await page.locator('tbody tr').filter({ hasText: 'Keep this tag' }).getByRole('checkbox').uncheck()
  await page.getByRole('button', { name: '删除所选', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '删除所选', exact: true }).click()
  await page.getByRole('alertdialog').waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1)
  assert((await page.locator('tbody').innerText()).includes('Keep this tag'))
  for (const [route, title] of [['环境','环境列表'], ['代理','代理管理'], ['内核','内核管理']]) {
    await page.getByRole('link', { name: route, exact: true }).click()
    await page.getByRole('heading', { name: title, exact: true }).waitFor()
    await page.getByRole('table', { name: title, exact: true }).waitFor()
    await verifyPinnedActions(page)
  }
  const localKernel = page.locator('tbody tr').filter({ hasText: 'standard-chromium' }).first()
  let kernelCheck = 'no-local-executable'
  if (await localKernel.count()) {
    assert(await localKernel.getByRole('checkbox').isDisabled(), 'Never select a system browser for deletion')
    await localKernel.getByRole('button', { name: '修改名称', exact: true }).click()
    await page.locator('#kernel-custom-name').fill('Offline test kernel')
    await page.locator('[data-slot="dialog-content"]').getByRole('button', { name: '保存', exact: true }).click()
    await page.locator('[data-slot="dialog-content"]').waitFor({ state: 'hidden' })
    await page.reload()
    await page.getByText('Offline test kernel', { exact: true }).waitFor()
    await page.locator('tbody tr').filter({ hasText: 'standard-chromium' }).getByRole('button', { name: '查看详情', exact: true }).click()
    await page.getByRole('button', { name: '重新验证', exact: true }).click()
    await page.locator('[data-slot="dialog-content"]').getByText('已验证', { exact: true }).first().waitFor()
    const checked = await page.evaluate(async () => {
      const context = { workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }
      const result = await window.contextweave.kernel.list(context)
      return result.ok ? result.data.find((item) => item.id === 'standard-chromium') : undefined
    })
    assert.equal(checked.customName, 'Offline test kernel')
    for (const key of ['cdp','screenshot','elementScreenshot','fileUpload','userAgent','timezone']) assert.equal(checked.capabilityReport[key].state, 'verified', key)
    for (const key of ['proxy','webRtcPolicy']) assert.notEqual(checked.capabilityReport[key].state, 'verified')
    kernelCheck = 'passed-native-offline-checks-name-persists'
    await page.keyboard.press('Escape')
  }
  await page.getByRole('link', { name: '系统设置', exact: true }).click()
  await page.getByRole('link', { name: '关于', exact: true }).click()
  for (const name of ['New API','shadcn-admin','Ant Browser']) await page.getByRole('button', { name, exact: true }).waitFor()
  for (const name of ['shadcn/ui','coss ui','Dice UI / dnd-kit']) assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0)
  console.log(JSON.stringify({ userWorkflows: 'passed-native-clipboard-inline-bookmarks-keyboard-mouse-drag-startup-choice-unified-log-tables-date-range-aligned-controls-pinned-actions-tag-bulk-delete-credits', kernelCheck, platform: process.platform, arch: process.arch }))
} finally {
  if (app) {
    if (clipboardText !== undefined) await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), clipboardText)
    await app.close()
  }
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
