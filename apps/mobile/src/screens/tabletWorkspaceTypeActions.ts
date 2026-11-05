import type { MobileNote, MobileSidebarIcon, MobileTone, MobileTypeDefinitions, MobileWorkspaceSnapshot } from '../workspace/mobileWorkspaceModel'
import type { MobileWorkspaceEdit } from '../workspace/mobileWorkspaceEditing'
import { removeTypeSchemaPropertyAt, removeTypeSchemaRelationshipAt } from '../workspace/mobileTypeDefinitionSchema'
import type { TabletReadOnlyForm } from './tabletWorkspaceTypes'
import { addTypeSchemaPropertyFormValue, addTypeSchemaRelationshipFormValue, typeSchemaSourceNote } from './tabletWorkspaceTypeSchemaActions'
import { typeSectionSuggestionOptions } from './tabletWorkspaceTypeSectionSuggestions'
import { toggleTypeVisibilityEdit, typeDefinitionSaveEdit } from './tabletWorkspaceTypeDefinitionSave'
import { deleteTypeDefinitionEdit } from './tabletWorkspaceSidebarEditActions'
import type { WorkspaceActionsContext, ReadOnlyFormUpdater } from './tabletWorkspaceController.types'
import { workspaceNotes, applyNonEmptyStringEdit, moveWorkspaceSidebarItem } from './tabletWorkspaceActionForms'

export function typeSectionWorkspaceActions({
  applyEdit,
  closeAction,
  openAction,
  readOnlyForm,
  updateReadOnlyForm,
  workspaceSnapshot,
}: Pick<WorkspaceActionsContext, 'applyEdit' | 'closeAction' | 'openAction' | 'readOnlyForm' | 'updateReadOnlyForm' | 'workspaceSnapshot'>) {
  const notes = workspaceNotes(workspaceSnapshot)
  const sourceNote = typeSchemaSourceNote(workspaceSnapshot, readOnlyForm.typeName)

  return {
    canDeleteType: Boolean(workspaceSnapshot.typeDefinitions?.[readOnlyForm.typeName]),
    canMoveTypeDown: canMoveTypeSection(workspaceSnapshot, readOnlyForm.typeName, 'down'),
    canMoveTypeUp: canMoveTypeSection(workspaceSnapshot, readOnlyForm.typeName, 'up'),
    onDeleteType: () => applyNonEmptyStringEdit({
      applyEdit,
      closeAction,
      toEdit: deleteTypeDefinitionEdit,
      value: readOnlyForm.typeName,
    }),
    onMoveTypeDown: () => moveWorkspaceSidebarItem({ applyEdit, direction: 'down', itemId: readOnlyForm.typeName, kind: 'typeSection' }),
    onMoveTypeUp: () => moveWorkspaceSidebarItem({ applyEdit, direction: 'up', itemId: readOnlyForm.typeName, kind: 'typeSection' }),
    onSaveTypeDefinition: () => updateTypeDefinition({
      applyEdit,
      closeAction,
      form: readOnlyForm,
      workspaceSnapshot,
    }),
    onTypeDisplayPropertiesChange: (value: string[]) => updateReadOnlyForm('typeDisplayProperties', value),
    onTypePropertyQueryChange: (value: string) => updateReadOnlyForm('typePropertyQuery', value),
    ...typeSectionSchemaWorkspaceActions({
      notes,
      readOnlyForm,
      sourceNote,
      updateReadOnlyForm,
    }),
    onTypeRenameNameChange: (value: string) => updateReadOnlyForm('typeRenameName', value),
    onTypeSectionLabelChange: (value: string) => updateReadOnlyForm('typeSectionLabel', value),
    onTypeSortChange: (value: string) => updateReadOnlyForm('typeSort', value),
    onTypeTemplateChange: (value: string) => updateReadOnlyForm('typeTemplate', value),
    onTypeIconChange: (value: MobileSidebarIcon) => updateReadOnlyForm('typeIcon', value),
    onTypeToneChange: (value: MobileTone) => updateReadOnlyForm('typeTone', value),
    onTypeVisibleChange: (value: boolean) => updateReadOnlyForm('typeVisible', value),
    onToggleTypeVisibility: (typeName: string) => toggleTypeVisibility({
      applyEdit,
      typeDefinitions: workspaceSnapshot.typeDefinitions,
      typeName,
    }),
    ...typeSectionSuggestionOptions({
      enabled: openAction === 'editTypeSection',
      notes,
      readOnlyForm,
      sourceNote,
      workspaceSnapshot,
    }),
  }
}

