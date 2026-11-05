import { expect, it, vi } from 'vitest'
import { createMobileAnalytics } from './mobileAnalytics'

it('records clone cancellation without a repository URL or note data', () => {
  const send = vi.fn(async () => {})
  const analytics = createMobileAnalytics({ configured: true, createId: () => 'anonymous', platform: 'ios', send })
  analytics.setEnabled(true)
  analytics.capture({ name: 'mobile_git_clone_cancel_requested' })
  expect(send).toHaveBeenCalledWith({ event: 'mobile_git_clone_cancel_requested', distinct_id: 'anonymous',
    properties: { $process_person_profile: false, $geoip_disable: true, platform: 'ios' } }, expect.any(AbortSignal))
  analytics.setEnabled(false)
})
