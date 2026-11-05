import { describe, expect, it, vi } from 'vitest'
import { createMobileUpdateChannelController } from './mobileUpdateChannel'
import type { MobileUpdateRuntime } from './mobileUpdateChannel.types'

function setup(overrides: Partial<MobileUpdateRuntime> = {}) {
  const runtime = { available: true, channel: 'alpha', updateId: 'old', setChannel: vi.fn(),
    check: vi.fn(async () => true), fetch: vi.fn(async () => true), reload: vi.fn(async () => {}), ...overrides }
  const resume = vi.fn()
  const save = vi.fn(async () => true)
  const prepareRestart = vi.fn(async () => resume)
  return { runtime, save, resume, prepareRestart,
    controller: createMobileUpdateChannelController({ runtime, save, prepareRestart }) }
}

describe('mobile OTA channel selection', () => {
  it('initializes Stable without restarting or checking while the user edits', () => {
    const { controller, runtime } = setup()
    controller.initialize('stable')
    expect(runtime.setChannel).toHaveBeenCalledWith('stable')
    expect(runtime.check).not.toHaveBeenCalled()
    expect(runtime.reload).not.toHaveBeenCalled()
    expect(controller.snapshot()).toMatchObject({ selected: 'stable', phase: 'idle' })
  })

  it('persists Alpha opt-in, downloads and only restarts after saving the editor', async () => {
    const { controller, runtime, prepareRestart, resume, save } = setup()
    await controller.select('alpha')
    expect(save).toHaveBeenCalledWith('alpha')
    expect(controller.snapshot()).toMatchObject({ selected: 'alpha', phase: 'ready' })
    expect(runtime.reload).not.toHaveBeenCalled()
    await controller.restart()
    expect(prepareRestart).toHaveBeenCalledOnce()
    expect(runtime.reload).toHaveBeenCalledOnce()
    expect(prepareRestart.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(runtime.reload).mock.invocationCallOrder[0])
    expect(resume).toHaveBeenCalledOnce()
  })

  it('does not reload when saving edits fails', async () => {
    const { controller, runtime, prepareRestart } = setup()
    await controller.select('stable')
    prepareRestart.mockRejectedValueOnce(new Error('disk full'))
    await controller.restart()
    expect(runtime.reload).not.toHaveBeenCalled()
    expect(controller.snapshot().phase).toBe('failed')
  })

  it('keeps the choice on offline failure and permits retry without a restart', async () => {
    const { controller, runtime } = setup()
    vi.mocked(runtime.check).mockRejectedValueOnce(new Error('offline'))
    await controller.select('stable')
    expect(controller.snapshot()).toMatchObject({ selected: 'stable', phase: 'failed', busy: false })
    await controller.check()
    expect(controller.snapshot().phase).toBe('ready')
    expect(runtime.reload).not.toHaveBeenCalled()
  })

  it('does not treat a missing compatible update or failed download as ready', async () => {
    const missing = setup({ check: vi.fn(async () => false) })
    await missing.controller.select('stable')
    expect(missing.controller.snapshot().phase).toBe('current')
    await missing.controller.restart()
    expect(missing.runtime.reload).not.toHaveBeenCalled()
    const failed = setup({ fetch: vi.fn(async () => false) })
    await failed.controller.select('stable')
    expect(failed.controller.snapshot().phase).toBe('failed')
  })

  it('does not change routing if preference persistence fails', async () => {
    const { controller, runtime, save } = setup()
    save.mockResolvedValueOnce(false)
    await controller.select('alpha')
    expect(runtime.setChannel).not.toHaveBeenCalled()
    expect(controller.snapshot()).toMatchObject({ selected: 'stable', phase: 'failed' })
  })

  it('serializes selection and refuses unsupported developer builds', async () => {
    let finish = () => {}
    const deferred = new Promise<boolean>(resolve => { finish = () => resolve(true) })
    const { controller, save } = setup({ check: vi.fn(() => deferred) })
    const first = controller.select('alpha')
    await Promise.resolve()
    await controller.select('stable')
    finish()
    await first
    expect(save).toHaveBeenCalledOnce()
    const disabled = setup({ available: false })
    await disabled.controller.select('alpha')
    expect(disabled.save).not.toHaveBeenCalled()
  })
})
