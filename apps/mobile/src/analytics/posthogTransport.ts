import type { MobileAnalyticsBody } from './mobileAnalytics'

type EventFetcher = (url: string, options: RequestInit) => Promise<{ ok: boolean }>

export function mobileAnalyticsEndpoint(key: string, host: string | undefined): string | null {
  if (!key.trim()) return null
  try {
    if (!host) return null
    const url = new URL(host)
    if (!isCaptureOrigin(url)) return null
    return `${url.origin}/i/v0/e/`
  } catch { return null }
}

function isCaptureOrigin(url: URL): boolean {
  return url.protocol === 'https:' && url.pathname === '/'
    && ![url.username, url.password, url.search, url.hash].some(Boolean)
}

export function posthogSender(endpoint: string, key: string, fetcher: EventFetcher = fetch) {
  return async (body: MobileAnalyticsBody, signal: AbortSignal) => {
    const response = await fetcher(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'omit', signal, body: JSON.stringify({ ...body, api_key: key }),
    })
    if (!response.ok) throw new Error('Analytics request failed')
  }
}
