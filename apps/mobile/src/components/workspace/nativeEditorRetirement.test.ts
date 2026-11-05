import { expect, it, vi } from 'vitest'
import { setTimeout } from 'node:timers'
import { retireNativeEditorSession, type NativeTentapEditorRefs } from './MobileWysiwygEditorLifecycle.native'
import { createMobileEditorDocumentRequests } from './mobileEditorDocumentRequests'

it('rejects dead-session reads without serializing an empty document over confirmed Markdown', async () => {
  vi.useFakeTimers()
  try {
    const cancel = vi.fn()
    const save = vi.fn()
    const requests = createMobileEditorDocumentRequests()
    const refs: NativeTentapEditorRefs = {
      documentReads: { extensions: [], requests, isReady: () => true },
      acceptsEditorChangesRef: { current: true },
      contentRef: { current: '---\ncustom: keep-me\n---\n# Saved content' },
      editorRef: { current: null },
      firstEditorSerializationRef: { current: false },
      hasAcceptedEditorChangeRef: { current: true },
      initialContentSyncRef: { current: { cancel, isReady: () => true, settled: Promise.resolve() } },
      inlineAutocompleteTimerRef: { current: setTimeout(() => { save() }, 80) },
      markdownBlockProofReadyRef: { current: false },
      markdownBlockRenderProofRef: { current: false },
      saveTimerRef: { current: setTimeout(() => { save() }, 250) },
      tableCommandMutationProofReadyRef: { current: false },
      webViewLoadedRef: { current: true },
    }
    const read = requests.readJSON(vi.fn())
    const rejected = expect(read).rejects.toThrow('editorDisposed')
    retireNativeEditorSession(refs)
    await rejected
    vi.runAllTimers()
    expect(save).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledOnce()
    expect(requests.pendingCount()).toBe(0)
    expect(refs.hasAcceptedEditorChangeRef.current).toBe(false)
    expect(refs.acceptsEditorChangesRef.current).toBe(false)
    expect(refs.webViewLoadedRef.current).toBe(false)
    expect(refs.contentRef.current).toBe('---\ncustom: keep-me\n---\n# Saved content')
  } finally { vi.useRealTimers() }
})
