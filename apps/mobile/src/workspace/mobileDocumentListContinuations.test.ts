import { describe, expect, it } from 'vitest'
import {
  mobileMarkdownBodyToTentapHtml,
  tiptapJsonToMobileMarkdown,
  type TiptapJsonNode,
} from './mobileDocumentContent'

describe('mobile document list continuations', () => {
  it('hydrates list items with continuation lines as structured list item paragraphs', () => {
    const html = mobileMarkdownBodyToTentapHtml('- Provide instructions\n  Teach your AI agent the workflow context\n- Run workflow\n')

    expect(html).toBe(
      '<ul><li><p>Provide instructions</p><p>Teach your AI agent the workflow context</p></li><li><p>Run workflow</p></li></ul>',
    )
  })

  it('hydrates list items with image continuations as structured list item image paragraphs', () => {
    const html = mobileMarkdownBodyToTentapHtml('- Internet access\n  ![](https://example.com/search.png)\n')

    expect(html).toBe(
      '<ul><li><p>Internet access</p><p><img src="https://example.com/search.png" alt=""></p></li></ul>',
    )
  })

  it('serializes structured list item paragraphs as desktop markdown continuations after native saves', () => {
    const document: TiptapJsonNode = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                paragraphNode('Provide instructions'),
                paragraphNode('Teach your AI agent the workflow context'),
              ],
            },
            {
              type: 'listItem',
              content: [paragraphNode('Run workflow')],
            },
          ],
        },
      ],
    }

    expect(tiptapJsonToMobileMarkdown(document)).toBe(
      '- Provide instructions\n  Teach your AI agent the workflow context\n- Run workflow',
    )
  })

  it('serializes structured list item image paragraphs as desktop markdown continuations after native saves', () => {
    const document: TiptapJsonNode = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                paragraphNode('Internet access'),
                imageParagraphNode('https://example.com/search.png'),
              ],
            },
          ],
        },
      ],
    }

    expect(tiptapJsonToMobileMarkdown(document)).toBe(
      '- Internet access\n  ![](https://example.com/search.png)',
    )
  })
})

function paragraphNode(...lines: string[]): TiptapJsonNode {
  return {
    type: 'paragraph',
    content: lines.flatMap((line, index): TiptapJsonNode[] => [
      ...(index > 0 ? [{ type: 'hardBreak' }] : []),
      ...(line ? [{ text: line, type: 'text' }] : []),
    ]),
  }
}

function imageParagraphNode(src: string): TiptapJsonNode {
  return {
    type: 'paragraph',
    content: [{ attrs: { src }, type: 'image' }],
  }
}
