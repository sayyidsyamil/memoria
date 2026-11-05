import { expect, it, vi } from 'vitest'
import { createMobileCrashReporting, type MobileCrashDriver } from './mobileCrashReporting'

function fixture() {
  const close = vi.fn(async () => {})
  const start = vi.fn<MobileCrashDriver['start']>(() => close)
  const capture = vi.fn()
  const abort = vi.fn()
  const reporting = createMobileCrashReporting({ configured: true, driver: { start, capture, abort } })
  return { reporting, start, close, capture, abort }
}

it('does not initialize or send before explicit crash consent', async () => {
  const { reporting, start, capture } = fixture()
  reporting.capture(new Error('secret'), 'workspace')
  await reporting.setEnabled(false)
  expect(start).not.toHaveBeenCalled()
  expect(capture).not.toHaveBeenCalled()
})

it('revokes immediately, drops queued events and serializes reinitialization after close', async () => {
  const { reporting, start, close, capture, abort } = fixture()
  await reporting.setEnabled(true)
  const beforeSend = start.mock.calls[0]?.[0]
  expect(beforeSend?.({ type: undefined, exception: { values: [{ type: 'Error', value: 'secret' }] } })).not.toBeNull()
  reporting.capture(new Error('secret'), 'workspace')
  expect(capture).toHaveBeenCalledTimes(1)
  const stopped = reporting.setEnabled(false)
  expect(abort).toHaveBeenCalled()
  expect(beforeSend?.({ type: undefined, exception: { values: [{ type: 'Error' }] } })).toBeNull()
  reporting.capture(new Error('secret'), 'workspace')
  expect(capture).toHaveBeenCalledTimes(1)
  await stopped
  await reporting.setEnabled(true)
  expect(close).toHaveBeenCalledTimes(1)
  expect(start).toHaveBeenCalledTimes(2)
  await reporting.setEnabled(false)
})

it('never initializes missing configuration and tolerates driver failures', async () => {
  const start = vi.fn(() => { throw new Error('unavailable') })
  const driver = { start, capture: vi.fn(), abort: vi.fn() }
  const disabled = createMobileCrashReporting({ configured: false, driver })
  await disabled.setEnabled(true)
  expect(start).not.toHaveBeenCalled()
  driver.abort.mockClear()
  const enabled = createMobileCrashReporting({ configured: true, driver })
  await expect(enabled.setEnabled(true)).resolves.toBeUndefined()
  expect(driver.abort).toHaveBeenCalledTimes(1)
  enabled.capture(new Error('secret'), 'workspace')
  expect(driver.capture).not.toHaveBeenCalled()
})
