// @vitest-environment jsdom
import { act, StrictMode, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useIsMobile } from './use-mobile'

let root: Root
let container: HTMLDivElement
let media: EventTarget
const committed: boolean[] = []
function Fixture() {
  const mobile = useIsMobile()
  useLayoutEffect(() => {
    committed.push(mobile)
  }, [mobile])
  return <output>{mobile ? 'mobile' : 'desktop'}</output>
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  committed.length = 0
  media = new EventTarget()
  vi.spyOn(media, 'addEventListener')
  vi.spyOn(media, 'removeEventListener')
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media),
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it('commits the current mobile snapshot immediately and responds at the exact breakpoint', async () => {
  vi.stubGlobal('innerWidth', 767)
  await act(async () =>
    root.render(
      <StrictMode>
        <Fixture />
      </StrictMode>,
    ),
  )
  expect(committed[0]).toBe(true)
  expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 767px)')
  await act(async () => {
    vi.stubGlobal('innerWidth', 768)
    media.dispatchEvent(new Event('change'))
  })
  expect(container.textContent).toBe('desktop')
  await act(async () => {
    vi.stubGlobal('innerWidth', 640)
    media.dispatchEvent(new Event('change'))
  })
  expect(container.textContent).toBe('mobile')
})
it('unsubscribes every listener across StrictMode replay and unmount', async () => {
  vi.stubGlobal('innerWidth', 1200)
  await act(async () =>
    root.render(
      <StrictMode>
        <Fixture />
      </StrictMode>,
    ),
  )
  expect(container.textContent).toBe('desktop')
  await act(async () => root.render(null))
  expect(media.removeEventListener).toHaveBeenCalledTimes(
    vi.mocked(media.addEventListener).mock.calls.length,
  )
  for (const [type, listener] of vi.mocked(media.addEventListener).mock.calls) {
    expect(media.removeEventListener).toHaveBeenCalledWith(type, listener)
  }
})
