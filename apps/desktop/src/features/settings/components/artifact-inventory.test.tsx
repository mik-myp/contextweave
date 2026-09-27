// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { ArtifactPage, ArtifactQuery, IpcResult } from '@contextweave/contracts'
import { I18nProvider } from '@/i18n'
import { ArtifactInventory } from './artifact-inventory'

const call = vi.fn<(input: Partial<ArtifactQuery>) => Promise<IpcResult<ArtifactPage>>>()
const id = '776c5484-731d-4d25-82d4-3a388986a125'
const next = { artifactId: id, completedAt: '2026-09-27T00:00:00.000Z', side: 'next' as const }
const item = {
  artifactId: id,
  environmentId: 'env',
  environmentName: '<script>Owned</script>',
  taskId: 'repeatable',
  bytes: 2048,
  sha256: 'a'.repeat(64),
  completedAt: next.completedAt,
}
const empty: ArtifactPage = {
  items: [],
  totals: { count: 0, bytes: 0 },
  previousCursor: null,
  nextCursor: null,
}
const first: ArtifactPage = {
  items: [item],
  totals: { count: 2, bytes: 4096 },
  previousCursor: null,
  nextCursor: next,
}
const second: ArtifactPage = {
  ...first,
  items: [{ ...item, artifactId: '976c5484-731d-4d25-82d4-3a388986a125', taskId: 'older-task' }],
  previousCursor: { ...next, side: 'previous' },
  nextCursor: null,
}
let root: Root, container: HTMLDivElement, client: QueryClient
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('contextweave', { storage: { pageArtifacts: call } })
  localStorage.clear()
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  call.mockReset()
  call.mockResolvedValue({ ok: true, data: empty })
})
afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  container.remove()
  vi.unstubAllGlobals()
})
const button = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === name)!
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}
async function render() {
  await act(async () =>
    root.render(
      <I18nProvider>
        <QueryClientProvider client={client}>
          <ArtifactInventory />
        </QueryClientProvider>
      </I18nProvider>,
    ),
  )
  await flush()
}
async function click(name: string) {
  await act(async () => button(name).click())
  await flush()
}
function deferred() {
  let resolve!: (result: IpcResult<ArtifactPage>) => void
  const promise = new Promise<IpcResult<ArtifactPage>>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
it('renders loading, explicit registered-only caveats and an empty read-only state', async () => {
  const pending = deferred()
  call.mockReturnValueOnce(pending.promise)
  await render()
  expect(container.querySelector('section')?.getAttribute('aria-busy')).toBe('true')
  expect(button('刷新').disabled).toBe(true)
  await act(async () => pending.resolve({ ok: true, data: empty }))
  await flush()
  expect(container.textContent).toContain('本页没有已登记截图')
  expect(container.textContent).toContain('不是全盘用量')
  expect(container.textContent).toContain('不代表当前文件仍然存在')
  expect(container.querySelectorAll('button')).toHaveLength(3)
  expect(button('下一页').disabled).toBe(true)
  expect(call).toHaveBeenCalledWith({ limit: 20, cursor: null })
})
it('shows escaped identifiers, exact registered byte totals and controlled next/previous pages', async () => {
  call
    .mockResolvedValueOnce({ ok: true, data: first })
    .mockResolvedValueOnce({ ok: true, data: second })
  await render()
  expect(container.textContent).toContain('4,096')
  expect(container.textContent).toContain(item.sha256)
  expect(container.querySelector('script')).toBeNull()
  expect(button('上一页').disabled).toBe(true)
  await click('下一页')
  expect(call).toHaveBeenLastCalledWith({ limit: 20, cursor: next })
  expect(container.textContent).toContain('older-task')
  expect(button('下一页').disabled).toBe(true)
  call.mockResolvedValueOnce({ ok: true, data: first })
  await click('上一页')
  expect(call).toHaveBeenLastCalledWith({ limit: 20, cursor: second.previousCursor })
  expect(container.textContent).not.toContain('older-task')
})
it('drops old contents after failed revalidation and offers an explicit retry', async () => {
  call.mockResolvedValueOnce({ ok: true, data: first })
  await render()
  call.mockResolvedValueOnce({ ok: false, code: 'ARTIFACT_RECORD_INVALID', message: 'internal' })
  await click('刷新')
  expect(container.textContent).not.toContain(item.sha256)
  expect(container.textContent).toContain('产物记录无法安全读取')
  call.mockResolvedValueOnce({ ok: true, data: empty })
  await click('重试')
  expect(container.textContent).toContain('本页没有已登记截图')
})
it('ignores a late next-page response after returning to the first page', async () => {
  const pending = deferred()
  call.mockResolvedValueOnce({ ok: true, data: first }).mockReturnValueOnce(pending.promise)
  await render()
  await click('下一页')
  call.mockResolvedValueOnce({ ok: true, data: first })
  await click('返回首段')
  await act(async () => pending.resolve({ ok: true, data: second }))
  await flush()
  expect(container.textContent).toContain('repeatable')
  expect(container.textContent).not.toContain('older-task')
})
it('refreshes through the storage data domain without retaining stale capacity', async () => {
  await render()
  call.mockResolvedValue({ ok: true, data: first })
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['local', 'storage'] })
  })
  await flush()
  expect(container.textContent).toContain('4,096')
  expect(container.textContent).toContain(item.artifactId)
})
it('reports transport loss and stays safe after unmount with a request in flight', async () => {
  call.mockRejectedValueOnce(new Error('untrusted response'))
  await render()
  expect(container.textContent).not.toContain('untrusted response')
  expect(button('重试')).toBeTruthy()
  const pending = deferred()
  call.mockReturnValueOnce(pending.promise)
  await click('重试')
  await act(async () => root.render(null))
  await act(async () => pending.resolve({ ok: true, data: first }))
  await flush()
  expect(container.textContent).toBe('')
})
