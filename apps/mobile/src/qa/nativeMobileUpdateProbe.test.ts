import { afterEach, expect, it, vi } from 'vitest'
import { mobileTelemetryContext } from '../analytics/mobileTelemetryContext'
import { logNativeMobileUpdateProof } from './nativeMobileUpdateProbe'

afterEach(() => vi.restoreAllMocks())

it('logs safe update identity only in the isolated OTA validation channel', () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  const context = mobileTelemetryContext({ platform: 'ios', updates: {
    isEnabled: true, updateId: '34393854-9cc5-44b2-8888-876543210abc', runtimeVersion: 'a'.repeat(40),
    channel: 'ota-validation', isEmbeddedLaunch: true, isEmergencyLaunch: false,
  } })
  logNativeMobileUpdateProof('embedded-a', context)
  expect(log).toHaveBeenCalledOnce()
  expect(log.mock.calls[0]?.[0]).toContain('"marker":"embedded-a"')
  expect(log.mock.calls[0]?.[0]).toContain('"source":"embedded"')
  log.mockClear()
  logNativeMobileUpdateProof('/Users/private/vault', context)
  logNativeMobileUpdateProof({ toString: () => 'embedded-a', private: 'vault' }, context)
  logNativeMobileUpdateProof('embedded-a', { ...context, ota_channel: 'alpha' })
  expect(log).not.toHaveBeenCalled()
})
