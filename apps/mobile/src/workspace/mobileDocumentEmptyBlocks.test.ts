import { describe, expect, it } from 'vitest'
import {
  mobileMarkdownBodyToTentapHtml,
  tiptapJsonToMobileMarkdown,
  type TiptapJsonNode,
} from './mobileDocumentContent'

describe('mobile document empty markdown blocks', () => {
  it('hydrates empty desktop headings as heading blocks', () => {
    const html = mobileMarkdownBodyToTentapHtml('## \n\n###\n\nDone\n')

    expect(html).toBe('<h2></h2>\n<h3></h3>\n<p>Done</p>')
  })

  it('hydrates empty desktop list items as list blocks', () => {
    const bulletHtml = mobileMarkdownBodyToTentapHtml('- \n- Next\n')
    const orderedHtml = mobileMarkdownBodyToTentapHtml('1.  \n2. Next\n')

    expect(bulletHtml).toBe('<ul><li><p></p></li><li><p>Next</p></li></ul>')
    expect(orderedHtml).toBe('<ol><li><p></p></li><li><p>Next</p></li></ol>')
  })

  it('hydrates blank desktop blockquotes as blockquote blocks', () => {
    const html = mobileMarkdownBodyToTentapHtml('> \n\nDone\n')

    expect(html).toBe('<blockquote><p></p></blockquote>\n<p>Done</p>')
  })

  it('serializes empty heading and list blocks back to desktop markdown', () => {
    const document: TiptapJsonNode = {
      type: 'doc',
      content: [
        { attrs: { level: 2 }, type: 'heading' },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [paragraphNode()] },
            { type: 'listItem', content: [paragraphNode('Next')] },
          ],
        },
        {
          type: 'orderedList',
          content: [
            { type: 'listItem', content: [paragraphNode()] },
            { type: 'listItem', content: [paragraphNode('Next')] },
          ],
        },
      ],
    }

    expect(tiptapJsonToMobileMarkdown(document)).toBe(['##', '', '- ', '- Next', '', '1. ', '2. Next'].join('\n'))
  })

  it('serializes blank blockquote blocks back to desktop markdown', () => {
    const document: TiptapJsonNode = {
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [paragraphNode()],
        },
      ],
    }

    expect(tiptapJsonToMobileMarkdown(document)).toBe('>')
  })
})

function paragraphNode(text?: string): TiptapJsonNode {
  return {
    type: 'paragraph',
    content: text ? [{ text, type: 'text' }] : [],
  }
}
