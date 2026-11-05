import { expect, it, vi } from 'vitest'
import { createMobileAnalytics } from './mobileAnalytics'

it('records filename editor discovery without sending the filename or path', () => {
  const send = vi.fn(async () => {})
  const analytics = createMobileAnalytics({ configured: true, createId: () => 'anonymous', platform: 'ios', send })
  analytics.setEnabled(true)
  const event = {
    name: 'mobile_editor_tool_opened' as const,
    tool: 'filename' as const,
    filename: 'private-note.md',
    path: '/private-vault/private-note.md',
  }
  analytics.capture(event)
  expect(send).toHaveBeenCalledWith({
    event: 'mobile_editor_tool_opened',
    distinct_id: 'anonymous',
    properties: { $process_person_profile: false, $geoip_disable: true, platform: 'ios', tool: 'filename' },
  }, expect.any(AbortSignal))
  analytics.setEnabled(false)
})
