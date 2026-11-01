import { describe, expect, it } from 'vitest'
import {
  assertNativeTableOfContentsProofs,
  formatNativeTableOfContentsFailures,
  nativeTableOfContentsLogLine,
  nativeTableOfContentsProbeContent,
  nativeTableOfContentsProbeEnabled,
  nativeTableOfContentsScrollProof,
  parseNativeTableOfContentsProofs,
} from './nativeTableOfContentsProbe'

describe('native table of contents probe', () => {
  it('keeps the target heading tall but inside the rendered block budget', () => {
    const contentBeforeTarget = nativeTableOfContentsProbeContent().split('## Target Section')[0] ?? ''

    expect(contentBeforeTarget.match(/^Paragraph \d+/gmu)?.length).toBe(8)
    expect(contentBeforeTarget.length).toBeGreaterThan(2800)
  })

  it('builds a passing proof from native scroll positions', () => {
    const proof = nativeTableOfContentsScrollProof({
      afterY: 184,
      beforeY: 0,
      expectedY: 220,
      targetId: 'toc-heading-0',
    })

    expect(proof).toMatchObject({
      id: 'editor.tableOfContents.scroll',
      passed: true,
      targetId: 'toc-heading-0',
    })
  })

  it('parses and asserts simulator log proofs', () => {
    const proof = nativeTableOfContentsScrollProof({
      afterY: 184,
      beforeY: 0,
      expectedY: 220,
      targetId: 'toc-heading-0',
    })
    const proofs = parseNativeTableOfContentsProofs(nativeTableOfContentsLogLine(proof))

    expect(proofs).toEqual([proof])
    expect(assertNativeTableOfContentsProofs(proofs)).toEqual([])
  })

  it('ignores malformed simulator log lines', () => {
    expect(parseNativeTableOfContentsProofs('noise\nMEMORIA_MOBILE_TABLE_OF_CONTENTS_PROBE {bad json')).toEqual([])
  })

  it('reports missing or failed scroll proofs', () => {
    expect(formatNativeTableOfContentsFailures(assertNativeTableOfContentsProofs([]))).toContain('editor.tableOfContents.scroll')
    expect(assertNativeTableOfContentsProofs([
      nativeTableOfContentsScrollProof({
        afterY: 12,
        beforeY: 0,
        expectedY: 220,
        targetId: 'toc-heading-0',
      }),
    ])).toEqual([{
      id: 'editor.tableOfContents.scroll',
      message: 'Native table of contents scroll did not move far enough: before=0, after=12, expected=220.',
    }])
  })

  it('reads the URL query switch', () => {
    expect(nativeTableOfContentsProbeEnabled(new globalThis.URLSearchParams('tableOfContentsProbe=1'))).toBe(true)
    expect(nativeTableOfContentsProbeEnabled(new globalThis.URLSearchParams('tableOfContentsProbe=0'))).toBe(false)
  })
})
