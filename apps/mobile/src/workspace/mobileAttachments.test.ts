import { describe, expect, it } from 'vitest'
import {
  isMobileImageAttachment,
  mobileAttachmentMarkdown,
  mobileAttachmentRelativePath,
  safeMobileAttachmentFileName,
  uniqueMobileAttachmentFileName,
} from './mobileAttachments'

describe('mobile attachments', () => {
  it('sanitizes attachment filenames with the same conservative shape as desktop vault imports', () => {
    expect(safeMobileAttachmentFileName('project brief (final).pdf')).toBe('project_brief_final_.pdf')
    expect(safeMobileAttachmentFileName('../secret.png')).toBe('_secret.png')
    expect(safeMobileAttachmentFileName('   ')).toBe('attachment')
  })

  it('builds unique timestamp-prefixed attachment names', () => {
    expect(uniqueMobileAttachmentFileName({
      existingNames: ['42-project.pdf'],
      name: 'project.pdf',
      nowMs: 42.8,
    })).toBe('42-2-project.pdf')
  })

  it('keeps attachment paths portable inside the vault', () => {
    expect(mobileAttachmentRelativePath('42-project.pdf')).toBe('attachments/42-project.pdf')
  })

  it('serializes image attachments as Markdown images and other files as links', () => {
    expect(mobileAttachmentMarkdown({
      mimeType: 'image/png',
      name: 'mobile diagram.png',
      path: 'attachments/mobile diagram.png',
    })).toBe('![mobile diagram.png](<attachments/mobile diagram.png>)')

    expect(mobileAttachmentMarkdown({
      mimeType: 'application/pdf',
      name: 'project brief.pdf',
      path: 'attachments/project brief.pdf',
    })).toBe('[project brief.pdf](<attachments/project brief.pdf>)')
  })

  it('detects images by MIME type or extension', () => {
    expect(isMobileImageAttachment({ mimeType: null, name: 'photo.JPG', path: 'attachments/photo.JPG' })).toBe(true)
    expect(isMobileImageAttachment({ mimeType: 'image/heic', name: 'photo', path: 'attachments/photo' })).toBe(true)
    expect(isMobileImageAttachment({ mimeType: 'application/pdf', name: 'brief.pdf', path: 'attachments/brief.pdf' })).toBe(false)
  })
})
