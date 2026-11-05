import type { MobileTypeDefinitions } from '../workspace/mobileWorkspaceModel'
import {
  typeSchemaPropertiesForForm,
  typeSchemaRelationshipsForForm,
} from '../workspace/mobileTypeDefinitionSchema'
import type { TabletReadOnlyForm } from './tabletWorkspaceTypes'

export type ReadOnlyFormField = {
  [Key in keyof TabletReadOnlyForm]: { key: Key; value: TabletReadOnlyForm[Key] }
}[keyof TabletReadOnlyForm]

export function typeDefinitionFields({
  definition,
  label,
  typeName,
}: {
  definition: MobileTypeDefinitions[string] | undefined
  label: string
  typeName: string
}): ReadOnlyFormField[] {
  return [
    { key: 'typeName', value: typeName },
    { key: 'typeRenameName', value: typeName },
    { key: 'typeSectionLabel', value: definition?.label ?? label },
    { key: 'typeSort', value: definition?.sort ?? '' },
    { key: 'typeTemplate', value: definition?.template ?? '' },
    ...typeDefinitionSchemaFields(definition),
    ...typeDefinitionAppearanceFields(definition),
  ]
}

function typeDefinitionSchemaFields(definition: MobileTypeDefinitions[string] | undefined): ReadOnlyFormField[] {
  return [
    { key: 'typeDisplayProperties', value: definition?.listPropertiesDisplay ?? [] },
    { key: 'typePropertyQuery', value: '' },
    { key: 'typeSchemaProperties', value: typeSchemaPropertiesForForm(definition) },
    { key: 'typeSchemaPropertyName', value: '' },
    { key: 'typeSchemaPropertyValue', value: '' },
    { key: 'typeSchemaRelationships', value: typeSchemaRelationshipsForForm(definition) },
    { key: 'typeSchemaRelationshipName', value: '' },
    { key: 'typeSchemaRelationshipTargetRef', value: '' },
    { key: 'typeSchemaRelationshipTarget', value: '' },
  ]
}

function typeDefinitionAppearanceFields(definition: MobileTypeDefinitions[string] | undefined): ReadOnlyFormField[] {
  return [
    { key: 'typeIcon', value: definition?.icon ?? 'file' },
    { key: 'typeTone', value: definition?.color ?? definition?.tone ?? 'gray' },
    { key: 'typeVisible', value: definition?.visible !== false },
  ]
}
