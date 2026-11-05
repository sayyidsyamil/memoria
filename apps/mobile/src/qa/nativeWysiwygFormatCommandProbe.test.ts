import { describe, expect, it } from 'vitest'
import { mobileColors } from '../ui/tokens'
import {
  assertNativeWysiwygFormatCommandProofs,
  formatNativeWysiwygFormatCommandFailures,
  nativeWysiwygFormatCommandLogLine,
  nativeWysiwygFormatCommandEffectContent,
  nativeWysiwygFormatCommandEffectMarkdown,
  nativeWysiwygFormatCommandEffectProbeActions,
  nativeWysiwygFormatCommandEffectSelection,
  nativeWysiwygFormatCommandExpectedEffectMarkdown,
  nativeWysiwygFormatCommandHighlightColor,
  nativeWysiwygFormatCommandProbeActions,
  nativeWysiwygFormatCommandProbeEnabled,
  nativeWysiwygFormatCommandProof,
  parseNativeWysiwygFormatCommandProofs,
} from './nativeWysiwygFormatCommandProbe'

describe('native WYSIWYG format command probe', () => {
  it('covers every native TenTap formatting action exposed in the compact toolbar', () => {
    expect(nativeWysiwygFormatCommandProbeActions).toEqual([
      'bold',
      'italic',
      'strike',
      'code',
      'highlight',
      'heading1',
      'heading2',
      'heading3',
      'heading4',
      'heading5',
      'heading6',
      'bulletList',
      'orderedList',
      'taskList',
      'indent',
      'outdent',
      'quote',
      'tableAddColumnAfter',
      'tableAddRowAfter',
      'tableDeleteColumn',
      'tableDeleteRow',
    ])
  })

  it('builds proofs from native editor bridge methods and command args', () => {
    expect(nativeWysiwygFormatCommandHighlightColor).toBe(mobileColors.yellowSoft)
    expect(nativeWysiwygFormatCommandProof({
      action: 'heading2',
      editor: { toggleHeading: () => undefined },
    })).toEqual({
      action: 'heading2',
      args: [2],
      forwarded: true,
      method: 'toggleHeading',
    })
    expect(nativeWysiwygFormatCommandProof({
      action: 'highlight',
      editor: { toggleHighlight: () => undefined },
    })).toEqual({
      action: 'highlight',
      args: [mobileColors.yellowSoft],
      forwarded: true,
      method: 'toggleHighlight',
    })
    expect(nativeWysiwygFormatCommandProof({
      action: 'bold',
      editor: {},
    })).toMatchObject({
      action: 'bold',
      forwarded: false,
      method: 'toggleBold',
    })
  })

  it('parses and asserts simulator log proofs for all native format commands', () => {
    const proofs = [
      ...nativeWysiwygFormatCommandProbeActions.map((action) => nativeWysiwygFormatCommandProof({
        action,
        editor: completeNativeEditorBridge(),
      })),
      ...nativeWysiwygFormatCommandEffectProbeActions.map((action) => nativeWysiwygFormatCommandProof({
        action,
        editor: completeNativeEditorBridge(),
        effectMarkdown: nativeWysiwygFormatCommandExpectedEffectMarkdown(action) ?? '',
      })),
    ]
    const logText = proofs.map(nativeWysiwygFormatCommandLogLine).join('\n')

    expect(parseNativeWysiwygFormatCommandProofs(logText)).toEqual(proofs)
    expect(assertNativeWysiwygFormatCommandProofs(proofs)).toEqual([])
  })

  it('defines a selected-text effect probe document for native command serialization', () => {
    expect(nativeWysiwygFormatCommandEffectProbeActions).toEqual([
      'bold',
      'italic',
      'strike',
      'code',
      'highlight',
      'heading2',
      'bulletList',
      'orderedList',
      'taskList',
      'quote',
    ])
    expect(nativeWysiwygFormatCommandEffectSelection()).toEqual({ from: 1, to: 10 })
    expect(nativeWysiwygFormatCommandEffectMarkdown(nativeWysiwygFormatCommandEffectContent())).toBe('Format me')
    expect(nativeWysiwygFormatCommandExpectedEffectMarkdown('bold')).toBe('**Format me**')
    expect(nativeWysiwygFormatCommandExpectedEffectMarkdown('tableAddRowAfter')).toBeNull()
  })

  it('reports missing and failed command proofs', () => {
    expect(formatNativeWysiwygFormatCommandFailures(assertNativeWysiwygFormatCommandProofs([]))).toContain('editor.wysiwyg.formatCommands')
    expect(assertNativeWysiwygFormatCommandProofs([
      nativeWysiwygFormatCommandProof({ action: 'bold', editor: {} }),
    ])).toEqual(expect.arrayContaining([
      {
        id: 'editor.wysiwyg.formatCommands.bold',
        message: 'Native WYSIWYG forwards bold to TenTap toggleBold',
      },
      {
        id: 'editor.wysiwyg.formatCommands.effect.bold',
        message: 'Native WYSIWYG bold command serializes back to desktop Markdown',
      },
      {
        id: 'editor.wysiwyg.formatCommands.heading2',
        message: 'Native WYSIWYG forwards heading2 to TenTap toggleHeading',
      },
    ]))
  })

  it('detects the native QA query flag', () => {
    expect(nativeWysiwygFormatCommandProbeEnabled(new globalThis.URLSearchParams('wysiwygFormatCommandProbe=1'))).toBe(true)
    expect(nativeWysiwygFormatCommandProbeEnabled(new globalThis.URLSearchParams('wysiwygFormatCommandProbe=0'))).toBe(false)
  })
})

function completeNativeEditorBridge() {
  return {
    addColumnAfter: () => undefined,
    addRowAfter: () => undefined,
    deleteColumn: () => undefined,
    deleteRow: () => undefined,
    lift: () => undefined,
    setLink: () => undefined,
    sink: () => undefined,
    toggleBlockquote: () => undefined,
    toggleBold: () => undefined,
    toggleBulletList: () => undefined,
    toggleCode: () => undefined,
    toggleHeading: () => undefined,
    toggleHighlight: () => undefined,
    toggleItalic: () => undefined,
    toggleOrderedList: () => undefined,
    toggleStrike: () => undefined,
    toggleTaskList: () => undefined,
  }
}
