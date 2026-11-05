import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMobileUpdateChannelController } from './mobileUpdateChannel'

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-21T19:00:00Z')) })
afterEach(() => vi.useRealTimers())

function setup() {
  const runtime = { available: true, channel: 'alpha', updateId: 'running', setChannel: vi.fn(),
    check: vi.fn(async () => false), fetch: vi.fn(async () => true), reload: vi.fn(async () => {}) }
  const controller = createMobileUpdateChannelController({ runtime, save: async () => true, prepareRestart: async () => () => {} })
  return { controller, runtime }
}

it('starts with no successful check instead of implying freshness', () => {
  const { controller } = setup()
  expect(controller.snapshot()).toMatchObject({ selected: 'stable', phase: 'idle', checkedAt: null })
})

it('records the selected-channel check without relying on the native build channel', async () => {
  const { controller, runtime } = setup()
  await controller.check()
  expect(runtime.setChannel).toHaveBeenLastCalledWith('stable')
  expect(controller.snapshot()).toMatchObject({ selected: 'stable', phase: 'current', checkedAt: Date.now() })
  expect(runtime.reload).not.toHaveBeenCalled()
})

it('does not stamp an offline attempt as a successful check', async () => {
  const { controller, runtime } = setup()
  runtime.check.mockRejectedValueOnce(new Error('offline'))
  await controller.check()
  expect(controller.snapshot()).toMatchObject({ phase: 'failed', checkedAt: null })
})

it('preserves the previous successful check when a later request fails', async () => {
  const { controller, runtime } = setup()
  await controller.check()
  const checkedAt = Date.now()
  vi.setSystemTime(checkedAt + 120_000)
  runtime.check.mockRejectedValueOnce(new Error('offline'))
  await controller.check()
  expect(controller.snapshot()).toMatchObject({ phase: 'failed', checkedAt })
})

it('invalidates freshness when the selected channel changes outside a request', async () => {
  const { controller } = setup()
  await controller.check()
  controller.initialize('alpha')
  expect(controller.snapshot()).toMatchObject({ selected: 'alpha', phase: 'idle', checkedAt: null })
})

it('does not erase a ready download when reapplying the same preference', async () => {
  const { controller, runtime } = setup()
  runtime.check.mockResolvedValueOnce(true)
  await controller.select('alpha')
  controller.initialize('alpha')
  expect(controller.snapshot()).toMatchObject({ phase: 'ready', checkedAt: Date.now() })
  expect(runtime.reload).not.toHaveBeenCalled()
})
