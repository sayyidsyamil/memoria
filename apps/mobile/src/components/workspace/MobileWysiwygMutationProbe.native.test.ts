import { describe, expect, it } from 'vitest'
import type { EditorBridge } from '@10play/tentap-editor'
import {
  enableNativeWysiwygMutationProbe,
  type NativeWysiwygMutationProbeRefs,
} from './MobileWysiwygMutationProbe.native'

describe('native WYSIWYG mutation probe', () => {
  it('opens the change gate without a user touch', () => {
    const refs = mutationProbeRefs(null)

    enableNativeWysiwygMutationProbe(refs)

    expect(refs.acceptsEditorChangesRef.current).toBe(true)
  })
})

function mutationProbeRefs(editor: EditorBridge | null): NativeWysiwygMutationProbeRefs {
  return {
    acceptsEditorChangesRef: { current: false },
    editorRef: { current: editor },
    hasAcceptedEditorChangeRef: { current: false },
    saveTimerRef: { current: null },
  }
}
