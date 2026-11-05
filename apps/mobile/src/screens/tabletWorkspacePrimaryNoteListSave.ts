import {
  normalizedDisplayProperties,
  type MobileWorkspaceEdit,
} from '../workspace/mobileWorkspaceEditing'
import type { MobileAllNotesFileVisibility } from '../workspace/mobileWorkspaceModel'
import type { TabletReadOnlyForm } from './tabletWorkspaceTypes'

type PrimaryNoteListPropertiesEdit = Extract<MobileWorkspaceEdit, { type: 'updatePrimaryNoteListProperties' }>
type PrimaryNoteListPropertiesForm = Pick<
  TabletReadOnlyForm,
  | 'allNotesShowImages'
  | 'allNotesShowPdfs'
  | 'allNotesShowUnsupported'
  | 'primaryDisplayProperties'
  | 'primaryItemId'
>

export function primaryNoteListPropertiesEditFromForm(
  form: PrimaryNoteListPropertiesForm,
): PrimaryNoteListPropertiesEdit | null {
  const target = primaryNoteListTarget(form.primaryItemId)
  if (!target) return null

  return {
    allNotesFileVisibility: allNotesFileVisibilityForSave(form),
    listPropertiesDisplay: normalizedDisplayProperties(form.primaryDisplayProperties),
    target,
    type: 'updatePrimaryNoteListProperties',
  }
}

export function primaryNoteListTarget(itemId: string): 'allNotes' | 'inbox' | null {
  if (itemId === 'all-notes') return 'allNotes'
  if (itemId === 'inbox') return 'inbox'
  return null
}

function allNotesFileVisibilityForSave(
  form: PrimaryNoteListPropertiesForm,
): MobileAllNotesFileVisibility | undefined {
  if (form.primaryItemId !== 'all-notes') return undefined

  return {
    images: form.allNotesShowImages,
    pdfs: form.allNotesShowPdfs,
    unsupported: form.allNotesShowUnsupported,
  }
}
