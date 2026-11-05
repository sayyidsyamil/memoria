import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMobileEditorDocumentRequests } from './mobileEditorDocumentRequests'
import { useFlushOnUnmount } from './MobileWysiwygEditorLifecycle.native'

type EffectSetup = Parameters<typeof import('react').useEffect>[0]
const effects = vi.hoisted(() => ({ setup: undefined as EffectSetup | undefined }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (setup: EffectSetup) => { effects.setup = setup },
}))

beforeEach(() => { vi.useFakeTimers(); effects.setup = undefined })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

function references() {
  const requests = createMobileEditorDocumentRequests()
  return {
    acceptsEditorChangesRef: { current: true },
    contentRef: { current: '# Saved content' },
    documentReads: { extensions: [], requests, isReady: () => true },
    editorRef: { current: null },
    firstEditorSerializationRef: { current: false },
    hasAcceptedEditorChangeRef: { current: true },
    initialContentSyncRef: { current: null },
    inlineAutocompleteTimerRef: { current: null },
    markdownBlockProofReadyRef: { current: false },
    markdownBlockRenderProofRef: { current: false },
    saveTimerRef: { current: null },
    tableCommandMutationProofReadyRef: { current: false },
    webViewLoadedRef: { current: false },
  }
}

it('requests the final save before retiring reads, then allows that reply to drain', async () => {
  const refs = references()
  const retire = vi.spyOn(refs.documentReads.requests, 'retire')
  const send = vi.fn()
  let finalSave: Promise<unknown> | undefined
  const flush = () => { finalSave = refs.documentReads.requests.readJSON(send) }
  useFlushOnUnmount(refs, flush)
  const cleanup = effects.setup?.()
  cleanup?.()
  expect(retire).toHaveBeenCalledExactlyOnceWith()
  await expect(refs.documentReads.requests.readJSON(send)).rejects.toThrow('editorDisposed')
  expect(refs.documentReads.requests.pendingCount()).toBe(1)
  refs.documentReads.requests.receive({
    type: 'send-json-back', payload: { messageId: send.mock.calls[0][0].payload.messageId, content: { type: 'doc' } },
  })
  await expect(finalSave).resolves.toEqual({ type: 'doc' })
  expect(refs.documentReads.requests.pendingCount()).toBe(0)
})

it('does not serialize an unchanged editor on unmount', async () => {
  const refs = references()
  refs.hasAcceptedEditorChangeRef.current = false
  const retire = vi.spyOn(refs.documentReads.requests, 'retire')
  const flush = vi.fn()
  useFlushOnUnmount(refs, flush)
  const cleanup = effects.setup?.()
  cleanup?.()
  expect(flush).not.toHaveBeenCalled()
  expect(retire).toHaveBeenCalledExactlyOnceWith()
  await expect(refs.documentReads.requests.readJSON(vi.fn())).rejects.toThrow('editorDisposed')
})

it('reactivates the same request owner after a React effect replay', async () => {
  const refs = references()
  refs.hasAcceptedEditorChangeRef.current = false
  useFlushOnUnmount(refs, vi.fn())
  const cleanup = effects.setup?.()
  cleanup?.()
  effects.setup?.()
  const send = vi.fn()
  const read = refs.documentReads.requests.readJSON(send)
  expect(refs.documentReads.requests.pendingCount()).toBe(1)
  refs.documentReads.requests.receive({
    type: 'send-json-back', payload: { messageId: send.mock.calls[0][0].payload.messageId, content: { type: 'doc' } },
  })
  await expect(read).resolves.toEqual({ type: 'doc' })
})
