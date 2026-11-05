import { expect, it, vi } from 'vitest'
import { combineMobileCrashDrivers } from './mobileCombinedCrashDriver'
import { sanitizeMobileCrash } from './mobileCrashPrivacy'

function fixture() {
  const close = vi.fn(async () => {})
  const javascript = { start: vi.fn(async () => close), abort: vi.fn(), capture: vi.fn() }
  const native = { start: vi.fn(), stop: vi.fn() }
  return { close, javascript, native, driver: combineMobileCrashDrivers(javascript, native) }
}

it('starts native reporting only after consent and stops both transports immediately on revocation', async () => {
  const { driver, native, javascript, close } = fixture()
  expect(native.start).not.toHaveBeenCalled()
  const stop = await driver.start(sanitizeMobileCrash)
  expect(native.start).toHaveBeenCalledOnce()
  driver.abort()
  expect(native.stop).toHaveBeenCalledOnce()
  expect(javascript.abort).toHaveBeenCalledOnce()
  await stop()
  expect(close).toHaveBeenCalledOnce()
})

it('never starts native reporting after an interrupted JavaScript initialization', async () => {
  const { driver, native, close } = fixture()
  const starting = driver.start(sanitizeMobileCrash)
  driver.abort()
  await starting
  expect(native.start).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledOnce()
})

it('rolls back JavaScript reporting if the native driver cannot start', async () => {
  const { driver, native, javascript, close } = fixture()
  native.start.mockImplementation(() => { throw new Error('native unavailable') })
  await expect(driver.start(sanitizeMobileCrash)).rejects.toThrow('native unavailable')
  expect(native.stop).toHaveBeenCalledOnce()
  expect(javascript.abort).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledOnce()
})
