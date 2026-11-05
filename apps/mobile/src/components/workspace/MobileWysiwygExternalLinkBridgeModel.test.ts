import { describe, expect, it } from 'vitest'
import { nativeWysiwygDocumentWithoutExternalLink } from './MobileWysiwygExternalLinkBridgeModel'

describe('native WYSIWYG external link bridge model', () => {
  it('removes link marks from the selected text range', () => {
    expect(nativeWysiwygDocumentWithoutExternalLink({
      json: {
        content: [{
          content: [{
            marks: [{ attrs: { href: 'https://memoria.app/docs' }, type: 'link' }],
            text: 'Memoria',
            type: 'text',
          }, {
            marks: [{ attrs: { href: 'https://example.com' }, type: 'link' }],
            text: ' docs',
            type: 'text',
          }],
          type: 'paragraph',
        }],
        type: 'doc',
      },
      selection: { from: 1, to: 8 },
    })).toEqual({
      content: [{
        content: [{
          text: 'Memoria',
          type: 'text',
        }, {
          marks: [{ attrs: { href: 'https://example.com' }, type: 'link' }],
          text: ' docs',
          type: 'text',
        }],
        type: 'paragraph',
      }],
      type: 'doc',
    })
  })

  it('returns null when the selected range does not contain an external link mark', () => {
    expect(nativeWysiwygDocumentWithoutExternalLink({
      json: {
        content: [{
          content: [{ text: 'Memoria', type: 'text' }],
          type: 'paragraph',
        }],
        type: 'doc',
      },
      selection: { from: 1, to: 8 },
    })).toBeNull()
  })

  it('can remove all link marks when selection is unavailable', () => {
    expect(nativeWysiwygDocumentWithoutExternalLink({
      json: {
        content: [{
          content: [{
            marks: [{ attrs: { href: 'https://memoria.app/docs' }, type: 'link' }],
            text: 'Memoria',
            type: 'text',
          }],
          type: 'paragraph',
        }],
        type: 'doc',
      },
    })).toEqual({
      content: [{
        content: [{
          text: 'Memoria',
          type: 'text',
        }],
        type: 'paragraph',
      }],
      type: 'doc',
    })
  })
})
