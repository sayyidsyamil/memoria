import { describe, expect, it } from 'vitest'
import {
  assertNativeWysiwygAutocompleteProofs,
  formatNativeWysiwygAutocompleteFailures,
  nativeWysiwygAutocompleteLogLine,
  nativeWysiwygAutocompleteProbeContent,
  nativeWysiwygAutocompleteProbeEnabled,
  nativeWysiwygAutocompleteProbeSelection,
  nativeWysiwygAutocompleteProbeSteps,
  nativeWysiwygAutocompleteProof,
  parseNativeWysiwygAutocompleteProofs,
} from './nativeWysiwygAutocompleteProbe'

describe('native WYSIWYG autocomplete probe', () => {
  it('keeps the legacy single-step helpers pointed at the wikilink probe', () => {
    expect(nativeWysiwygAutocompleteProbeContent()).toMatchObject({
      content: [{ content: [{ text: 'See [[AI' }] }],
      type: 'doc',
    })
    expect(nativeWysiwygAutocompleteProbeSelection()).toEqual({ from: 9, to: 9 })
  })

  it('runs native documents for autocomplete triggers and code-context suppression', () => {
    expect(nativeWysiwygAutocompleteProbeSteps()).toEqual([
      {
        content: {
          content: [{ content: [{ text: 'See [[AI', type: 'text' }], type: 'paragraph' }],
          type: 'doc',
        },
        scenario: 'wikilink',
        selection: { from: 9, to: 9 },
      },
      {
        content: {
          content: [{ content: [{ text: 'Ask @Lu', type: 'text' }], type: 'paragraph' }],
          type: 'doc',
        },
        scenario: 'personMention',
        selection: { from: 8, to: 8 },
      },
      {
        content: {
          content: [{ content: [{ text: 'Ship :rock', type: 'text' }], type: 'paragraph' }],
          type: 'doc',
        },
        scenario: 'emoji',
        selection: { from: 11, to: 11 },
      },
      {
        content: {
          content: [
            {
              content: [{ marks: [{ type: 'code' }], text: 'code [[AI', type: 'text' }],
              type: 'paragraph',
            },
          ],
          type: 'doc',
        },
        scenario: 'inlineCodeSuppression',
        selection: { from: 10, to: 10 },
      },
      {
        content: {
          content: [
            {
              attrs: { language: 'text' },
              content: [{ text: 'code [[AI', type: 'text' }],
              type: 'codeBlock',
            },
          ],
          type: 'doc',
        },
        scenario: 'codeBlockSuppression',
        selection: { from: 10, to: 10 },
      },
    ])
  })

  it('parses and asserts simulator log proofs for desktop autocomplete families', () => {
    const wikilinkProof = nativeWysiwygAutocompleteProof({
      kind: 'wikilink',
      query: 'AI',
      range: { from: 5, to: 9 },
    }, 'wikilink')
    const personMentionProof = nativeWysiwygAutocompleteProof({
      kind: 'personMention',
      query: 'Lu',
      range: { from: 5, to: 8 },
    }, 'personMention')
    const emojiProof = nativeWysiwygAutocompleteProof({
      kind: 'emoji',
      query: 'rock',
      range: { from: 6, to: 11 },
    }, 'emoji')
    const inlineCodeSuppressionProof = nativeWysiwygAutocompleteProof(null, 'inlineCodeSuppression')
    const codeBlockSuppressionProof = nativeWysiwygAutocompleteProof(null, 'codeBlockSuppression')
    const log = [
      nativeWysiwygAutocompleteLogLine(wikilinkProof),
      nativeWysiwygAutocompleteLogLine(personMentionProof),
      nativeWysiwygAutocompleteLogLine(emojiProof),
      nativeWysiwygAutocompleteLogLine(inlineCodeSuppressionProof),
      nativeWysiwygAutocompleteLogLine(codeBlockSuppressionProof),
    ].join('\n')

    expect(parseNativeWysiwygAutocompleteProofs(log)).toEqual([
      wikilinkProof,
      personMentionProof,
      emojiProof,
      inlineCodeSuppressionProof,
      codeBlockSuppressionProof,
    ])
    expect(assertNativeWysiwygAutocompleteProofs([
      wikilinkProof,
      personMentionProof,
      emojiProof,
      inlineCodeSuppressionProof,
      codeBlockSuppressionProof,
    ])).toEqual([])
  })

  it('reports missing and failed autocomplete proofs', () => {
    expect(formatNativeWysiwygAutocompleteFailures(assertNativeWysiwygAutocompleteProofs([]))).toContain('editor.wysiwyg.autocomplete')
    expect(assertNativeWysiwygAutocompleteProofs([
      nativeWysiwygAutocompleteProof(null),
    ])).toEqual([
      {
        id: 'editor.wysiwyg.autocomplete.wikilink',
        message: 'Native WYSIWYG detects wikilink autocomplete with the exact replacement range',
      },
      {
        id: 'editor.wysiwyg.autocomplete.personMention',
        message: 'Native WYSIWYG detects person mention autocomplete with the exact replacement range',
      },
      {
        id: 'editor.wysiwyg.autocomplete.emoji',
        message: 'Native WYSIWYG detects emoji shortcode autocomplete with the exact replacement range',
      },
      {
        id: 'editor.wysiwyg.autocomplete.inlineCodeSuppression',
        message: 'Native WYSIWYG suppresses autocomplete inside inline code marks',
      },
      {
        id: 'editor.wysiwyg.autocomplete.codeBlockSuppression',
        message: 'Native WYSIWYG suppresses autocomplete inside code blocks',
      },
    ])
  })

  it('detects the native QA query flag', () => {
    expect(nativeWysiwygAutocompleteProbeEnabled(new globalThis.URLSearchParams('wysiwygAutocompleteProbe=1'))).toBe(true)
    expect(nativeWysiwygAutocompleteProbeEnabled(new globalThis.URLSearchParams('wysiwygAutocompleteProbe=0'))).toBe(false)
  })
})
