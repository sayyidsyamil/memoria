import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  exportMobileNoteAsPdf,
  MOBILE_PDF_EXPORT_ATTEMPTS_GLOBAL_KEY,
  MOBILE_PDF_EXPORTS_GLOBAL_KEY,
  mobilePdfPayloadForNote,
  type MobilePdfExporter,
} from './mobilePdfExport'
import type { MobileNote } from './mobileWorkspaceModel'

describe('mobile PDF export', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, MOBILE_PDF_EXPORT_ATTEMPTS_GLOBAL_KEY)
    Reflect.deleteProperty(globalThis, MOBILE_PDF_EXPORTS_GLOBAL_KEY)
  })

  it('exports markdown body HTML without frontmatter', async () => {
    const exporter: MobilePdfExporter = vi.fn().mockResolvedValue({
      shared: true,
      uri: 'file:///cache/Research Plan.pdf',
    })

    const result = await exportMobileNoteAsPdf(noteFixture(), exporter)

    expect(result).toEqual({
      fileName: 'Research Plan.pdf',
      ok: true,
      shared: true,
      uri: 'file:///cache/Research Plan.pdf',
    })
    expect(exporter).toHaveBeenCalledOnce()

    const payload = vi.mocked(exporter).mock.calls[0]?.[0]
    expect(payload?.html).toContain('<h1>Research Plan</h1>')
    expect(payload?.html).toContain('<strong>writing</strong>')
    expect(payload?.html).not.toContain('type: Essay')
    expect(payload?.html).not.toContain('status: Draft')
    expect(globalValue(MOBILE_PDF_EXPORT_ATTEMPTS_GLOBAL_KEY)).toEqual([{
      fileName: 'Research Plan.pdf',
      noteId: 'research-plan',
      title: 'Research Plan',
    }])
    expect(globalValue(MOBILE_PDF_EXPORTS_GLOBAL_KEY)).toEqual([{
      fileName: 'Research Plan.pdf',
      ok: true,
      shared: true,
      uri: 'file:///cache/Research Plan.pdf',
    }])
  })

  it('uses editor blocks when raw markdown is not hydrated', () => {
    const payload = mobilePdfPayloadForNote(noteFixture({
      editorBlocks: [
        { kind: 'heading', level: 1, text: 'Draft Outline' },
        { content: [{ bold: true, text: 'First point' }], kind: 'paragraph' },
      ],
      path: 'Inbox/Draft Outline.md',
      rawContent: undefined,
      title: 'Draft Outline',
    }))

    expect(payload?.fileName).toBe('Draft Outline.pdf')
    expect(payload?.html).toContain('<h1>Draft Outline</h1>')
    expect(payload?.html).toContain('<strong>First point</strong>')
  })

  it('does not call the native exporter without a selected note', async () => {
    const exporter: MobilePdfExporter = vi.fn()

    await expect(exportMobileNoteAsPdf(null, exporter)).resolves.toEqual({
      ok: false,
      reason: 'missingNote',
    })

    expect(exporter).not.toHaveBeenCalled()
    expect(globalValue(MOBILE_PDF_EXPORT_ATTEMPTS_GLOBAL_KEY)).toBeUndefined()
  })
})

function noteFixture(overrides: Partial<MobileNote> = {}): MobileNote {
  return {
    archived: false,
    created: '5d ago',
    date: '5d ago',
    favorite: false,
    id: 'research-plan',
    links: 0,
    modified: '1h ago',
    path: 'Writing/Research Plan.md',
    rawContent: [
      '---',
      'type: Essay',
      'status: Draft',
      '---',
      '# Research Plan',
      '',
      'Memoria should keep **writing** visible.',
    ].join('\n'),
    relationships: [],
    snippet: 'Memoria should keep writing visible.',
    status: 'Draft',
    tags: ['Design'],
    title: 'Research Plan',
    type: 'Essay',
    typeTone: 'green',
    workspace: 'Memoria Vault',
    ...overrides,
  }
}

function globalValue(key: string): unknown {
  return (globalThis as Record<string, unknown>)[key]
}
