// Native acceptance only: invoke from an isolated desktop smoke with standard-chromium available.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { connectManagedBrowser } from './smoke-control.mjs'
import { until, withDeadline } from './native-packaged-host.mjs'

function requireSuccess(result, operation) {
  assert(result.ok, `${operation}: ${result.code ?? 'UNKNOWN'}`)
  return result.data
}

function throwFailures(errors) {
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) {
    const error = new AggregateError(errors, 'Default bookmarks smoke and cleanup failed')
    error.preserveSmokeDirectory = errors.some((item) => item.preserveSmokeDirectory === true)
    throw error
  }
}

async function collectFailure(errors, action) {
  try {
    await action()
  } catch (error) {
    errors.push(error)
  }
}

async function temporarySmokeRoot(desktop) {
  const location = await desktop.evaluate(({ app }) => ({
    actual: app.getPath('userData'),
    configured: process.env.CONTEXTWEAVE_USER_DATA,
  }))
  assert.equal(typeof location.configured, 'string', 'An explicit smoke userData root is required')
  assert.equal(resolve(location.actual), resolve(location.configured))
  const root = await realpath(location.actual)
  assert.equal(dirname(root), await realpath(tmpdir()), 'Refuse non-temporary browser data')
  assert.match(basename(root), /^cw-(?:desktop|bookmarks)-smoke-[a-zA-Z0-9_-]+$/)
  return root
}

async function nativeBookmarks(tab) {
  await tab.goto('chrome://bookmarks/', { waitUntil: 'domcontentloaded', timeout: 10000 })
  await tab.waitForFunction(
    () => typeof globalThis.chrome?.bookmarks?.getTree === 'function',
    undefined,
    { timeout: 10000 },
  )
  // Read Chromium's loaded native model, not our seed JSON or the manager's own settings.
  return withDeadline(
    tab.evaluate(async () => {
      const roots = await globalThis.chrome.bookmarks.getTree()
      const nodes = []
      function visit(node) {
        if (typeof node.url === 'string')
          nodes.push({ id: node.id, title: node.title, url: node.url, dateAdded: node.dateAdded })
        for (const child of node.children ?? []) visit(child)
      }
      for (const root of roots) visit(root)
      return nodes
    }),
    10000,
    'BOOKMARKS_NATIVE_TREE_TIMEOUT',
  )
}

async function verifyNativeRun(desktop, page, context, id, expected) {
  const errors = []
  const unexpectedNavigations = new Set()
  const observers = new Map()
  let browser, lease, browserContext, result
  const rememberUrl = (url) => {
    if (url && !url.startsWith('chrome://') && !url.startsWith('edge://') && url !== 'about:blank')
      unexpectedNavigations.add(url)
  }
  const observePage = (tab) => {
    if (observers.has(tab)) return
    rememberUrl(tab.url())
    const listener = (frame) => {
      if (frame === tab.mainFrame()) rememberUrl(frame.url())
    }
    observers.set(tab, listener)
    tab.on('framenavigated', listener)
  }
  const assertNoAutomaticNavigation = () => {
    for (const tab of browserContext.pages()) rememberUrl(tab.url())
    assert.equal(unexpectedNavigations.size, 0, 'Default bookmark URLs must never navigate')
    assert.equal(browserContext.pages().length, 1, 'Default bookmarks must not open extra tabs')
  }
  try {
    const started = requireSuccess(
      await page.evaluate(({ context, id }) => window.contextweave.environment.start(context, id), {
        context,
        id,
      }),
      'BOOKMARKS_ENVIRONMENT_START',
    )
    assert.equal(started.status, 'running')
    // Retain the actual Main lease acquired by the existing authenticated connector.
    // Its background disconnect cleanup is not a substitute for our awaited finally.
    browser = await connectManagedBrowser(
      {
        evaluateHandle: async (...args) => {
          lease = await desktop.evaluateHandle(...args)
          return lease
        },
      },
      id,
    )
    assert.equal(browser.contexts().length, 1)
    browserContext = browser.contexts()[0]
    browserContext.on('page', observePage)
    for (const tab of browserContext.pages()) observePage(tab)
    // No test navigation goes to HTTP(S). Also block page requests in this fresh fixture;
    // an attempted bookmark navigation is still a failure even when the request is aborted.
    await browserContext.route(/^https?:\/\//, async (route) => {
      if (route.request().isNavigationRequest()) unexpectedNavigations.add(route.request().url())
      await collectFailure(errors, () => route.abort('blockedbyclient'))
    })
    const tab = await until(() => browserContext.pages()[0], 10000, 'BOOKMARKS_NATIVE_PAGE_MISSING')
    assertNoAutomaticNavigation()
    result = await nativeBookmarks(tab)
    assert.deepEqual(
      result.map(({ title, url }) => ({ name: title, url })),
      expected.map(({ name, url }) => ({ name, url })),
      'The native bookmark tree must contain exactly the ordered template URLs and titles',
    )
    assert.equal(new Set(result.map((node) => node.id)).size, expected.length)
    for (const node of result) {
      assert.equal(typeof node.id, 'string')
      assert(Number.isFinite(node.dateAdded) && node.dateAdded > 0)
    }
    assertNoAutomaticNavigation()
  } catch (error) {
    errors.push(error)
  } finally {
    // Drain request handlers before dropping their CDP transport. Never close the native
    // tab: the supervisor, not a last-window side effect, must confirm the browser stop.
    if (browserContext) {
      await collectFailure(errors, () => browserContext.unrouteAll({ behavior: 'wait' }))
      await collectFailure(errors, assertNoAutomaticNavigation)
      browserContext.off('page', observePage)
      for (const [tab, listener] of observers) tab.off('framenavigated', listener)
    }
    if (lease) await collectFailure(errors, () => lease.evaluate((value) => value.revoke()))
    if (browser) await collectFailure(errors, () => browser.close())
    if (lease) await collectFailure(errors, () => lease.dispose())
    await collectFailure(errors, async () => {
      try {
        const stopped = requireSuccess(
          await page.evaluate(
            ({ context, id }) => window.contextweave.environment.stop(context, id),
            { context, id },
          ),
          'BOOKMARKS_ENVIRONMENT_STOP',
        )
        assert.equal(stopped.status, 'stopped')
      } catch (error) {
        error.preserveSmokeDirectory = true
        throw error
      }
    })
  }
  throwFailures(errors)
  return result
}

