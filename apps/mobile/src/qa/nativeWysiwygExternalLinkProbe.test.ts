import { describe, expect, it } from 'vitest'
import {
  assertNativeWysiwygExternalLinkProofs,
  formatNativeWysiwygExternalLinkFailures,
  nativeWysiwygExternalLinkLogLine,
  nativeWysiwygExternalLinkProbeContent,
  nativeWysiwygExternalLinkProbeEnabled,
  nativeWysiwygExternalLinkProbeNormalizedUrl,
  nativeWysiwygExternalLinkProbeSelection,
  nativeWysiwygExternalLinkProof,
  parseNativeWysiwygExternalLinkProofs,
} from './nativeWysiwygExternalLinkProbe'

describe('native WYSIWYG external link probe', () => {
  it('uses a deterministic external link target and selected text range', () => {
    expect(nativeWysiwygExternalLinkProbeContent()).toMatchObject({
      content: [{
        content: [{ text: 'Memoria', type: 'text' }],
        type: 'paragraph',
      }],
      type: 'doc',
    })
    expect(nativeWysiwygExternalLinkProbeSelection()).toEqual({ from: 1, to: 8 })
    expect(nativeWysiwygExternalLinkProbeNormalizedUrl()).toBe('https://memoria.app/docs')
  })

  it('builds passing proofs for link save and unlink save stages', () => {
    const saveProof = nativeWysiwygExternalLinkProof({
      content: '[Memoria](https://memoria.app/docs)',
      noteId: 'note.md',
    })
    const removeProof = nativeWysiwygExternalLinkProof({
      content: 'Memoria',
      noteId: 'note.md',
    })

    expect(saveProof).toMatchObject({
      linkSaved: true,
      normalizedUrlSaved: true,
      sourceTextPreserved: true,
      unlinkSaved: false,
    })
    expect(removeProof).toMatchObject({
      linkSaved: false,
      normalizedUrlSaved: false,
      sourceTextPreserved: true,
      unlinkSaved: true,
    })
    expect(assertNativeWysiwygExternalLinkProofs([saveProof, removeProof])).toEqual([])
  })

  it('parses simulator log proofs', () => {
    const proof = nativeWysiwygExternalLinkProof({
      content: '[Memoria](https://memoria.app/docs)',
      noteId: 'note.md',
    })

    expect(parseNativeWysiwygExternalLinkProofs(nativeWysiwygExternalLinkLogLine(proof))).toEqual([proof])
  })

  it('reports missing link and unlink proof stages', () => {
    expect(formatNativeWysiwygExternalLinkFailures(
      assertNativeWysiwygExternalLinkProofs([]),
    )).toContain('editor.wysiwyg.externalLink')
    expect(assertNativeWysiwygExternalLinkProofs([
      nativeWysiwygExternalLinkProof({ content: 'Memoria', noteId: 'note.md' }),
    ])).toEqual([{
      id: 'editor.wysiwyg.externalLink.saved',
      message: 'Native WYSIWYG external-link action saves a normalized desktop Markdown link',
    }])
    expect(assertNativeWysiwygExternalLinkProofs([
      nativeWysiwygExternalLinkProof({
        content: '[Memoria](https://memoria.app/docs)',
        noteId: 'note.md',
      }),
    ])).toEqual([{
      id: 'editor.wysiwyg.externalLink.removed',
      message: 'Native WYSIWYG external-link removal saves plain text without the URL',
    }])
  })

  it('detects the native QA query flag', () => {
    expect(nativeWysiwygExternalLinkProbeEnabled(new globalThis.URLSearchParams('wysiwygExternalLinkProbe=1'))).toBe(true)
    expect(nativeWysiwygExternalLinkProbeEnabled(new globalThis.URLSearchParams('wysiwygExternalLinkProbe=0'))).toBe(false)
  })
})
