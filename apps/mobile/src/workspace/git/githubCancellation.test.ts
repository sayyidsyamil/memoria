import { afterEach, expect, it, vi } from 'vitest'
import { beginGitHubSignIn, finishGitHubSignIn, type GitHubDeviceCode } from './githubAuth'
import { githubFailure } from './githubFailure'

afterEach(() => vi.useRealTimers())

it('forwards cancellation through the initial device-code exchange', async () => {
  const request = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}))
  const controller = new AbortController()
  const check = expect(beginGitHubSignIn('public-test-id', request, controller.signal)).rejects.toThrow('cancelled')
  controller.abort()
  await check
  expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true)
})

it('cancels identity verification after the token has arrived', async () => {
  vi.useFakeTimers()
  const code: GitHubDeviceCode = {
    device_code: 'device', user_code: 'code', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 60,
  }
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ access_token: 'test-only' }))
    .mockImplementationOnce(() => new Promise(() => {}))
  const controller = new AbortController()
  const check = expect(finishGitHubSignIn('public-test-id', code, controller.signal, request)).rejects.toThrow('cancelled')
  await vi.advanceTimersByTimeAsync(5000)
  expect(request).toHaveBeenCalledTimes(2)
  controller.abort()
  await check
  expect(request.mock.calls[1][1]?.signal?.aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['toString', '__proto__', 'sensitive response content'])('never returns raw or inherited error values: %s', (message) => {
  expect(githubFailure(new Error(message))).toBe('mobile.vaults.requestFailed')
})
