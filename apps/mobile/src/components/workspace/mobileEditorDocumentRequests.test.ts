import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMobileEditorDocumentRequests } from './mobileEditorDocumentRequests'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function harness() {
  const requests = createMobileEditorDocumentRequests()
  const send = vi.fn()
  const reply = (type: string, content: unknown, index = 0) => requests.receive({
    type, payload: { content, messageId: send.mock.calls[index][0].payload.messageId },
  })
  return { requests, send, reply }
}

it('releases a document callback and its timer before resolving the reply', async () => {
  const { requests, send, reply } = harness()
  const document = { type: 'doc', content: [] }
  const read = requests.readJSON(send)
  expect(requests.pendingCount()).toBe(1)
  expect(reply('send-json-back', document)).toBe(true)
  expect(requests.pendingCount()).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
  await expect(read).resolves.toEqual(document)
  expect(reply('send-json-back', document)).toBe(false)
})

it('does not retain successive autosave document snapshots', async () => {
  const { requests, send, reply } = harness()
  for (let index = 0; index < 1000; index++) {
    const read = requests.readJSON(send)
    reply('send-json-back', { type: 'doc', content: [] }, index)
    await read
    expect(requests.pendingCount()).toBe(0)
  }
  expect(vi.getTimerCount()).toBe(0)
})

it('matches concurrent read kinds and ignores unrelated or malformed replies', async () => {
  const { requests, send, reply } = harness()
  const json = requests.readJSON(send)
  const html = requests.readHTML(send)
  const text = requests.readText(send)
  expect(requests.receive({ type: 'stateUpdate', payload: {} })).toBe(false)
  expect(requests.receive({ type: 'send-json-back', payload: { messageId: 42 } })).toBe(false)
  expect(requests.receive(null)).toBe(false)
  expect(reply('send-text-back', 'wrong kind')).toBe(false)
  expect(requests.pendingCount()).toBe(3)
  reply('send-text-back', 'Text', 2)
  reply('send-json-back', { type: 'doc' })
  reply('send-html-back', '<p>Text</p>', 1)
  await expect(text).resolves.toBe('Text')
  await expect(json).resolves.toEqual({ type: 'doc' })
  await expect(html).resolves.toBe('<p>Text</p>')
  expect(requests.pendingCount()).toBe(0)
})

it('owns reply identifiers per editor, even when both have a pending read', async () => {
  const first = harness()
  const second = harness()
  const firstRead = first.requests.readJSON(first.send)
  const secondRead = second.requests.readJSON(second.send)
  const firstId = first.send.mock.calls[0][0].payload.messageId
  const secondId = second.send.mock.calls[0][0].payload.messageId
  expect(firstId).not.toBe(secondId)
  expect(second.requests.receive({ type: 'send-json-back', payload: { messageId: firstId, content: { type: 'doc' } } })).toBe(false)
  first.reply('send-json-back', { type: 'doc' })
  second.reply('send-json-back', { type: 'doc' })
  await Promise.all([firstRead, secondRead])
  expect(first.requests.pendingCount() + second.requests.pendingCount()).toBe(0)
})

it('handles a synchronous bridge reply without leaving its timeout registered', async () => {
  const { requests } = harness()
  const read = requests.readJSON(message => {
    requests.receive({ type: 'send-json-back', payload: { ...message.payload, content: { type: 'doc' } } })
  })
  await expect(read).resolves.toEqual({ type: 'doc' })
  expect(requests.pendingCount()).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
})

it('expires an unanswered request and discards its late response', async () => {
  const { requests, send, reply } = harness()
  const failure = expect(requests.readJSON(send)).rejects.toThrow('editorReadTimedOut')
  await vi.advanceTimersByTimeAsync(10_000)
  await failure
  expect(requests.pendingCount()).toBe(0)
  expect(reply('send-json-back', { type: 'doc' })).toBe(false)
})

it('bounds simultaneous requests without retaining the rejected request', async () => {
  const { requests, send } = harness()
  const reads = Array.from({ length: 32 }, () => requests.readJSON(send).catch(error => error.message))
  await expect(requests.readJSON(send)).rejects.toThrow('editorReadLimitReached')
  expect(send).toHaveBeenCalledTimes(32)
  requests.dispose()
  expect(await Promise.all(reads)).toEqual(Array(32).fill('editorDisposed'))
  expect(requests.pendingCount()).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
})

it('cancels on unmount and can restart safely after an effect replay', async () => {
  const { requests, send, reply } = harness()
  const old = expect(requests.readJSON(send)).rejects.toThrow('editorDisposed')
  requests.dispose()
  await old
  await expect(requests.readJSON(send)).rejects.toThrow('editorDisposed')
  requests.activate()
  const fresh = requests.readJSON(send)
  expect(reply('send-json-back', { type: 'doc' })).toBe(false)
  reply('send-json-back', { type: 'doc' }, 1)
  await expect(fresh).resolves.toEqual({ type: 'doc' })
})

it('releases a request if the bridge throws synchronously', async () => {
  const { requests } = harness()
  const send = () => { throw new Error('Bridge unavailable') }
  await expect(requests.readJSON(send)).rejects.toThrow('Bridge unavailable')
  expect(requests.pendingCount()).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
})

it('allows an already requested final save to drain while rejecting new reads after retirement', async () => {
  const { requests, send, reply } = harness()
  const finalSave = requests.readJSON(send)
  requests.retire()
  await expect(requests.readJSON(send)).rejects.toThrow('editorDisposed')
  expect(requests.pendingCount()).toBe(1)
  reply('send-json-back', { type: 'doc' })
  await expect(finalSave).resolves.toEqual({ type: 'doc' })
  expect(requests.pendingCount()).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
})

it('rejects malformed payloads without retaining a completed callback', async () => {
  const { requests, send, reply } = harness()
  const json = expect(requests.readJSON(send)).rejects.toThrow('invalidEditorDocument')
  reply('send-json-back', null)
  await json
  const html = expect(requests.readHTML(send)).rejects.toThrow('invalidEditorText')
  reply('send-html-back', 42, 1)
  await html
  expect(requests.pendingCount()).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
})
