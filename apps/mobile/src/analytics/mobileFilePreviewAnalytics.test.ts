import { expect, it, vi } from 'vitest'
import { createMobileAnalytics } from './mobileAnalytics'

it('mirrors desktop preview categories without sending file identity', () => {
  const send = vi.fn(async () => {})
  const analytics = createMobileAnalytics({ configured: true, createId: () => 'anonymous', platform: 'ios', send })
  analytics.setEnabled(true)
  for (const name of ['file_preview_opened', 'file_preview_failed'] as const) {
    const event = { name, preview_kind: 'pdf' as const, filename: 'private.pdf', uri: 'file:///private.pdf' }
    analytics.capture(event)
    expect(send).toHaveBeenLastCalledWith({
      event: name,
      distinct_id: 'anonymous',
      properties: { $process_person_profile: false, $geoip_disable: true, platform: 'ios', preview_kind: 'pdf' },
    }, expect.any(AbortSignal))
  }
  analytics.setEnabled(false)
})
