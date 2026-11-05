import { afterEach, expect, it, vi } from 'vitest'
import { createGitFetchClient, type GitFetch } from './gitFetchClient'

afterEach(() => vi.useRealTimers())

it('allows a progressing pack download to exceed two minutes', async () => {
  vi.useFakeTimers()
  const fetcher = delayedChunks(60_000, 3)
  const response = await createGitFetchClient(fetcher).request({ url: 'https://github.com/team/vault.git' })
  const result = collect(response.body).catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(240_000)
  expect(await result).toEqual([1, 2, 3])
  expect(vi.getTimerCount()).toBe(0)
})

it('still aborts a stalled body read', async () => {
  vi.useFakeTimers()
  const response = await createGitFetchClient(delayedChunks(180_000, 1)).request({ url: 'https://github.com/team/vault.git' })
  const result = collect(response.body).catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(180_000)
  expect(await result).toEqual(new Error('cancelled'))
  expect(vi.getTimerCount()).toBe(0)
})

it('does not count consumer processing time as network inactivity', async () => {
  vi.useFakeTimers()
  const fetcher = vi.fn(delayedChunks(1, 2))
  const response = await createGitFetchClient(fetcher).request({ url: 'https://github.com/team/vault.git' })
  const processChunk = () => new Promise<void>((resolve) => setTimeout(resolve, 180_000))
  const result = collect(response.body, processChunk).catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(360_010)
  expect(await result).toEqual([1, 2])
  expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
})

it('bounds the initial connection and response-header wait', async () => {
  vi.useFakeTimers()
  const fetcher: GitFetch = (_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
  })
  const result = createGitFetchClient(fetcher).request({ url: 'https://github.com/team/vault.git' }).catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(120_000)
  expect(await result).toEqual(new Error('cancelled'))
  expect(vi.getTimerCount()).toBe(0)
})

it('cancels an unfinished response when its consumer stops early', async () => {
  vi.useFakeTimers()
  const cancel = vi.fn()
  const fetcher: GitFetch = async () => new Response(new ReadableStream({
    start: (controller) => controller.enqueue(new Uint8Array([1])),
    cancel,
  }))
  const response = await createGitFetchClient(fetcher).request({ url: 'https://github.com/team/vault.git' })
  for await (const chunk of response.body ?? []) { expect(chunk).toEqual(new Uint8Array([1])); break }
  expect(cancel).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

function delayedChunks(delay: number, count: number): GitFetch {
  return async (_url, options) => {
    let sent = 0
    return new Response(new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (sent === count) { controller.close(); return }
        await new Promise<void>((resolve) => setTimeout(resolve, delay))
        if (options?.signal?.aborted) controller.error(new Error('cancelled'))
        else controller.enqueue(new Uint8Array([++sent]))
      },
    }))
  }
}

async function collect(body: AsyncIterable<Uint8Array> | undefined, processChunk?: () => Promise<void>) {
  const bytes: number[] = []
  for await (const chunk of body ?? []) { bytes.push(...chunk); await processChunk?.() }
  return bytes
}
