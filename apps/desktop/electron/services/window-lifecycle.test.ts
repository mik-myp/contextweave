import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createWindowLifecycle } from './window-lifecycle'
class Window extends EventEmitter {
  destroyed = false
  minimized = false
  isDestroyed = () => this.destroyed
  isMinimized = () => this.minimized
  restore = vi.fn(() => {
    this.minimized = false
  })
  show = vi.fn(() => {
    if (this.destroyed) throw new Error('Object destroyed')
  })
  focus = vi.fn()
  destroy = vi.fn(() => {
    this.destroyed = true
    this.emit('closed')
  })
}
function fixture() {
  const instances: Window[] = []
  const failures: ((error: unknown) => void)[] = []
  const failed = vi.fn()
  const lifecycle = createWindowLifecycle({
    create: () => {
      const window = new Window()
      instances.push(window)
      return window
    },
    load: () => new Promise((_resolve, reject) => failures.push(reject)),
    failed,
  })
  return { lifecycle, instances, failures, failed }
}
describe('main window lifecycle', () => {
  it('defers activation/second-instance until initialized and restores minimized windows', () => {
    const f = fixture()
    f.lifecycle.show()
    f.lifecycle.show()
    expect(f.instances).toHaveLength(0)
    f.lifecycle.ready()
    const window = f.instances[0]!
    window.emit('ready-to-show')
    window.minimized = true
    f.lifecycle.show()
    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledTimes(2)
    expect(f.instances).toHaveLength(1)
  })
  it('recreates a closed window for second-instance without touching the destroyed object', () => {
    const f = fixture()
    f.lifecycle.ready()
    const old = f.instances[0]!
    old.destroy()
    expect(f.lifecycle.get()).toBeUndefined()
    f.lifecycle.show()
    const next = f.instances[1]!
    old.emit('ready-to-show')
    old.emit('closed')
    expect(next.show).not.toHaveBeenCalled()
    expect(f.lifecycle.get()).toBe(next)
    next.emit('ready-to-show')
    expect(next.show).toHaveBeenCalledOnce()
    expect(old.show).not.toHaveBeenCalled()
  })
  it('ignores stale load failures but reports current failures', async () => {
    const f = fixture()
    f.lifecycle.ready()
    f.instances[0]!.destroy()
    f.lifecycle.show()
    f.failures[0]!(new Error('stale'))
    await Promise.resolve()
    await new Promise(setImmediate)
    expect(f.failed).not.toHaveBeenCalled()
    const error = new Error('current')
    f.failures[1]!(error)
    await Promise.resolve()
    await new Promise(setImmediate)
    expect(f.failed).toHaveBeenCalledWith(error)
  })
  it('does not mistake an intentional close during navigation for a startup failure', async () => {
    const f = fixture()
    f.lifecycle.ready()
    f.failures[0]!(new Error('navigation cancelled while closing'))
    await Promise.resolve()
    f.instances[0]!.destroy()
    f.lifecycle.show()
    await new Promise(setImmediate)
    expect(f.failed).not.toHaveBeenCalled()
    expect(f.instances).toHaveLength(2)
  })
  it('reports creation errors from activation without throwing from an Electron event', () => {
    const failed = vi.fn()
    const lifecycle = createWindowLifecycle({
      create: () => {
        throw new Error('no window')
      },
      load: async () => {},
      failed,
    })
    expect(() => lifecycle.ready()).not.toThrow()
    expect(failed).toHaveBeenCalledOnce()
  })
  it('does not show or create windows while quitting or recovering', () => {
    const f = fixture()
    f.lifecycle.ready()
    f.lifecycle.stop()
    f.instances[0]!.emit('ready-to-show')
    f.lifecycle.show()
    f.lifecycle.ready()
    expect(f.instances[0]!.show).not.toHaveBeenCalled()
    f.lifecycle.destroy()
    f.lifecycle.show()
    expect(f.lifecycle.get()).toBeUndefined()
    expect(f.instances).toHaveLength(1)
  })
})
