import { describe, expect, it } from 'vitest'
import {
  nativeWysiwygDocumentWithInsertedPlainText,
  nativeWysiwygDocumentWithInsertedWikilink,
} from '../components/workspace/MobileWysiwygWikilinkBridgeModel'
import { tiptapJsonToMobileMarkdown } from '../workspace/mobileDocumentContent'
import {
  assertNativeWysiwygWikilinkInsertProofs,
  formatNativeWysiwygWikilinkInsertFailures,
  nativeWysiwygEmojiInsertProbePayload,
  nativeWysiwygEmojiInsertProbeSelection,
  nativeWysiwygPersonMentionInsertProbeContent,
  nativeWysiwygPersonMentionInsertProbePayload,
  nativeWysiwygPersonMentionInsertProbeSelection,
  nativeWysiwygWikilinkInsertLogLine,
  nativeWysiwygWikilinkInsertProbeEnabled,
  nativeWysiwygWikilinkInsertProbePayload,
  nativeWysiwygWikilinkInsertProof,
  parseNativeWysiwygWikilinkInsertProofs,
} from './nativeWysiwygWikilinkInsertProbe'

const rocketEmoji = String.fromCodePoint(0x1F680)

describe('native WYSIWYG wikilink insert probe', () => {
  it('uses the canonical native insertion payload', () => {
    expect(nativeWysiwygWikilinkInsertProbePayload()).toEqual({
      label: 'AI Ops Guide',
      target: 'AI Ops Guide',
    })
    expect(nativeWysiwygPersonMentionInsertProbePayload()).toEqual({
      label: 'Luca',
      target: 'People/Luca',
    })
    expect(nativeWysiwygEmojiInsertProbePayload()).toEqual({ text: rocketEmoji })
    expect(nativeWysiwygPersonMentionInsertProbeContent()).toMatchObject({
      content: [{
        content: [{ text: 'Ask @Lu', type: 'text' }],
        type: 'paragraph',
      }, {
        content: [{ text: 'Ship :rock', type: 'text' }],
        type: 'paragraph',
      }],
      type: 'doc',
    })
    expect(nativeWysiwygPersonMentionInsertProbeSelection()).toEqual({ from: 5, to: 8 })
    expect(nativeWysiwygEmojiInsertProbeSelection()).toEqual({ from: 15, to: 20 })
  })

  it('builds a passing proof when inserted links save as desktop markdown', () => {
    expect(nativeWysiwygWikilinkInsertProof({
      content: `# Note\n\nAsk [[People/Luca|Luca]] about [[AI Ops Guide]].\n\nShip ${rocketEmoji}`,
      noteId: 'note.md',
    })).toMatchObject({
      insertedEmojiSaved: true,
      insertedEmojiSourceRemoved: true,
      insertedPersonMentionSaved: true,
      insertedPersonMentionSourceRemoved: true,
      insertedWikilinkSaved: true,
      noteId: 'note.md',
    })
  })

  it('builds a passing proof from the native probe insertion order', () => {
    const emojiJson = expectProbeJson(nativeWysiwygDocumentWithInsertedPlainText({
      json: nativeWysiwygPersonMentionInsertProbeContent(),
      payload: nativeWysiwygEmojiInsertProbePayload(),
      selection: nativeWysiwygEmojiInsertProbeSelection(),
    }))
    const personMentionJson = expectProbeJson(nativeWysiwygDocumentWithInsertedWikilink({
      json: emojiJson,
      payload: nativeWysiwygPersonMentionInsertProbePayload(),
      selection: nativeWysiwygPersonMentionInsertProbeSelection(),
    }))
    const combinedJson = expectProbeJson(nativeWysiwygDocumentWithInsertedWikilink({
      json: personMentionJson,
      payload: nativeWysiwygWikilinkInsertProbePayload(),
    }))
    const proof = nativeWysiwygWikilinkInsertProof({
      content: tiptapJsonToMobileMarkdown(combinedJson),
      noteId: 'note.md',
    })

    expect(assertNativeWysiwygWikilinkInsertProofs([proof])).toEqual([])
  })

  it('parses and asserts simulator log proofs', () => {
    const proof = nativeWysiwygWikilinkInsertProof({
      content: `# Note\n\nAsk [[People/Luca|Luca]] [[AI Ops Guide]]\n\nShip ${rocketEmoji}`,
      noteId: 'note.md',
    })

    expect(parseNativeWysiwygWikilinkInsertProofs(nativeWysiwygWikilinkInsertLogLine(proof))).toEqual([proof])
    expect(assertNativeWysiwygWikilinkInsertProofs([proof])).toEqual([])
  })

  it('reports missing and failed insert proofs', () => {
    expect(formatNativeWysiwygWikilinkInsertFailures(
      assertNativeWysiwygWikilinkInsertProofs([]),
    )).toContain('editor.wysiwyg.wikilinkInsert')
    expect(assertNativeWysiwygWikilinkInsertProofs([
      nativeWysiwygWikilinkInsertProof({ content: '# Note', noteId: 'note.md' }),
    ])).toEqual([{
      id: 'editor.wysiwyg.wikilinkInsert.saved',
      message: 'Native WYSIWYG picker insertion saves as desktop wikilink markdown',
    }, {
      id: 'editor.wysiwyg.wikilinkInsert.personMentionSaved',
      message: 'Native WYSIWYG person mention insertion saves as a desktop wikilink alias',
    }, {
      id: 'editor.wysiwyg.wikilinkInsert.emojiSaved',
      message: 'Native WYSIWYG emoji insertion saves as plain markdown emoji text',
    }])
    expect(assertNativeWysiwygWikilinkInsertProofs([
      nativeWysiwygWikilinkInsertProof({
        content: '# Note\n\nAsk @Lu [[AI Ops Guide]]\n\nShip :rock',
        noteId: 'note.md',
      }),
    ])).toEqual([{
      id: 'editor.wysiwyg.wikilinkInsert.personMentionSaved',
      message: 'Native WYSIWYG person mention insertion saves as a desktop wikilink alias',
    }, {
      id: 'editor.wysiwyg.wikilinkInsert.personMentionReplacement',
      message: 'Native WYSIWYG person mention insertion replaces the typed @ query',
    }, {
      id: 'editor.wysiwyg.wikilinkInsert.emojiSaved',
      message: 'Native WYSIWYG emoji insertion saves as plain markdown emoji text',
    }, {
      id: 'editor.wysiwyg.wikilinkInsert.emojiReplacement',
      message: 'Native WYSIWYG emoji insertion replaces the typed shortcode query',
    }])
  })

  it('detects the native QA query flag', () => {
    expect(nativeWysiwygWikilinkInsertProbeEnabled(new globalThis.URLSearchParams('wysiwygWikilinkInsertProbe=1'))).toBe(true)
    expect(nativeWysiwygWikilinkInsertProbeEnabled(new globalThis.URLSearchParams('wysiwygWikilinkInsertProbe=0'))).toBe(false)
  })
})

function expectProbeJson(json: unknown | null): unknown {
  expect(json).not.toBeNull()
  return json
}
