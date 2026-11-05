import { describe, expect, it } from 'vitest'
import { tiptapJsonToMobileMarkdown, type TiptapJsonNode } from './mobileDocumentContent'

describe('mobile document plain URLs', () => {
  it('keeps bare URL punctuation unchanged after native saves', () => {
    const plainUrl =
      'URL: https://example.com/path_with_value?utm_source=mobile_editor&token=a*b'
    const document = paragraphDocument(plainUrl)

    expect(tiptapJsonToMobileMarkdown(document)).toBe(plainUrl)
  })

  it('keeps bare email punctuation unchanged after native saves', () => {
    const paragraph = 'Contact luca_rossi+mobile@example.com for context.'
    const document = paragraphDocument(paragraph)

    expect(tiptapJsonToMobileMarkdown(document)).toBe(paragraph)
  })
})

function paragraphDocument(text: string): TiptapJsonNode {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ text, type: 'text' }],
      },
    ],
  }
}
