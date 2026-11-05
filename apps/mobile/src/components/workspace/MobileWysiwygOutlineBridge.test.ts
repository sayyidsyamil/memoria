import { describe, expect, it } from 'vitest'
import { mobileWysiwygOutlineHeadingIndex, MobileWysiwygOutlineBridge } from './MobileWysiwygOutlineBridge'

describe('MobileWysiwygOutlineBridge', () => {
  it('registers a dedicated TenTap bridge extension', () => {
    expect(MobileWysiwygOutlineBridge.name).toBe('mobileOutline')
    expect(MobileWysiwygOutlineBridge.tiptapExtension.name).toBe('mobileOutline')
  })

  it('maps table-of-contents indices after the duplicate document title', () => {
    expect(
      mobileWysiwygOutlineHeadingIndex({
        documentTitle: 'Document title',
        headings: [
          { level: 1, title: 'Document title' },
          { level: 2, title: 'First section' },
          { level: 3, title: 'Nested section' },
        ],
        target: { id: 'toc-heading-1', level: 3, title: 'Nested section' },
      }),
    ).toBe(2)
  })

  it('maps the table-of-contents root back to the document title', () => {
    expect(
      mobileWysiwygOutlineHeadingIndex({
        documentTitle: 'Document title',
        headings: [{ level: 1, title: 'Document title' }],
        target: { id: 'toc-title', level: 1, title: 'Document title' },
      }),
    ).toBe(0)
  })

  it('rejects stale outline targets instead of scrolling to the wrong heading', () => {
    expect(
      mobileWysiwygOutlineHeadingIndex({
        documentTitle: 'Document title',
        headings: [{ level: 2, title: 'Current section' }],
        target: { id: 'toc-heading-0', level: 2, title: 'Old section' },
      }),
    ).toBeNull()
  })
})
