import type { MobileTypeDefinitions } from '../workspace/mobileWorkspaceModel'
import { pluralizeType } from '../../../../src/shared/typeLabels'
import { mobileToneFromValue } from '../workspace/mobileWorkspaceMetadata'
import {
  normalizedDisplayProperties,
  type MobileWorkspaceEdit,
} from '../workspace/mobileWorkspaceEditing'
import { typeDefinitionSchemaPatch } from '../workspace/mobileTypeDefinitionSchema'
import {
  canRenameMobileTypeDefinition,
  mobileTypeRenameTargetName,
} from '../workspace/mobileWorkspaceTypeRename'
import type { TabletReadOnlyForm } from './tabletWorkspaceTypes'

type TypeDefinitionSaveForm = Pick<
  TabletReadOnlyForm,
  | 'typeDisplayProperties'
  | 'typeIcon'
  | 'typeName'
  | 'typeRenameName'
  | 'typeSchemaProperties'
  | 'typeSchemaRelationships'
  | 'typeSectionLabel'
  | 'typeSort'
  | 'typeTemplate'
  | 'typeTone'
  | 'typeVisible'
>
type CreateTypeDefinitionEdit = Extract<MobileWorkspaceEdit, { type: 'createTypeDefinition' }>
type UpdateTypeDefinitionEdit = Extract<MobileWorkspaceEdit, { type: 'updateTypeDefinition' }>
type RenameTypeDefinitionEdit = Extract<MobileWorkspaceEdit, { type: 'renameTypeDefinition' }>

export function createTypeDefinitionEdit(typeName: string): CreateTypeDefinitionEdit | null {
  const trimmedTypeName = typeName.trim()
  return trimmedTypeName ? { type: 'createTypeDefinition', typeName: trimmedTypeName } : null
}

export function typeDefinitionSaveEdit(
  form: TypeDefinitionSaveForm,
  typeDefinitions: MobileTypeDefinitions | undefined,
): MobileWorkspaceEdit | null {
  const typeName = form.typeName.trim()
  const nextTypeName = mobileTypeRenameTargetName(form.typeRenameName)
  if (!typeName || !nextTypeName) return null
  if (!canRenameMobileTypeDefinition(typeDefinitions, typeName, nextTypeName)) return null

  const rename: RenameTypeDefinitionEdit = { nextTypeName, type: 'renameTypeDefinition', typeName }
  const patch = {
    ...typeAppearancePatch(form),
    label: typeRenamePatchLabel(form, rename),
    listPropertiesDisplay: normalizedDisplayProperties(form.typeDisplayProperties),
    ...typeDefinitionSchemaPatch(form.typeSchemaProperties, form.typeSchemaRelationships),
    sort: form.typeSort,
    template: form.typeTemplate,
    visible: form.typeVisible ? null : false,
  }
  const edits: MobileWorkspaceEdit[] = renamedTypeName(rename)
    ? [
      rename,
      { patch, type: 'updateTypeDefinition', typeName: nextTypeName },
    ]
    : [{ patch, type: 'updateTypeDefinition', typeName }]

  return edits.length === 1 ? edits[0] : { edits, type: 'bulkEdit' }
}

export function toggleTypeVisibilityEdit(
  typeName: string,
  typeDefinitions: MobileTypeDefinitions | undefined,
): UpdateTypeDefinitionEdit | null {
  const trimmedTypeName = typeName.trim()
  const definition = trimmedTypeName ? typeDefinitions?.[trimmedTypeName] : undefined
  if (!definition) return null

  return {
    patch: { visible: definition.visible === false ? null : false },
    type: 'updateTypeDefinition',
    typeName: trimmedTypeName,
  }
}

function typeRenamePatchLabel(form: TypeDefinitionSaveForm, rename: RenameTypeDefinitionEdit): string | null {
  if (renamedTypeName(rename) && isDefaultTypeSectionLabel(form)) {
    return null
  }

  return form.typeSectionLabel
}

function renamedTypeName({ typeName, nextTypeName }: RenameTypeDefinitionEdit): boolean {
  return normalizedLabel(typeName) !== normalizedLabel(nextTypeName)
}

function isDefaultTypeSectionLabel(form: TypeDefinitionSaveForm): boolean {
  return normalizedLabel(form.typeSectionLabel) === normalizedLabel(pluralizeType(form.typeName.trim()))
}

function typeAppearancePatch(form: TypeDefinitionSaveForm) {
  return {
    color: form.typeTone.trim() || null,
    icon: form.typeIcon.trim() || null,
    tone: mobileToneFromValue(form.typeTone, 'gray'),
  }
}

function normalizedLabel(value: string) {
  return value.trim().toLowerCase()
}
