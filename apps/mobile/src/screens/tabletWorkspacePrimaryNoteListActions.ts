import type { MobileWorkspaceAction } from '../components/workspace/MobileWorkspaceActionSheet'
import type { MobileSidebarItemSelection } from '../components/workspace/MobileWorkspaceSidebar'
import type {
  MobileNote,
  MobileWorkspaceSnapshot,
} from '../workspace/mobileWorkspaceModel'
import type { MobileWorkspaceEdit } from '../workspace/mobileWorkspaceEditing'
import { mobileAllNotesFileVisibilityFromVaultConfig } from '../workspace/mobileVaultConfig'
import {
  mobileDefaultListPropertyDisplay,
  mobileListPropertySuggestions,
} from '../workspace/mobileWorkspaceSuggestions'
import type { TabletReadOnlyForm } from './tabletWorkspaceTypes'
import {
  notesForSidebarSelection,
  type TabletSidebarSelection,
} from './tabletWorkspaceNavigation'
import {
  primaryNoteListPropertiesEditFromForm,
  primaryNoteListTarget,
} from './tabletWorkspacePrimaryNoteListSave'

type ApplyWorkspaceEdit = (edit: MobileWorkspaceEdit) => void
type ReadOnlyFormUpdater = <Key extends keyof TabletReadOnlyForm>(key: Key, value: TabletReadOnlyForm[Key]) => void
type ReadOnlyFormField = {
  [Key in keyof TabletReadOnlyForm]: { key: Key; value: TabletReadOnlyForm[Key] }
}[keyof TabletReadOnlyForm]
type SetOpenAction = (action: MobileWorkspaceAction | null) => void

export function primaryNoteListWorkspaceActions({
  applyEdit,
  closeAction,
  readOnlyForm,
  suggestionsEnabled = true,
  updateReadOnlyForm,
  workspaceSnapshot,
}: {
  applyEdit: ApplyWorkspaceEdit
  closeAction: () => void
  readOnlyForm: TabletReadOnlyForm
  suggestionsEnabled?: boolean
  updateReadOnlyForm: ReadOnlyFormUpdater
  workspaceSnapshot: MobileWorkspaceSnapshot
}) {
  return {
    onPrimaryAllNotesShowImagesChange: (value: boolean) => updateReadOnlyForm('allNotesShowImages', value),
    onPrimaryAllNotesShowPdfsChange: (value: boolean) => updateReadOnlyForm('allNotesShowPdfs', value),
    onPrimaryAllNotesShowUnsupportedChange: (value: boolean) => updateReadOnlyForm('allNotesShowUnsupported', value),
    onPrimaryDisplayPropertiesChange: (value: string[]) => updateReadOnlyForm('primaryDisplayProperties', value),
    onPrimaryPropertyQueryChange: (value: string) => updateReadOnlyForm('primaryPropertyQuery', value),
    onSavePrimaryNoteListProperties: () => savePrimaryNoteListProperties({
      applyEdit,
      closeAction,
      readOnlyForm,
    }),
    primaryPropertyOptions: suggestionsEnabled ? mobileListPropertySuggestions(
      primaryNoteListPropertyNotes(readOnlyForm.primaryItemId, workspaceSnapshot),
      readOnlyForm.primaryPropertyQuery,
      workspaceSnapshot.typeDefinitions,
    ) : [],
  }
}

export function openPrimaryListProperties({
  selection,
  setOpenAction,
  snapshot,
  updateReadOnlyForm,
}: {
  selection: MobileSidebarItemSelection
  setOpenAction: SetOpenAction
  snapshot: MobileWorkspaceSnapshot
  updateReadOnlyForm: ReadOnlyFormUpdater
}) {
  if (!isCustomizablePrimaryItem(selection)) return

  openWorkspaceAction({
    action: 'editPrimaryListProperties',
    fields: primaryListPropertyFields(selection, snapshot),
    setOpenAction,
    updateReadOnlyForm,
  })
}

function savePrimaryNoteListProperties({
  applyEdit,
  closeAction,
  readOnlyForm,
}: {
  applyEdit: ApplyWorkspaceEdit
  closeAction: () => void
  readOnlyForm: TabletReadOnlyForm
}) {
  const edit = primaryNoteListPropertiesEditFromForm(readOnlyForm)
  if (!edit) return

  applyEdit(edit)
  closeAction()
}

function openWorkspaceAction({
  action,
  fields,
  setOpenAction,
  updateReadOnlyForm,
}: {
  action: MobileWorkspaceAction
  fields: ReadOnlyFormField[]
  setOpenAction: SetOpenAction
  updateReadOnlyForm: ReadOnlyFormUpdater
}) {
  for (const { key, value } of fields) updateReadOnlyForm(key, value)
  setOpenAction(action)
}

function primaryListPropertyFields(
  selection: MobileSidebarItemSelection,
  snapshot: MobileWorkspaceSnapshot,
): ReadOnlyFormField[] {
  const fileVisibility = mobileAllNotesFileVisibilityFromVaultConfig(snapshot.vaultConfig)
  return [
    { key: 'allNotesShowImages', value: selection.id === 'all-notes' && fileVisibility.images },
    { key: 'allNotesShowPdfs', value: selection.id === 'all-notes' && fileVisibility.pdfs },
    { key: 'allNotesShowUnsupported', value: selection.id === 'all-notes' && fileVisibility.unsupported },
    { key: 'primaryDisplayProperties', value: primaryDisplayPropertiesForEdit(selection, snapshot) },
    { key: 'primaryItemId', value: selection.id },
    { key: 'primaryPropertyQuery', value: '' },
  ]
}

function primaryDisplayPropertiesForEdit(
  selection: MobileSidebarItemSelection,
  snapshot: MobileWorkspaceSnapshot,
) {
  const customProperties = primaryDisplayPropertyOverride(selection.id, snapshot)
  if (customProperties.length > 0) return customProperties

  return mobileDefaultListPropertyDisplay(primaryNoteListPropertyNotes(selection.id, snapshot), snapshot.typeDefinitions)
}

function primaryDisplayPropertyOverride(itemId: string, snapshot: MobileWorkspaceSnapshot) {
  if (itemId === 'all-notes') return snapshot.noteListPropertyOverrides?.allNotes ?? []
  if (itemId === 'inbox') return snapshot.noteListPropertyOverrides?.inbox ?? []
  return []
}

function primaryNoteListPropertyNotes(itemId: string, snapshot: MobileWorkspaceSnapshot): MobileNote[] {
  const selection = primaryItemSelection(itemId)
  return selection ? notesForSidebarSelection(snapshot, selection) : []
}

function primaryItemSelection(itemId: string): TabletSidebarSelection | null {
  if (!primaryNoteListTarget(itemId)) return null

  return {
    id: itemId,
    kind: 'item',
    label: itemId === 'all-notes' ? 'All Notes' : 'Inbox',
    sectionId: 'primary',
  }
}

function isCustomizablePrimaryItem(selection: MobileSidebarItemSelection) {
  return selection.sectionId === 'primary' && primaryNoteListTarget(selection.id) !== null
}
