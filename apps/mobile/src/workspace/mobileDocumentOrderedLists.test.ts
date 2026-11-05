import { describe, expect, it } from 'vitest'
import {
  mobileMarkdownBodyToTentapHtml,
  tiptapJsonToMobileMarkdown,
  type TiptapJsonNode,
} from './mobileDocumentContent'

describe('mobile document ordered lists', () => {
  it('hydrates non-1 desktop ordered lists with their start number', () => {
    const html = mobileMarkdownBodyToTentapHtml('42. First retained rule\n43. Next retained rule\n')

    expect(html).toBe(
      '<ol start="42"><li><p>First retained rule</p></li><li><p>Next retained rule</p></li></ol>',
    )
  })

  it('keeps desktop ordered lists with paren markers editable as source', () => {
    const html = mobileMarkdownBodyToTentapHtml('1) Prioritize host serenity\n2) Invite close friends early\n')

    expect(html).toBe('<p>1) Prioritize host serenity<br>2) Invite close friends early</p>')
    expect(html).not.toContain('<ol')
  })

  it('keeps repeated one-marker ordered lists editable as source', () => {
    const html = mobileMarkdownBodyToTentapHtml('1. Create\n1. Learn\n1. Connect\n')

    expect(html).toBe('<p>1. Create<br>1. Learn<br>1. Connect</p>')
    expect(html).not.toContain('<ol')
  })

  it('serializes non-1 ordered lists back to desktop markdown', () => {
    const document: TiptapJsonNode = {
      type: 'doc',
      content: [
        {
          attrs: { start: 42 },
          type: 'orderedList',
          content: [
            { type: 'listItem', content: [paragraphNode('First retained rule')] },
            { type: 'listItem', content: [paragraphNode('Next retained rule')] },
          ],
        },
      ],
    }

    expect(tiptapJsonToMobileMarkdown(document)).toBe('42. First retained rule\n43. Next retained rule')
  })

  it('keeps ordered paren source lines after native saves', () => {
    const document: TiptapJsonNode = {
      type: 'doc',
      content: [
        paragraphNode('1) Prioritize host serenity', '2) Invite close friends early'),
      ],
    }

    expect(tiptapJsonToMobileMarkdown(document)).toBe(
      '1) Prioritize host serenity\n2) Invite close friends early',
    )
  })

  it('keeps repeated one-marker source lines after native saves', () => {
    const document: TiptapJsonNode = {
      type: 'doc',
      content: [
        paragraphNode('1. Create', '1. Learn', '1. Connect'),
      ],
    }

    expect(tiptapJsonToMobileMarkdown(document)).toBe('1. Create\n1. Learn\n1. Connect')
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
