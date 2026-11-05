import { expect, it } from 'vitest'
import { mobileNoteDisplaysAsSheet, mobileSpreadsheetNeedsFallback } from './mobileSpreadsheetFormat'

it('allows raw editing but never mounts a rich editor for a spreadsheet', () => {
  const note = { rawContent: '---\n_display: sheet\n---\na,b' }
  expect(mobileSpreadsheetNeedsFallback(note, 'source')).toBe(false)
  expect(mobileSpreadsheetNeedsFallback(note, 'wysiwyg')).toBe(true)
  expect(mobileSpreadsheetNeedsFallback({ rawContent: '# Text' }, 'wysiwyg')).toBe(false)
})

it('recognizes the desktop sheet display metadata without changing the document', () => {
  const rawContent = '---\ntype: Project\n_display: sheet\n_sheet:\n  frozen_rows: 1\n---\nName,Value\nTotal,=SUM(B1:B2)\n'
  expect(mobileNoteDisplaysAsSheet({ rawContent, fileKind: 'markdown' })).toBe(true)
  expect(rawContent).toContain('Total,=SUM(B1:B2)\n')
})

it('normalizes metadata spelling and supports the legacy format key', () => {
  for (const metadata of ['_display: " Sheet "', '_DISPLAY: SHEET', '_format: sheet']) {
    expect(mobileNoteDisplaysAsSheet({ rawContent: `---\n${metadata}\n---\na,b` })).toBe(true)
  }
})

it('lets explicit display metadata override the legacy format', () => {
  for (const metadata of ['_display: text\n_format: sheet', '_format: sheet\n_display: text']) {
    expect(mobileNoteDisplaysAsSheet({ rawContent: `---\n${metadata}\n---\na,b` })).toBe(false)
  }
})

it('does not infer spreadsheets from titles, body text or binary files', () => {
  for (const rawContent of [undefined, '', '# Sheet\na,b', '_display: sheet', '---\n_display: [sheet, text]\n---\na,b']) {
    expect(mobileNoteDisplaysAsSheet({ rawContent })).toBe(false)
  }
  expect(mobileNoteDisplaysAsSheet({ rawContent: '---\n_display: sheet\n---\na,b', fileKind: 'binary' })).toBe(false)
})
