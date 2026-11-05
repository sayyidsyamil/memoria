import { mobileFilePreviewKind } from './mobileNoteFilters'
import { buildMobileFilePathForRelativePath } from './mobileNoteFilePath'
import type { MobileNote } from './mobileWorkspaceModel'

type PreviewNote = Pick<MobileNote, 'id' | 'path' | 'fileKind'>

export function mobileFilePreviewSource(note: PreviewNote, vaultRootUri?: string | null) {
  if (!vaultRootUri?.startsWith('file:///')) return null
  const path = note.path ?? note.id
  const kind = mobileFilePreviewKind({ ...note, title: path })
  if (!kind) return null
  const source = buildMobileFilePathForRelativePath({ path, vaultRootUri })
  return source.ok ? { kind, uri: source.path } : null
}
