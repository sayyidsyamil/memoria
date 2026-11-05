import { afterEach, expect, it, vi } from 'vitest'
import { githubApi, githubForm } from './githubRequest'

afterEach(() => vi.useRealTimers())

function stalledBody() {
  const response = Response.json({})
  vi.spyOn(response, 'json').mockImplementation(() => new Promise(() => {}))
  return response
}

it('bounds a stalled JSON body, not only response headers', async () => {
  vi.useFakeTimers()
  const request = vi.fn<typeof fetch>().mockResolvedValue(stalledBody())
  const check = expect(githubApi('user', 'test-only', request)).rejects.toThrow('githubRequestTimeout')
  await vi.advanceTimersByTimeAsync(30_000)
  await check
  expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})

it('settles cancellation even when the transport ignores its abort signal', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const request = vi.fn<typeof fetch>().mockResolvedValue(stalledBody())
  const check = expect(githubForm('device/code', {}, request, controller.signal)).rejects.toThrow('cancelled')
  await vi.advanceTimersByTimeAsync(0)
  controller.abort()
  await check
  expect(vi.getTimerCount()).toBe(0)
})

it('does not start an already cancelled request', async () => {
  const controller = new AbortController()
  controller.abort()
  const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}))
  await expect(githubForm('device/code', {}, request, controller.signal)).rejects.toThrow('cancelled')
  expect(request).not.toHaveBeenCalled()
})

it('cleans up the deadline after a successful response', async () => {
  vi.useFakeTimers()
  const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ login: 'tester' }))
  await expect(githubApi('user', 'test-only', request)).resolves.toEqual({ login: 'tester' })
  expect(vi.getTimerCount()).toBe(0)
})

it.each([[401, 'githubAuthorizationExpired'], [403, 'githubRequestFailed'], [500, 'githubRequestFailed']])(
  'keeps HTTP %i failures safe and distinct from network failures', async (status, message) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status }))
    await expect(githubApi('user', 'test-only', request)).rejects.toThrow(message)
  },
)

it('does not expose a raw transport error containing sensitive request details', async () => {
  const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('sensitive request details'))
  await expect(githubApi('user', 'test-only', request)).rejects.toThrow(/^githubNetworkFailed$/)
})

it('reports malformed JSON as a request failure without response content', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('sensitive invalid response'))
  await expect(githubApi('user', 'test-only', request)).rejects.toThrow(/^githubRequestFailed$/)
})
