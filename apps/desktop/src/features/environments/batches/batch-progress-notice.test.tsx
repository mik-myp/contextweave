// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { batchSummarySchema, type BatchSummary } from '@contextweave/contracts'
import { I18nProvider } from '@/i18n'
import { fixtureWorkspace } from '../../../../test-support/workspace'
import { toast } from '@/components/ui/toast'
import { BatchProgressNotice } from './batch-progress-notice'
vi.mock('@/components/ui/toast', () => ({ toast: { add: vi.fn(), close: vi.fn() } }))
const state = vi.hoisted(() => ({
  items: [] as BatchSummary[],
  error: null as Error | null,
  refetch: vi.fn(),
  select: vi.fn(),
}))
vi.mock('./use-batches', () => ({
  useBatchPage: () => ({
    data: { items: state.items },
    error: state.error,
    refetch: state.refetch,
  }),
}))
vi.mock('./batch-tasks', () => ({
  BatchTaskDialog: ({ id }: { id: string }) => <div role="dialog">{id}</div>,
}))
const id = '00000000-0000-4000-8000-000000000010'
function task(status: 'running' | 'completed' | 'interrupted') {
  return batchSummarySchema.parse({
    ...fixtureWorkspace,
    id,
    action: 'start',
    status,
    sourceTaskId: null,
    createdAt: '2026-09-28T00:00:00.000Z',
    endedAt: status === 'running' ? null : '2026-09-28T00:01:00.000Z',
    total: 2,
    counts: {
      queued: 0,
      running: status === 'running' ? 2 : 0,
      succeeded: status === 'completed' ? 2 : 0,
      failed: 0,
      skipped: 0,
      cancelled: 0,
      unknown: status === 'interrupted' ? 2 : 0,
    },
  })
}
let root: Root, container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
  localStorage.clear()
  state.items = []
  state.error = null
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function render(selectedId?: string) {
  await act(async () =>
    root.render(
      <I18nProvider>
        <BatchProgressNotice selectedId={selectedId} onSelect={state.select} />
      </I18nProvider>,
    ),
  )
}
function button(label: string) {
  const result = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === label,
  )
  if (!result) throw new Error('Missing button: ' + label)
  return result
}
it('does not show a permanent task entry or empty state without tasks', async () => {
  await render()
  expect(container.textContent).toBe('')
})
it('rediscovers active progress after navigation, then shows a dismissible result', async () => {
  state.items = [task('running')]
  await render()
  expect(container.textContent).toContain('0 / 2')
  expect(container.textContent).not.toContain('关闭')
  await act(async () => button('查看进度').click())
  expect(state.select).toHaveBeenCalledWith(id)
  state.items = [{ ...task('completed'), endedAt: new Date(Date.now() + 1000).toISOString() }]
  await render()
  expect(container.textContent).toBe('')
  expect(toast.add).toHaveBeenCalledWith(
    expect.objectContaining({
      id: `batch-result-${id}`,
      type: 'success',
      description: expect.stringContaining('成功 2'),
    }),
  )
  await render()
  expect(toast.add).toHaveBeenCalledOnce()
})
it('keeps interrupted results and unknown items available without replaying operations', async () => {
  state.items = [task('interrupted')]
  await render()
  expect(container.textContent).toContain('未知 2')
  await act(async () => button('查看结果').click())
  expect(state.select).toHaveBeenCalledWith(id)
  await render(id)
  expect(container.querySelector('[role="dialog"]')?.textContent).toBe(id)
})
it('shows a retryable read error rather than implying no tasks exist', async () => {
  state.error = new Error('fixture')
  await render()
  expect(container.textContent).toContain('不要重复提交')
  await act(async () => button('重试').click())
  expect(state.refetch).toHaveBeenCalledOnce()
})

it('keeps old successful history out of the environment page', async () => {
  state.items = [{ ...task('completed'), endedAt: '2020-01-01T00:00:00.000Z' }]
  await render()
  expect(container.textContent).toBe('')
})

it('notifies partial failure once and provides an actionable result without automatic retries', async () => {
  state.items = [task('running')]
  await render()
  state.items = [
    { ...task('completed'), counts: { ...task('completed').counts, succeeded: 1, failed: 1 } },
  ]
  await render()
  expect(toast.add).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'error',
      timeout: 0,
      actionProps: expect.objectContaining({ children: '查看结果' }),
    }),
  )
  await render()
  expect(toast.add).toHaveBeenCalledOnce()
  expect(state.select).not.toHaveBeenCalled()
})
