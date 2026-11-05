import { describe, expect, it } from 'vitest'
import { nativeWysiwygDocumentWithInputTransforms } from '../workspace/mobileWysiwygInputTransforms'
import { nativeWysiwygDocumentWithInsertedPlainText } from '../components/workspace/MobileWysiwygWikilinkBridgeModel'
import {
  assertNativeWysiwygInputTransformProofs,
  formatNativeWysiwygInputTransformFailures,
  nativeWysiwygInputTransformLogLine,
  nativeWysiwygInputTransformProbeEnabled,
  nativeWysiwygInputTransformProbeSteps,
  nativeWysiwygInputTransformProof,
  parseNativeWysiwygInputTransformProofs,
} from './nativeWysiwygInputTransformProbe'

describe('native WYSIWYG input transform probe', () => {
  it('defines native editor transform steps for arrow, escaped arrow, highlight, and inline math input', () => {
    expect(nativeWysiwygInputTransformProbeSteps().map((step) => step.step)).toEqual([
      'arrow',
      'escapedArrow',
      'highlight',
      'inlineMath',
    ])
  })

  it('builds passing proofs from transformed native editor JSON', () => {
    const proofs = nativeWysiwygInputTransformProbeSteps().map((step) => {
      const jsonWithInput = nativeWysiwygDocumentWithInsertedPlainText({
        json: step.content,
        payload: { text: step.input },
        selection: step.selection,
      })
      expect(jsonWithInput).not.toBeNull()

      const json = nativeWysiwygDocumentWithInputTransforms({
        json: jsonWithInput,
        selection: {
          from: step.selection.from + step.input.length,
          to: step.selection.to + step.input.length,
        },
      })
      return nativeWysiwygInputTransformProof({
        json,
        mathInlineRendered: step.step === 'inlineMath',
        step: step.step,
        transformed: json !== null,
      })
    })

    expect(assertNativeWysiwygInputTransformProofs(proofs)).toEqual([])
  })

  it('parses simulator log proofs', () => {
    const proof = nativeWysiwygInputTransformProof({
      json: nativeWysiwygDocumentWithInputTransforms({
        json: nativeWysiwygInputTransformProbeSteps()[0].content,
        selection: nativeWysiwygInputTransformProbeSteps()[0].selection,
      }),
      step: 'arrow',
      transformed: true,
    })

    expect(parseNativeWysiwygInputTransformProofs(nativeWysiwygInputTransformLogLine(proof))).toEqual([proof])
  })

  it('reports missing native input transform proofs', () => {
    expect(formatNativeWysiwygInputTransformFailures(
      assertNativeWysiwygInputTransformProofs([]),
    )).toContain('editor.wysiwyg.inputTransform.arrow')
  })

  it('detects the native QA query flag', () => {
    expect(nativeWysiwygInputTransformProbeEnabled(new globalThis.URLSearchParams('wysiwygInputTransformProbe=1'))).toBe(true)
    expect(nativeWysiwygInputTransformProbeEnabled(new globalThis.URLSearchParams('wysiwygInputTransformProbe=0'))).toBe(false)
  })
})
