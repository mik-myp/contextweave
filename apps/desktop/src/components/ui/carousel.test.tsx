// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from './carousel'

const { engine, state, listeners } = vi.hoisted(() => {
  const state = { previous: false, next: true }
  const listeners = new Map<string, Set<() => void>>()
  const engine = {
    canScrollPrev: () => state.previous,
    canScrollNext: () => state.next,
    scrollPrev: vi.fn(),
    scrollNext: vi.fn(),
    on: vi.fn((event: string, listener: () => void) => {
      const bucket = listeners.get(event) ?? new Set<() => void>()
      bucket.add(listener)
      listeners.set(event, bucket)
    }),
    off: vi.fn((event: string, listener: () => void) => {
      listeners.get(event)?.delete(listener)
    }),
  }
  return { engine, state, listeners }
})
vi.mock('embla-carousel-react', () => ({ default: () => [() => {}, engine] }))
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  state.previous = false
  state.next = true
  listeners.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
function Fixture({
  direction = 'ltr',
  orientation = 'horizontal',
}: {
  direction?: 'ltr' | 'rtl'
  orientation?: 'horizontal' | 'vertical'
}) {
  return (
    <Carousel dir={direction} orientation={orientation}>
      <CarouselContent>
        <CarouselItem>One</CarouselItem>
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  )
}
const previous = () =>
  container.querySelector<HTMLButtonElement>('[data-slot="carousel-previous"]')!
const next = () => container.querySelector<HTMLButtonElement>('[data-slot="carousel-next"]')!
it('updates disabled controls from selection and reinitialization snapshots', async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <Fixture />
      </StrictMode>,
    ),
  )
  expect(previous().disabled).toBe(true)
  expect(next().disabled).toBe(false)
  await act(async () => next().click())
  expect(engine.scrollNext).toHaveBeenCalledOnce()
  await act(async () => {
    state.previous = true
    listeners.get('select')?.forEach((listener) => listener())
  })
  expect(previous().disabled).toBe(false)
  await act(async () => {
    state.next = false
    listeners.get('reInit')?.forEach((listener) => listener())
  })
  expect(next().disabled).toBe(true)
  await act(async () => previous().click())
  expect(engine.scrollPrev).toHaveBeenCalledOnce()
})
it('removes both event listeners on unmount without accumulating StrictMode subscriptions', async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <Fixture />
      </StrictMode>,
    ),
  )
  expect(listeners.get('select')?.size).toBe(1)
  expect(listeners.get('reInit')?.size).toBe(1)
  await act(async () => root.render(null))
  expect(listeners.get('select')?.size).toBe(0)
  expect(listeners.get('reInit')?.size).toBe(0)
})
it('preserves RTL and vertical keyboard navigation', async () => {
  await act(async () => root.render(<Fixture direction="rtl" />))
  const sendKey = async (key: string) =>
    act(async () => {
      container
        .querySelector('[data-slot="carousel"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    })
  await sendKey('ArrowRight')
  expect(engine.scrollPrev).toHaveBeenCalledOnce()
  await sendKey('ArrowLeft')
  expect(engine.scrollNext).toHaveBeenCalledOnce()
  await act(async () => root.render(<Fixture orientation="vertical" />))
  await sendKey('ArrowUp')
  await sendKey('ArrowDown')
  expect(engine.scrollPrev).toHaveBeenCalledTimes(2)
  expect(engine.scrollNext).toHaveBeenCalledTimes(2)
})
