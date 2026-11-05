import { describe, expect, it } from 'vitest'
import { MobileCodeBlockBridge } from './MobileWysiwygCodeBlockBridge'

describe('MobileCodeBlockBridge', () => {
  it('registers the block-level Tiptap codeBlock node that TenTap StarterKit omits', () => {
    expect(MobileCodeBlockBridge.name).toBe('codeBlock')
    expect(MobileCodeBlockBridge.tiptapExtension?.name).toBe('codeBlock')
  })

  it('uses text as the default code fence language for desktop-compatible insertion', () => {
    const extensions = MobileCodeBlockBridge.configureTiptapExtensionsOnRunTime(undefined, undefined)
    const codeBlockExtension = extensions.find((extension) => extension?.name === 'codeBlock')

    expect(codeBlockExtension?.options).toMatchObject({
      defaultLanguage: 'text',
      languageClassPrefix: 'language-',
    })
  })
})
