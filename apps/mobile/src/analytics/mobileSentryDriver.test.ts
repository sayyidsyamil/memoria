import { expect, it, vi } from 'vitest'
import { createMobileSentryDriver } from './mobileSentryDriver'
import { mobileTelemetryContext } from './mobileTelemetryContext'
import { sanitizeMobileCrash } from './mobileCrashPrivacy'
import type * as SentrySdk from '@sentry/react-native'

const context = { dsn: 'https://public@example.com/1', metadata: mobileTelemetryContext({ platform: 'ios', deviceFamily: 'phone', version: '1.0.0', build: '42' }) }

it('does not load the SDK before consent and cancels a revoked lazy initialization', async () => {
  const sdk = { init: vi.fn(), captureException: vi.fn(() => 'event'), close: vi.fn(async () => {}) }
  const load = vi.fn(async () => sdk)
  const driver = createMobileSentryDriver(context, load)
  expect(load).not.toHaveBeenCalled()
  const starting = driver.start(sanitizeMobileCrash)
  driver.abort()
  await starting
  expect(sdk.init).not.toHaveBeenCalled()
})

it('disables automatic collection and stamps sanitized reports with mobile build metadata', async () => {
  const sdk = { init: vi.fn<typeof SentrySdk.init>(), captureException: vi.fn(() => 'event'), close: vi.fn(async () => {}) }
  const driver = createMobileSentryDriver(context, async () => sdk)
  const stop = await driver.start(sanitizeMobileCrash)
  expect(sdk.init).toHaveBeenCalledWith(expect.objectContaining({ enableNative: false, sendDefaultPii: false,
    maxBreadcrumbs: 0, enableAutoPerformanceTracing: false, enableLogs: false, attachScreenshot: false }))
  driver.capture(new Error('Private note'), 'workspace')
  expect(sdk.captureException).toHaveBeenCalledTimes(1)
  const options = sdk.init.mock.calls[0]?.[0]
  const hint = { attachments: [{ filename: 'private.md', data: 'private note' }] }
  const clean = await options?.beforeSend?.({ type: undefined, exception: { values: [{ type: 'Error', value: 'private note' }] } }, hint)
  expect(clean).toMatchObject({ release: 'memoria-mobile@1.0.0+42', tags: { app_surface: 'mobile', device_family: 'phone' } })
  expect(JSON.stringify(clean)).not.toContain('private note')
  expect(hint.attachments).toEqual([])
  driver.abort()
  await stop()
  expect(sdk.close).toHaveBeenCalledTimes(1)
})
