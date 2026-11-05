import { describe, expect, it, vi } from 'vitest'
import type { AppStateStatus } from 'react-native'
import { watchMobileForegroundUpdates } from './mobileForegroundUpdates'
import { createMobileUpdateChannelController } from './mobileUpdateChannel'

function setup() {
  let listener: (state: AppStateStatus) => void = () => {}
  let time = 0
  const remove = vi.fn()
  const source = { currentState: 'active' as AppStateStatus,
    addEventListener: (_event: 'change', next: typeof listener) => { listener = next; return { remove } } }
  const runtime = { available: true, channel: 'stable', updateId: null, setChannel: vi.fn(),
    check: vi.fn(async () => false), fetch: vi.fn(async () => true), reload: vi.fn(async () => {}) }
  const controller = createMobileUpdateChannelController({ runtime, save: async () => true, prepareRestart: async () => () => {} })
  controller.initialize('alpha')
  const stop = watchMobileForegroundUpdates(source, controller, () => time)
  return { runtime, controller, remove, stop, advance: (ms: number) => { time += ms },
    change: (state: AppStateStatus) => listener(state),
    resume: () => { listener('background'); listener('active') } }
}

describe('foreground OTA checks', () => {
  it('lets native launch checking finish, then checks the selected channel without restarting', async () => {
    const f = setup()
    f.resume()
    expect(f.runtime.check).not.toHaveBeenCalled()
    f.advance(60_000)
    f.resume()
    await vi.waitFor(() => expect(f.controller.snapshot().busy).toBe(false))
    expect(f.runtime.check).toHaveBeenCalledOnce()
    expect(f.runtime.setChannel).toHaveBeenLastCalledWith('alpha')
    expect(f.runtime.reload).not.toHaveBeenCalled()
  })

  it('ignores duplicate active notifications and cools down inactive/active transitions', async () => {
    const f = setup()
    f.advance(60_000)
    f.change('active')
    expect(f.runtime.check).not.toHaveBeenCalled()
    f.resume()
    await vi.waitFor(() => expect(f.controller.snapshot().busy).toBe(false))
    f.change('inactive'); f.change('active')
    f.advance(59_999); f.resume()
    expect(f.runtime.check).toHaveBeenCalledOnce()
    f.advance(1); f.resume()
    expect(f.runtime.check).toHaveBeenCalledTimes(2)
  })

  it('does not overlap a download or replace a ready update', async () => {
    const f = setup()
    let finish: (value: boolean) => void = () => {}
    f.runtime.check.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    f.advance(60_000); f.resume()
    f.advance(60_000); f.resume()
    expect(f.runtime.check).toHaveBeenCalledOnce()
    finish(true)
    await vi.waitFor(() => expect(f.controller.snapshot().phase).toBe('ready'))
    f.advance(60_000); f.resume()
    expect(f.runtime.check).toHaveBeenCalledOnce()
    expect(f.runtime.reload).not.toHaveBeenCalled()
  })

  it('keeps offline failures quiet and retries later', async () => {
    const f = setup()
    f.runtime.check.mockRejectedValueOnce(new Error('offline'))
    f.advance(60_000); f.resume()
    await vi.waitFor(() => expect(f.controller.snapshot().phase).toBe('failed'))
    f.advance(60_000); f.resume()
    expect(f.runtime.check).toHaveBeenCalledTimes(2)
    expect(f.runtime.reload).not.toHaveBeenCalled()
    f.stop()
    expect(f.remove).toHaveBeenCalledOnce()
  })
})
