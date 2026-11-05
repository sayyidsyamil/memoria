import { describe, expect, it } from 'vitest'
import {
  mobileMarkdownBodyToTentapHtml,
  tiptapJsonToMobileMarkdown,
  type TiptapJsonNode,
} from './mobileDocumentContent'

describe('mobile document inline images', () => {
  const inlineImageParagraph =
    'Sword shops ![front room](https://pbs.twimg.com/media/Ev3DbyOVEAQ7BxJ.png) ![](https://pbs.twimg.com/media/Ev3DhRkUcAIh2fC.png) (View Tweet)'

  it('hydrates inline markdown images as native TenTap image nodes inside paragraphs', () => {
    const html = mobileMarkdownBodyToTentapHtml(`${inlineImageParagraph}\n`)

    expect(html).toBe([
      '<p>Sword shops ',
      '<img src="https://pbs.twimg.com/media/Ev3DbyOVEAQ7BxJ.png" alt="front room">',
      ' ',
      '<img src="https://pbs.twimg.com/media/Ev3DhRkUcAIh2fC.png" alt="">',
      ' (View Tweet)</p>',
    ].join(''))
    expect(html).not.toContain('<a ')
  })

  it('hydrates inline image titles and angled attachment destinations', () => {
    const html = mobileMarkdownBodyToTentapHtml(
      'Diagram ![overview](<attachments/mobile diagram.png> "starter vault") after.\n',
    )

    expect(html).toBe(
      '<p>Diagram <img src="attachments/mobile diagram.png" alt="overview" title="starter vault"> after.</p>',
    )
  })

  it('does not hydrate image markdown inside code spans', () => {
    const html = mobileMarkdownBodyToTentapHtml('Literal `![overview](attachments/mobile.png)` after.\n')

    expect(html).toBe('<p>Literal <code>![overview](attachments/mobile.png)</code> after.</p>')
  })

  it('serializes inline image nodes as desktop markdown image source after native saves', () => {
    const document: TiptapJsonNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { text: 'Sword shops ', type: 'text' },
            {
              attrs: {
                alt: 'front room',
                src: 'https://pbs.twimg.com/media/Ev3DbyOVEAQ7BxJ.png',
              },
              type: 'image',
            },
            { text: ' ', type: 'text' },
            {
              attrs: { src: 'https://pbs.twimg.com/media/Ev3DhRkUcAIh2fC.png' },
              type: 'image',
            },
            { text: ' (View Tweet)', type: 'text' },
          ],
        },
      ],
    }

    expect(tiptapJsonToMobileMarkdown(document)).toBe(inlineImageParagraph)
  })

  it('serializes inline image title metadata inside paragraph nodes', () => {
    const document: TiptapJsonNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { text: 'Diagram ', type: 'text' },
            {
              attrs: {
                alt: 'overview',
                src: 'attachments/mobile diagram.png',
                title: 'starter vault',
              },
              type: 'image',
            },
            { text: ' after.', type: 'text' },
          ],
        },
      ],
    }

    expect(tiptapJsonToMobileMarkdown(document)).toBe(
      'Diagram ![overview](<attachments/mobile diagram.png> "starter vault") after.',
    )
  })
})
