import type { MobileEditorBlock, MobileNote } from './mobileWorkspaceModel'

export function selectedMobileEditorBlocks(
  selectedNote: MobileNote | null,
  fallbackBlocks: MobileEditorBlock[],
) {
  if (!selectedNote?.editorBlocks) return fallbackBlocks
  return selectedNote.rawContent !== undefined && selectedNote.editorBlocks.length === 0
    ? fallbackBlocks
    : selectedNote.editorBlocks
}

export function selectedMobileEditorBullets(
  selectedNote: MobileNote | null,
  fallbackBullets: string[],
) {
  if (!selectedNote?.editorBullets) return fallbackBullets
  return selectedNote.rawContent !== undefined && selectedNote.editorBullets.length === 0
    ? fallbackBullets
    : selectedNote.editorBullets
}
