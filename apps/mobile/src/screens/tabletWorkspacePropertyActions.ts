import type {
  MobilePropertyDisplayMode,
  MobilePropertyValue,
} from '../workspace/mobileWorkspaceModel'
import type { MobileWorkspaceEdit } from '../workspace/mobileWorkspaceEditing'
import {
  mobilePropertyDisplayModeFromValueKind,
  mobilePropertyValueFormText,
  mobilePropertyValueKind,
  mobilePropertyValueKindForKey,
  parseMobilePropertyValue,
} from '../workspace/mobilePropertyValues'
import type { TabletReadOnlyForm } from './tabletWorkspaceTypes'

type TabletReadOnlyFormField = {
  [Key in keyof TabletReadOnlyForm]: { key: Key; value: TabletReadOnlyForm[Key] }
}[keyof TabletReadOnlyForm]
type DeletePropertyEdit = Extract<MobileWorkspaceEdit, { type: 'deleteProperty' }>
type PropertyEditForm = Pick<TabletReadOnlyForm, 'propertyName' | 'propertyValue' | 'propertyValueKind'>

export function editPropertyFields(
  key: string,
  value: MobilePropertyValue,
  displayModes?: Record<string, MobilePropertyDisplayMode> | null,
): TabletReadOnlyFormField[] {
  return [
    { key: 'propertyName', value: key },
    { key: 'propertyValue', value: mobilePropertyValueFormText(value) },
    { key: 'propertyValueKind', value: mobilePropertyValueKind(key, value, displayModes) },
  ]
}

export function addPropertyFields(
  key?: string,
  displayModes?: Record<string, MobilePropertyDisplayMode> | null,
): TabletReadOnlyFormField[] {
  const propertyName = key ?? ''
  return [
    { key: 'propertyName', value: propertyName },
    { key: 'propertyValue', value: '' },
    { key: 'propertyValueKind', value: mobilePropertyValueKindForKey(propertyName, 'string', displayModes) },
  ]
}

export function propertyEditFromForm(form: PropertyEditForm, noteId: string): MobileWorkspaceEdit | null {
  const trimmedNoteId = noteId.trim()
  const key = form.propertyName.trim()
  if (!trimmedNoteId || !key) return null

  return {
    edits: [
      {
        key,
        noteId: trimmedNoteId,
        type: 'updateProperty',
        value: parseMobilePropertyValue({
          key,
          kind: form.propertyValueKind,
          valueText: form.propertyValue,
        }),
      },
      {
        key,
        mode: mobilePropertyDisplayModeFromValueKind(form.propertyValueKind),
        type: 'updatePropertyDisplayMode',
      },
    ],
    type: 'bulkEdit',
  }
}

export function deletePropertyEdit(noteId: string, key: string): DeletePropertyEdit | null {
  const trimmedNoteId = noteId.trim()
  const trimmedKey = key.trim()
  return trimmedNoteId && trimmedKey
    ? { key: trimmedKey, noteId: trimmedNoteId, type: 'deleteProperty' }
    : null
}