export function typeSectionSchemaWorkspaceActions({
  notes,
  readOnlyForm,
  sourceNote,
  updateReadOnlyForm,
}: {
  notes: MobileNote[]
  readOnlyForm: TabletReadOnlyForm
  sourceNote: MobileNote | null
  updateReadOnlyForm: ReadOnlyFormUpdater
}) {
  return {
    onTypeSchemaPropertyAdd: () => addTypeSchemaPropertyFormValue({ form: readOnlyForm, updateReadOnlyForm }),
    onTypeSchemaPropertyNameChange: (value: string) => updateReadOnlyForm('typeSchemaPropertyName', value),
    onTypeSchemaPropertyRemove: (index: number) => updateReadOnlyForm('typeSchemaProperties', removeTypeSchemaPropertyAt(readOnlyForm.typeSchemaProperties, index)),
    onTypeSchemaPropertyValueChange: (value: string) => updateReadOnlyForm('typeSchemaPropertyValue', value),
    onTypeSchemaRelationshipAdd: () => addTypeSchemaRelationshipFormValue({
      form: readOnlyForm,
      notes,
      sourceNote,
      updateReadOnlyForm,
    }),
    onTypeSchemaRelationshipNameChange: (value: string) => updateReadOnlyForm('typeSchemaRelationshipName', value),
    onTypeSchemaRelationshipRemove: (index: number) => updateReadOnlyForm('typeSchemaRelationships', removeTypeSchemaRelationshipAt(readOnlyForm.typeSchemaRelationships, index)),
    onTypeSchemaRelationshipTargetSelect: (title: string, ref: string) => {
      updateReadOnlyForm('typeSchemaRelationshipTarget', title)
      updateReadOnlyForm('typeSchemaRelationshipTargetRef', ref)
    },
    onTypeSchemaRelationshipTargetChange: (value: string) => {
      updateReadOnlyForm('typeSchemaRelationshipTarget', value)
      updateReadOnlyForm('typeSchemaRelationshipTargetRef', '')
    },
  }
}

export function updateTypeDefinition({
  applyEdit,
  closeAction,
  form,
  workspaceSnapshot,
}: {
  applyEdit: (edit: MobileWorkspaceEdit) => void
  closeAction: () => void
  form: TabletReadOnlyForm
  workspaceSnapshot: MobileWorkspaceSnapshot
}) {
  const edit = typeDefinitionSaveEdit(form, workspaceSnapshot.typeDefinitions)
  if (!edit) return

  applyEdit(edit)
  closeAction()
}

export function toggleTypeVisibility({
  applyEdit,
  typeDefinitions,
  typeName,
}: {
  applyEdit: (edit: MobileWorkspaceEdit) => void
  typeDefinitions: MobileTypeDefinitions | undefined
  typeName: string
}) {
  const edit = toggleTypeVisibilityEdit(typeName, typeDefinitions)
  if (edit) applyEdit(edit)
}

export function canMoveTypeSection(
  snapshot: MobileWorkspaceSnapshot,
  typeName: string,
  direction: 'down' | 'up',
) {
  const items = snapshot.sidebarSections.find((section) => section.id === 'types')?.items ?? []
  const typeItems = items.filter((item) => item.typeName)
  const sourceIndex = typeItems.findIndex((item) => item.typeName === typeName)
  const targetIndex = direction === 'up' ? sourceIndex - 1 : sourceIndex + 1
  return sourceIndex !== -1 && targetIndex >= 0 && targetIndex < typeItems.length
}
