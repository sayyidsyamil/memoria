import { describe, expect, it } from 'vitest'
import {
  mobileAttachmentUriForHref,
  mobileHtmlWithResolvedAttachmentUris,
  mobilePortableAttachmentHref,
  mobilePortableAttachmentPath,
  mobileResolvedAttachmentHref,
} from './mobileAttachmentUris'

describe('mobile attachment URIs', () => {
  it('resolves portable attachment references against the active native vault root', () => {
    expect(mobileAttachmentUriForHref('attachments/project brief.pdf', 'file:///vault/root/')).toBe(
      'file:///vault/root/attachments/project%20brief.pdf',
    )
  })

  it('accepts desktop angle-wrapped markdown destinations', () => {
    expect(mobilePortableAttachmentPath('<attachments/mobile diagram.png>')).toBe('attachments/mobile diagram.png')
  })

  it('rejects unsafe attachment paths instead of escaping the active vault root', () => {
    expect(mobileAttachmentUriForHref('attachments/../secret.pdf', 'file:///vault/root/')).toBeNull()
    expect(mobileAttachmentUriForHref('attachments//secret.pdf', 'file:///vault/root/')).toBeNull()
  })

  it('keeps external links untouched while resolving attachment links for native HTML', () => {
    const html = [
      '<p><a href="attachments/project brief.pdf">project brief.pdf</a></p>',
      '<img src="attachments/mobile diagram.png" alt="diagram">',
      '<p><a href="https://example.com">web</a></p>',
    ].join('\n')

    expect(mobileHtmlWithResolvedAttachmentUris(html, 'file:///vault/root/')).toBe([
      '<p><a href="file:///vault/root/attachments/project%20brief.pdf">project brief.pdf</a></p>',
      '<img src="file:///vault/root/attachments/mobile%20diagram.png" alt="diagram">',
      '<p><a href="https://example.com">web</a></p>',
    ].join('\n'))
  })

  it('converts native attachment URIs back to portable markdown references', () => {
    expect(mobilePortableAttachmentHref(
      'file:///vault/root/attachments/project%20brief.pdf',
      'file:///vault/root/',
    )).toBe('attachments/project brief.pdf')
  })

  it('does not rewrite file URIs outside the active vault', () => {
    expect(mobilePortableAttachmentHref(
      'file:///other/root/attachments/project%20brief.pdf',
      'file:///vault/root/',
    )).toBe('file:///other/root/attachments/project%20brief.pdf')
  })

  it('leaves portable references unresolved until a native vault root exists', () => {
    expect(mobileResolvedAttachmentHref('attachments/project brief.pdf')).toBe('attachments/project brief.pdf')
  })
})
