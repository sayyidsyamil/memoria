import { canonicalFrontmatterKey } from '../../../../src/utils/systemMetadata'
import { parseLocalVaultDocument } from './localVaultFrontmatter'
import type { MobileNote } from './mobileWorkspaceModel'

export function mobileSpreadsheetNeedsFallback(note: Pick<MobileNote, 'rawContent' | 'fileKind'>, mode: string): boolean {
  return mode !== 'source' && mobileNoteDisplaysAsSheet(note)
}

export function mobileNoteDisplaysAsSheet(note: Pick<MobileNote, 'rawContent' | 'fileKind'>): boolean {
  if (note.fileKind === 'binary') return false
  const { frontmatter } = parseLocalVaultDocument(note.rawContent ?? '')
  const metadata = new Map(Object.entries(frontmatter).map(([key, value]) => [canonicalFrontmatterKey(key), value]))
  const value = metadata.has('_display') ? metadata.get('_display') : metadata.get('_format')
  return typeof value === 'string' && value.trim().toLowerCase() === 'sheet'
}
