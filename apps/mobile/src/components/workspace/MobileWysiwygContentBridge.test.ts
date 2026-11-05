import { describe, expect, it, vi } from 'vitest'
import { applyMobileWysiwygContentMessage } from './MobileWysiwygContentBridgeModel'

describe('mobile WYSIWYG content bridge', () => {
  it('hydrates editor content without emitting a user update', () => {
    const setContent = vi.fn(() => true)

    const handled = applyMobileWysiwygContentMessage({ commands: { setContent } }, {
      payload: { content: '<h1>Hydrated note</h1>' },
      type: 'mobile-set-content-silently',
    })

    expect(handled).toBe(true)
    expect(setContent).toHaveBeenCalledWith('<h1>Hydrated note</h1>', { emitUpdate: false })
  })

  it('ignores unrelated bridge messages', () => {
    const setContent = vi.fn(() => true)

    expect(applyMobileWysiwygContentMessage({ commands: { setContent } }, { type: 'other' })).toBe(false)
    expect(setContent).not.toHaveBeenCalled()
  })
})
