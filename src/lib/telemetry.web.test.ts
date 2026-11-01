import { afterEach, describe, it, expect, vi } from 'vitest'

const sentryMocks = vi.hoisted(() => ({
  close: vi.fn(),
  init: vi.fn(),
  setTag: vi.fn(),
  setUser: vi.fn(),
}))

vi.mock('@sentry/react', () => sentryMocks)

import { initSentry, teardownSentry } from './telemetry'

afterEach(() => {
  teardownSentry()
  vi.unstubAllEnvs()
  sentryMocks.init.mockClear()
  sentryMocks.setTag.mockClear()
  sentryMocks.setUser.mockClear()
})

describe('initSentry in the web build (TOL-232)', () => {
  const WEB_RELEASE = 'memoria-web@0123456789abcdef0123456789abcdef01234567'

  function initWebSentry() {
    vi.stubEnv('VITE_MEMORIA_WEB_BUILD', 'true')
    vi.stubEnv('VITE_SENTRY_DSN', 'http://public@127.0.0.1:48230/1')
    vi.stubEnv('VITE_SENTRY_RELEASE', WEB_RELEASE)
    initSentry('anonymous-user')
    return sentryMocks.init.mock.calls[0]?.[0]
  }

  it('tags web events and names the commit release', () => {
    const options = initWebSentry()

    expect(options).toEqual(expect.objectContaining({
      dsn: 'http://public@127.0.0.1:48230/1',
      release: WEB_RELEASE,
      sendDefaultPii: false,
    }))
    expect(sentryMocks.setUser).toHaveBeenCalledWith({ id: 'anonymous-user' })
    expect(sentryMocks.setTag).toHaveBeenCalledWith('platform', 'web')
    expect(sentryMocks.setTag).not.toHaveBeenCalledWith('memoria.release_kind', expect.anything())
  })

  it('stays off without a web DSN', () => {
    vi.stubEnv('VITE_MEMORIA_WEB_BUILD', 'true')
    vi.stubEnv('VITE_SENTRY_DSN', '')

    initSentry('anonymous-user')

    expect(sentryMocks.init).not.toHaveBeenCalled()
  })

  it('scrubs note paths from URLs and still applies the shared filters', () => {
    const { beforeSend } = initWebSentry()
    const event = {
      message: 'Failed reading /home/user/vault/note.md',
      request: { url: 'https://memoria.example/n/Projects/Secret%20plan.md?ticket=abc' },
      breadcrumbs: [{ category: 'fetch', data: { url: '/v1/files/Projects/Secret.md', method: 'GET' } }],
    }

    expect(beforeSend(event, {})).toEqual({
      message: 'Failed reading [redacted-path]',
      request: { url: 'https://memoria.example/n' },
      breadcrumbs: [{ category: 'fetch', data: { url: `${window.location.origin}/v1`, method: 'GET' } }],
    })
    expect(beforeSend({ message: 'ResizeObserver loop limit exceeded' }, {})).toBeNull()
  })
})
