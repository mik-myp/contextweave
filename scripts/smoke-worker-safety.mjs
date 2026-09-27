import { writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'

// This runs against the actual Electron utility child, not a Node IPC mock. The
// marker can only be created if the child inherits and evaluates NODE_OPTIONS.
export async function runWorkerWithHostileEnvironment(desktop, page, task, directory) {
  const marker = join(directory, 'worker-injection-marker')
  const modulePath = join(directory, 'worker-injection-probe.cjs')
  await writeFile(
    modulePath,
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'injected')\n`,
  )
  const injected = {
    NODE_OPTIONS: `--require ${JSON.stringify(modulePath)}`,
    NODE_PATH: directory,
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_NO_ASAR: '1',
  }
  const previous = await desktop.evaluate((_electron, injected) => {
    const previous = {}
    for (const [key, value] of Object.entries(injected)) {
      previous[key] = process.env[key] ?? null
      process.env[key] = value
    }
    return previous
  }, injected)
  try {
    const result = await page.evaluate(async (task) => window.contextweave.worker.runSmoke({ workspaceId: (await window.contextweave.workspace.current()).data.workspaceId }, task), task)
    const markerExists = await access(marker).then(
      () => true,
      () => false,
    )
    assert.equal(markerExists, false, 'Worker must not evaluate host-injected Node code')
    await assertUtilityWorkersExited(desktop, result)
    return result
  } finally {
    await desktop.evaluate((_electron, previous) => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === null) delete process.env[key]
        else process.env[key] = value
      }
    }, previous)
  }
}

// App metrics may retain an exited entry briefly. Require OS non-existence, not
// a particular telemetry update ordering; permission errors remain failures.
export async function assertUtilityWorkersExited(desktop, outcome) {
  const utilityEvidence = await desktop.evaluate(({ app }) =>
    app
      .getAppMetrics()
      .filter((entry) => entry.name === 'ContextWeave Worker')
      .map((entry) => {
        let alive = true
        try {
          process.kill(entry.pid, 0)
        } catch (error) {
          alive = error?.code !== 'ESRCH'
        }
        return { pid: entry.pid, name: entry.name, type: entry.type, alive }
      }),
  )
  assert(
    !utilityEvidence.some((entry) => entry.alive),
    JSON.stringify({
      message: 'Main must wait for OS-confirmed utility exit before returning a completed task',
      outcome: outcome?.ok ? { ok: true, taskOk: outcome.data.ok } : outcome,
      utilityEvidence,
    }),
  )
}

// Cancelling a utility client detaches that client, not the browser's already-sent
// navigation. Finish the owned HTTP fixture and observe its commit/load before a
// separate client navigates the same page again.
export async function finishCancelledNavigation(context, url, release) {
  let timer
  const listeners = new Map()
  try {
    const committed = new Promise((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('Cancelled fixture navigation did not settle')),
        10000,
      )
      for (const page of context.pages()) {
        const onNavigation = (frame) => {
          if (frame === page.mainFrame() && frame.url() === url) resolve(page)
        }
        listeners.set(page, onNavigation)
        page.on('framenavigated', onNavigation)
        onNavigation(page.mainFrame())
      }
    })
    release()
    const page = await committed
    await page.waitForLoadState('load', { timeout: 10000 })
  } finally {
    clearTimeout(timer)
    for (const [page, listener] of listeners) page.off('framenavigated', listener)
  }
}
