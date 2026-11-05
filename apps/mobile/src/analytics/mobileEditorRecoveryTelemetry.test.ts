import { expect, it, vi } from 'vitest'
import { createMobileAnalytics } from './mobileAnalytics'

it('reports editor process recovery only with opt-in and fixed non-content metadata', () => {
  const send = vi.fn().mockResolvedValue(undefined)
  const analytics = createMobileAnalytics({ configured: true, platform: 'ios', createId: () => 'anonymous', send })
  const event = { name: 'mobile_editor_recovery_requested', reason: 'contentProcessTerminated', content: 'private note', path: 'secret.md' } as const
  analytics.capture(event)
  expect(send).not.toHaveBeenCalled()
  analytics.setEnabled(true)
  analytics.capture(event)
  expect(send).toHaveBeenCalledWith({
    event: 'mobile_editor_recovery_requested', distinct_id: 'anonymous',
    properties: { $process_person_profile: false, $geoip_disable: true, platform: 'ios', reason: 'contentProcessTerminated' },
  }, expect.any(AbortSignal))
  analytics.setEnabled(false)
})
