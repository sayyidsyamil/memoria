import type {
  MobileCreateNoteDefaults,
  MobileNote,
  MobilePropertyValue,
  MobileTypeDefinition,
  MobileTypeDefinitions,
} from './mobileWorkspaceModel'
import { isRelationshipKey, normalizeRelationshipKey } from '../../../../src/utils/relationshipKeys'

type MutableCreateDefaults = Pick<MobileCreateNoteDefaults, 'template' | 'type'> & {
  properties: Record<string, MobilePropertyValue>
  relationships: Record<string, string[]>
}

const ignoredTypePropertyDefaultFields = new Set(['is_a', 'title', 'type'])
const booleanDefaultKeys = ['archived', 'favorite', 'organized'] as const
const textDefaultKeys = ['folderPath', 'status', 'template', 'type'] as const

export function mobileCreateNoteDefaultsForType(
  typeName: string,
  typeDefinitions?: MobileTypeDefinitions,
): MobileCreateNoteDefaults {
  const type = typeName.trim()
  const defaults = emptyDefaults()
  defaults.type = type
  applyTypeDefinitionDefaults(defaults, typeDefinitionForType(type, typeDefinitions))
  return compactDefaults(defaults)
}

export function mobileCreateRelationshipTargetDefaults({
  defaults = {},
  relationshipKey,
  sourceNote,
  typeDefinitions,
}: {
  defaults?: MobileCreateNoteDefaults
  relationshipKey: string
  sourceNote: MobileNote
  typeDefinitions?: MobileTypeDefinitions
}): MobileCreateNoteDefaults {
  const type = defaults.type ?? relationshipTargetType({
    relationshipKey,
    sourceNote,
    typeDefinitions,
  })
  const typeDefaults = type ? mobileCreateNoteDefaultsForType(type, typeDefinitions) : {}
  return relationshipTargetDefaults(
    mergeCreateDefaults(typeDefaults, defaults),
    defaults.folderPath ?? noteFolderPath(sourceNote),
  )
}

function relationshipTargetType({
  relationshipKey,
  sourceNote,
  typeDefinitions,
}: {
  relationshipKey: string
  sourceNote: MobileNote
  typeDefinitions?: MobileTypeDefinitions
}): string | null {
  const normalizedRelationshipKey = normalizeRelationshipKey(relationshipKey)
  if (!normalizedRelationshipKey) return null

  const sourceDefinition = typeDefinitionForType(sourceNote.type, typeDefinitions)
  for (const [key, value] of Object.entries(sourceDefinition?.properties ?? {})) {
    if (normalizeRelationshipKey(key) === normalizedRelationshipKey && typeof value === 'string') {
      const type = value.trim()
      if (type) return type
    }
  }

  return null
}

function applyTypeDefinitionDefaults(
  defaults: MutableCreateDefaults,
  definition: MobileTypeDefinition | undefined,
) {
  if (!definition) return

  if (definition.template) defaults.template = definition.template
  Object.assign(defaults.properties, valuedProperties(definition.properties ?? {}))
  Object.assign(defaults.relationships, valuedRelationships(definition.relationships ?? {}))
}

function valuedProperties(properties: Record<string, MobilePropertyValue>) {
  return Object.fromEntries(
    Object.entries(properties).filter(([key, value]) => {
      const normalizedKey = normalizedFieldKey(key)
      return isDefaultablePropertyValue(value)
        && !ignoredTypePropertyDefaultFields.has(normalizedKey)
        && !isRelationshipDefaultField(normalizedKey)
    }),
  )
}

function valuedRelationships(relationships: Record<string, string[]>) {
  const seenKeys = new Set<string>()

  return Object.fromEntries(Object.entries(relationships).flatMap(([key, refs]) => {
    const trimmedKey = key.trim()
    const canonicalKey = normalizedFieldKey(trimmedKey)
    if (!trimmedKey || seenKeys.has(canonicalKey)) return []

    const values = refs.map((ref) => ref.trim()).filter(Boolean)
    if (values.length === 0) return []

    seenKeys.add(canonicalKey)
    return [[trimmedKey, values]]
  }))
}

function mergeCreateDefaults(
  base: MobileCreateNoteDefaults,
  override: MobileCreateNoteDefaults,
): MobileCreateNoteDefaults {
  return compactDefaults({
    ...base,
    ...override,
    properties: {
      ...(base.properties ?? {}),
      ...(override.properties ?? {}),
    },
    relationships: {
      ...(base.relationships ?? {}),
      ...(override.relationships ?? {}),
    },
  })
}

function typeDefinitionForType(
  typeName: string,
  typeDefinitions: MobileTypeDefinitions | undefined,
): MobileTypeDefinition | undefined {
  const exact = typeDefinitions?.[typeName]
  if (exact) return exact

  const normalizedType = normalizedFieldKey(typeName)
  return Object.entries(typeDefinitions ?? {})
    .find(([key]) => normalizedFieldKey(key) === normalizedType)?.[1]
}

function isDefaultablePropertyValue(value: MobilePropertyValue): value is string | number | boolean {
  if (typeof value === 'string') return value.trim().length > 0
  return typeof value === 'number' || typeof value === 'boolean'
}

function normalizedFieldKey(field: string): string {
  return field.trim().replace(/^property:/iu, '').toLowerCase().replaceAll(' ', '_')
}

function isRelationshipDefaultField(key: string): boolean {
  return isRelationshipKey(key)
}

function compactDefaults(defaults: MobileCreateNoteDefaults): MobileCreateNoteDefaults {
  const compact: MobileCreateNoteDefaults = {}

  for (const key of booleanDefaultKeys) addBooleanDefault(compact, defaults, key)
  for (const key of textDefaultKeys) addTextDefault(compact, defaults, key)
  addTagsDefault(compact, defaults)
  addRecordDefault(compact, 'properties', defaults.properties ?? {})
  addRecordDefault(compact, 'relationships', defaults.relationships ?? {})

  return compact
}

function relationshipTargetDefaults(
  defaults: MobileCreateNoteDefaults,
  folderPath: string | undefined,
): MobileCreateNoteDefaults {
  return {
    ...defaults,
    ...(folderPath ? { folderPath } : {}),
    type: defaults.type ?? 'Note',
  }
}

function noteFolderPath(note: MobileNote): string | undefined {
  const parts = (note.path ?? note.id).split('/').filter(Boolean)
  parts.pop()
  return parts.length > 0 ? parts.join('/') : undefined
}

function addBooleanDefault<Key extends typeof booleanDefaultKeys[number]>(
  defaults: MobileCreateNoteDefaults,
  source: MobileCreateNoteDefaults,
  key: Key,
) {
  const value = source[key]
  if (value !== undefined) defaults[key] = value
}

function addTextDefault<Key extends typeof textDefaultKeys[number]>(
  defaults: MobileCreateNoteDefaults,
  source: MobileCreateNoteDefaults,
  key: Key,
) {
  const value = source[key]
  if (value) defaults[key] = value
}

function addTagsDefault(
  defaults: MobileCreateNoteDefaults,
  source: MobileCreateNoteDefaults,
) {
  if (source.tags && source.tags.length > 0) defaults.tags = source.tags
}

function addRecordDefault<Key extends keyof Pick<MobileCreateNoteDefaults, 'properties' | 'relationships'>>(
  defaults: MobileCreateNoteDefaults,
  key: Key,
  values: NonNullable<MobileCreateNoteDefaults[Key]>,
) {
  if (Object.keys(values).length > 0) defaults[key] = values
}

function emptyDefaults(): MutableCreateDefaults {
  return {
    properties: {},
    relationships: {},
  }
}
