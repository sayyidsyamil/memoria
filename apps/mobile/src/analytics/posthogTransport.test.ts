import { describe, expect, it, vi } from 'vitest'
import { mobileAnalyticsEndpoint, posthogSender } from './posthogTransport'

describe('mobile event transport', () => {
  it('requires a project token and an HTTPS origin without credentials', () => {
    expect(mobileAnalyticsEndpoint('', undefined)).toBeNull()
    expect(mobileAnalyticsEndpoint('public-project', 'http://example.com')).toBeNull()
    expect(mobileAnalyticsEndpoint('public-project', 'https://name:password@example.com')).toBeNull()
    expect(mobileAnalyticsEndpoint('public-project', 'https://example.com/?token=x')).toBeNull()
    expect(mobileAnalyticsEndpoint('public-project', undefined)).toBeNull()
    expect(mobileAnalyticsEndpoint('public-project', 'https://us.i.posthog.com')).toBe('https://us.i.posthog.com/i/v0/e/')
  })

  it('uses an explicitly configured ingestion origin and omits cookies', async () => {
    const fetcher = vi.fn(async () => ({ ok: true }))
    const send = posthogSender('https://us.i.posthog.com/i/v0/e/', 'public-project', fetcher)
    const signal = new AbortController().signal
    const body = { event: 'mobile_setting_changed' as const, distinct_id: 'random', properties: { setting: 'theme' } }
    await send(body, signal)
    expect(fetcher).toHaveBeenCalledWith('https://us.i.posthog.com/i/v0/e/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'omit', signal, body: JSON.stringify({ ...body, api_key: 'public-project' }),
    })
  })
})
