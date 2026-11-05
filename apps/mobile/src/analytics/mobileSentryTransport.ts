import { createTransport, type Transport, type BaseTransportOptions } from '@sentry/core'

type Fetcher = (url: string, init: RequestInit) => Promise<Response>

export function createMobileSentryTransport(fetcher: Fetcher = fetch) {
  let generation = 0
  let enabled = false
  const requests = new Set<AbortController>()
  const abort = () => {
    enabled = false
    generation += 1
    for (const request of requests) request.abort()
    requests.clear()
  }
  const activate = () => { enabled = true }
  const transport = (options: BaseTransportOptions & { url: string }): Transport => {
    const lease = generation
    return createTransport({ ...options, bufferSize: 8 }, async request => {
      if (!enabled || lease !== generation) return { statusCode: 200 }
      const controller = new AbortController()
      requests.add(controller)
      const timeout = setTimeout(() => controller.abort(), 5_000)
      try {
        const response = await fetcher(options.url, {
          method: 'POST', body: typeof request.body === 'string' ? request.body : new Uint8Array(request.body).buffer,
          credentials: 'omit', signal: controller.signal,
          headers: { 'Content-Type': 'application/x-sentry-envelope' },
        })
        return { statusCode: response.status, headers: {
          'x-sentry-rate-limits': response.headers.get('x-sentry-rate-limits'),
          'retry-after': response.headers.get('retry-after'),
        } }
      } finally { clearTimeout(timeout); requests.delete(controller) }
    })
  }
  return { activate, abort, transport }
}