export async function verifyDefaultBookmarks(desktop, page) {
  const root = await temporarySmokeRoot(desktop)
  const workspace = requireSuccess(
    await page.evaluate(() => window.contextweave.workspace.current()),
    'BOOKMARKS_WORKSPACE',
  )
  const context = { workspaceId: workspace.workspaceId }
  const readTemplate = async () =>
    requireSuccess(
      await page.evaluate((context) => window.contextweave.bookmarks.get(context), context),
      'BOOKMARKS_TEMPLATE_READ',
    )
  const original = await readTemplate()
  assert.equal(original.workspaceId, context.workspaceId)
  const first = [
    {
      id: randomUUID(),
      name: 'Smoke first — 书签',
      url: 'https://example.invalid/bookmarks/first',
    },
    { id: randomUUID(), name: 'Smoke second', url: 'http://example.invalid/bookmarks/second' },
  ]
  const replacement = [
    { id: randomUUID(), name: 'Smoke replacement', url: 'https://example.invalid/bookmarks/new' },
  ]
  let ownedRevision
  const errors = []
  const saveTemplate = async (expectedRevision, items) => {
    const saved = requireSuccess(
      await page.evaluate(
        ({ context, input }) => window.contextweave.bookmarks.save(context, input),
        { context, input: { expectedRevision, items } },
      ),
      'BOOKMARKS_TEMPLATE_SAVE',
    )
    ownedRevision = saved.revision
    assert.equal(saved.workspaceId, context.workspaceId)
    assert.equal(saved.revision, expectedRevision + 1)
    assert.deepEqual(saved.items, items)
    assert.deepEqual(await readTemplate(), saved)
    return saved
  }
  const createEnvironment = async (name) => {
    const created = requireSuccess(
      await page.evaluate(
        ({ context, name }) =>
          window.contextweave.environment.create(context, {
            name,
            kernelId: 'standard-chromium',
            commonConfig: { language: 'system', timezone: 'system' },
          }),
        { context, name },
      ),
      'BOOKMARKS_ENVIRONMENT_CREATE',
    )
    assert.equal(created.workspaceId, context.workspaceId)
    assert.equal(created.status, 'created')
    assert.match(created.id, /^env-[a-f0-9-]{36}$/)
    return created.id
  }
  try {
    const saved = await saveTemplate(original.revision, first)
    const stale = await page.evaluate(
      ({ context, input }) => window.contextweave.bookmarks.save(context, input),
      { context, input: { expectedRevision: original.revision, items: replacement } },
    )
    assert.equal(stale.ok, false, 'A stale template write must not succeed')
    assert.equal(stale.code, 'BOOKMARKS_CONFLICT')
    assert.deepEqual(await readTemplate(), saved, 'CAS rejection must not change the template')

    const id = await createEnvironment('Default bookmarks smoke — original')
    const initialTree = await verifyNativeRun(desktop, page, context, id, first)
    // The native run has stopped and flushed: compare bytes without racing a browser writer.
    const file = join(root, 'contextweave', 'environments', id, 'Default', 'Bookmarks')
    const before = await readFile(file)
    await saveTemplate(saved.revision, replacement)
    assert.deepEqual(
      await readFile(file),
      before,
      'Template edits must not touch an existing profile',
    )
    assert.deepEqual(
      await verifyNativeRun(desktop, page, context, id, first),
      initialTree,
      'A second native launch must retain the original IDs, titles, URLs and creation times',
    )
    const next = await createEnvironment('Default bookmarks smoke — later template')
    await verifyNativeRun(desktop, page, context, next, replacement)
  } catch (error) {
    errors.push(error)
  } finally {
    if (ownedRevision !== undefined)
      await collectFailure(errors, async () => {
        const restored = requireSuccess(
          await page.evaluate(
            ({ context, input }) => window.contextweave.bookmarks.save(context, input),
            { context, input: { expectedRevision: ownedRevision, items: original.items } },
          ),
          'BOOKMARKS_TEMPLATE_RESTORE',
        )
        assert.equal(restored.revision, ownedRevision + 1)
        assert.deepEqual(restored.items, original.items)
        assert.deepEqual(await readTemplate(), restored)
      })
  }
  throwFailures(errors)
  console.log(
    JSON.stringify({
      defaultBookmarks: 'passed-native-tree-cas-initialize-once-restart-and-later-template',
      nativeReads: 3,
      automaticBookmarkNavigations: 0,
      cleanup: 'awaited-lease-revoke-before-environment-stop-and-cas-template-restore',
    }),
  )
}
