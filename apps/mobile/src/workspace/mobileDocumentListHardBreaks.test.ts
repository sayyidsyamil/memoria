import { describe, expect, it } from 'vitest'
import {
  mobileMarkdownBodyToTentapHtml,
  tiptapJsonToMobileMarkdown,
  type TiptapJsonNode,
} from './mobileDocumentContent'

describe('mobile document list hard breaks', () => {
  it('hydrates list items with two-space hard breaks as structured list item breaks', () => {
    const html = mobileMarkdownBodyToTentapHtml('- Awesome CursorRules  \n- Project rules\n')

    expect(html).toBe('<ul><li><p>Awesome CursorRules<br></p></li><li><p>Project rules</p></li></ul>')
  })

  it('keeps list items with backslash hard breaks editable as source', () => {
    const html = mobileMarkdownBodyToTentapHtml('- positive camber = top of tire closer\\\n- negative camber = top farther\n')

    expect(html).toBe('<p>- positive camber = top of tire closer\\<br>- negative camber = top farther</p>')
    expect(html).not.toContain('<ul>')
  })

  it('serializes structured list item hard breaks as desktop two-space markdown after native saves', () => {
    const document: TiptapJsonNode = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [paragraphNode('Awesome CursorRules', { trailingHardBreak: true })],
            },
            {
              type: 'listItem',
              content: [paragraphNode('Project rules')],
            },
          ],
        },
      ],
    }

    expect(tiptapJsonToMobileMarkdown(document)).toBe('- Awesome CursorRules  \n- Project rules')
  })
})

function paragraphNode(
  lines: string | string[],
  options: { trailingHardBreak?: boolean } = {},
): TiptapJsonNode {
  const resolvedLines = Array.isArray(lines) ? lines : [lines]
  return {
    type: 'paragraph',
    content: [
      ...resolvedLines.flatMap((line, index): TiptapJsonNode[] => [
        ...(index > 0 ? [{ type: 'hardBreak' }] : []),
        ...(line ? [{ text: line, type: 'text' }] : []),
      ]),
      ...(options.trailingHardBreak ? [{ type: 'hardBreak' }] : []),
    ],
  }
}
