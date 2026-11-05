import { afterEach, expect, it, vi } from 'vitest'
import { readReadyEditorDocument } from './readyEditorDocument'

afterEach(() => vi.useRealTimers())

it('does not send a document request before the WebView bridge is ready', async () => {
  vi.useFakeTimers()
  let ready = false
  const read = vi.fn().mockResolvedValue({ type: 'doc' })
  const pending = readReadyEditorDocument({ isReady: () => ready, read }, 100)
  await vi.advanceTimersByTimeAsync(50)
  expect(read).not.toHaveBeenCalled()
  ready = true
  await vi.advanceTimersByTimeAsync(25)
  expect(await pending).toEqual({ type: 'doc' })
  expect(read).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('fails closed if the editor never becomes ready', async () => {
  vi.useFakeTimers()
  const read = vi.fn()
  const pending = readReadyEditorDocument({ isReady: () => false, read }, 100)
  const result = expect(pending).rejects.toThrow('editorNotReady')
  await vi.advanceTimersByTimeAsync(100)
  await result
  expect(read).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('bounds unresponsive reads after startup without substituting an empty document', async () => {
  vi.useFakeTimers()
  const pending = readReadyEditorDocument({ isReady: () => true, read: () => new Promise(() => {}) }, 100)
  const result = expect(pending).rejects.toThrow('editorReadTimedOut')
  await vi.advanceTimersByTimeAsync(100)
  await result
  expect(vi.getTimerCount()).toBe(0)
})
