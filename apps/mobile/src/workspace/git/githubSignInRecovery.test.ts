import { afterEach, expect, it, vi } from 'vitest'
import { finishGitHubSignIn, type GitHubDeviceCode } from './githubAuth'

const code: GitHubDeviceCode = {
  device_code: 'device', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 60,
}
const token = { access_token: 'test-only', expires_in: 3600 }
const identity = { id: 42, login: 'tester' }
afterEach(() => vi.useRealTimers())

it('recovers a transport interruption while the user authorizes in Safari', async () => {
  vi.useFakeTimers()
  const request = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('Network request failed'))
    .mockResolvedValueOnce(Response.json(token)).mockResolvedValueOnce(Response.json(identity))
  const result = finishGitHubSignIn('public-test-id', code, new AbortController().signal, request)
  await vi.advanceTimersByTimeAsync(5000)
  expect(request).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(9999)
  expect(request).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(await result).toMatchObject({ accessToken: token.access_token, userId: identity.id })
  expect(vi.getTimerCount()).toBe(0)
})

it('retains an issued token and retries only identity verification after a network interruption', async () => {
  vi.useFakeTimers()
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(token))
    .mockRejectedValueOnce(new TypeError('Network request failed')).mockResolvedValueOnce(Response.json(identity))
  const result = finishGitHubSignIn('public-test-id', code, new AbortController().signal, request)
  await vi.advanceTimersByTimeAsync(15_000)
  expect(await result).toMatchObject({ login: identity.login })
  expect(request.mock.calls.map(([url]) => url)).toEqual([
    'https://github.com/login/oauth/access_token', 'https://api.github.com/user', 'https://api.github.com/user',
  ])
  expect(vi.getTimerCount()).toBe(0)
})

it('retries a timed-out poll but does not keep the abandoned request alive', async () => {
  vi.useFakeTimers()
  const request = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValueOnce(Response.json(token)).mockResolvedValueOnce(Response.json(identity))
  const result = finishGitHubSignIn('public-test-id', code, new AbortController().signal, request)
  await vi.advanceTimersByTimeAsync(35_000)
  expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(await result).toMatchObject({ userId: identity.id })
})

it('expires a disconnected sign-in without requesting after its deadline', async () => {
  vi.useFakeTimers()
  const request = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'))
  const result = finishGitHubSignIn('public-test-id', code, new AbortController().signal, request)
  const check = expect(result).rejects.toThrow('githubAuthorizationExpired')
  await vi.advanceTimersByTimeAsync(60_000)
  await check
  expect(request).toHaveBeenCalledTimes(3)
  expect(vi.getTimerCount()).toBe(0)
})

it('cancels the retry wait immediately without another network request', async () => {
  vi.useFakeTimers()
  const request = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'))
  const controller = new AbortController()
  const result = finishGitHubSignIn('public-test-id', code, controller.signal, request)
  const check = expect(result).rejects.toThrow('cancelled')
  await vi.advanceTimersByTimeAsync(5000)
  controller.abort()
  await check
  expect(request).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('does not retry an explicit authorization denial', async () => {
  vi.useFakeTimers()
  const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'access_denied' }))
  const result = finishGitHubSignIn('public-test-id', code, new AbortController().signal, request)
  const check = expect(result).rejects.toThrow('githubAuthorizationFailed')
  await vi.advanceTimersByTimeAsync(5000)
  await check
  expect(request).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
