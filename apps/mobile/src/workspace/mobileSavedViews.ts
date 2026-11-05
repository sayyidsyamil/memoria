import { parseMobileViewDefinition } from './mobileViewYaml'
import type {
  MobileNote,
  MobileSavedView,
  MobileViewDefinition,
  MobileViewFilterCondition,
  MobileViewFilterGroup,
  MobileViewFilterNode,
} from './mobileWorkspaceModel'
import {
  compareSortableValues,
  isBuiltInSortOption,
  parseSortConfig,
  statusSortRank,
  type SortDirection,
} from '../../../../src/utils/noteSort'
import { relationshipLookupKeys } from '../../../../src/utils/relationshipKeys'
import { createViewFilename } from '../../../../src/utils/viewFilename'
import {
  evaluateViewEntries,
  type ViewFilterEntry,
  type ViewFilterPropertyValue,
} from '../../../../src/utils/viewFilterEvaluation'
import {
  canMoveView,
  moveView,
  nextViewOrder,
  type ViewMoveDirection,
} from '../../../../src/utils/viewOrdering'

type ViewFileSource = {
  content: string
  relativePath: string
}

type FieldKey = string
type MobileViewEntry = ViewFilterEntry & { mobileNote: MobileNote }
type SortField = { key: FieldKey; kind: 'builtIn' | 'property' }
type SortFieldValue = string | number | boolean | string[] | null
type SortValue = string | null
type ViewFilename = string
type ViewIndex = number
type ViewPath = string
type YamlText = string
type YamlScalar = string | number | boolean | null


export function parseMobileSavedViewFile(file: ViewFileSource, index: ViewIndex): MobileSavedView | null {
  if (!isViewFile(file.relativePath)) return null

  const filename = file.relativePath.split('/').at(-1) ?? `view-${index + 1}.yml`
  const definition = parseMobileViewDefinition(file.content, fallbackViewName(filename, index))
  if (!definition) return null

  return {
    definition,
    filename,
    id: mobileSavedViewId(filename),
  }
}

export function orderedMobileSavedViews(views: MobileSavedView[]): MobileSavedView[] {
  return [...views].sort(compareSavedViews)
}

export type MobileViewMoveDirection = ViewMoveDirection

export function nextMobileSavedViewOrder(views: MobileSavedView[]): number {
  return nextViewOrder(views)
}

export function canMoveMobileSavedView(
  views: MobileSavedView[],
  viewId: string,
  direction: MobileViewMoveDirection,
): boolean {
  const filename = savedViewFilename(views, viewId)
  return filename ? canMoveView(views, filename, direction) : false
}

export function moveMobileSavedView(
  views: MobileSavedView[],
  viewId: string,
  direction: MobileViewMoveDirection,
): MobileSavedView[] | null {
  const filename = savedViewFilename(views, viewId)
  return filename ? moveView(views, filename, direction) : null
}

export function mobileSavedViewOrderUpdates(views: MobileSavedView[]): MobileSavedView[] {
  return views.map((view, order) => ({
    ...view,
    definition: { ...view.definition, order },
  }))
}

export function evaluateMobileSavedView(view: MobileSavedView, notes: MobileNote[]): MobileNote[] {
  const matchingNotes = evaluateViewEntries(view.definition, notes.map(mobileNoteToViewEntry))
    .map((entry) => entry.mobileNote)
  return sortMobileNotesBySort(matchingNotes, view.definition.sort)
}

export function mobileSavedViewId(filename: string) {
  return `view-${slugify(filename.replace(/\.[^.]+$/, ''))}`
}

export function createMobileSavedViewFilename(name: string, existingFilenames: string[] = []): string {
  return createViewFilename(name, existingFilenames)
}

export function mobileSavedViewPath(filename: ViewFilename): ViewPath {
  return `views/${filename}`
}

export function serializeMobileSavedViewDefinition(definition: MobileViewDefinition): string {
  const lines = [
    `name: ${yamlScalar(definition.name)}`,
    `icon: ${yamlScalar(definition.icon)}`,
    `color: ${yamlScalar(definition.color)}`,
    `sort: ${yamlScalar(definition.sort)}`,
  ]

  if (typeof definition.order === 'number') lines.push(`order: ${definition.order}`)
  if (definition.listPropertiesDisplay?.length) {
    lines.push('listPropertiesDisplay:')
    lines.push(...definition.listPropertiesDisplay.map((item) => `  - ${yamlScalar(item)}`))
  }

  lines.push('filters:')
  lines.push(...serializedFilterGroup(definition.filters, 2))

  return `${lines.join('\n')}\n`
}

function isViewFile(path: ViewPath) {
  return /^(?:views|\.laputa\/views)\/[^/]+\.ya?ml$/u.test(path)
}

function mobileNoteToViewEntry(note: MobileNote): MobileViewEntry {
  const path = note.path ?? note.id
  const relationships = mobileNoteViewRelationships(note)
  const timestamps = mobileNoteViewTimestamps(note)
  return {
    archived: note.archived === true,
    createdAt: timestamps.createdAt,
    favorite: note.favorite,
    filename: path.split('/').at(-1) ?? path,
    isA: note.type || null,
    modifiedAt: timestamps.modifiedAt,
    path,
    properties: mobileNoteViewProperties(note),
    relationships,
    snippet: note.snippet,
    status: note.status || null,
    title: note.title,
    mobileNote: note,
  }
}

function mobileNoteViewTimestamps(note: MobileNote) {
  return { createdAt: note.createdAt ?? null, modifiedAt: note.modifiedAt ?? null }
}

function mobileNoteViewProperties(note: MobileNote): Record<string, ViewFilterPropertyValue> {
  const properties = Object.fromEntries(
    (note.properties ?? []).map((property) => [property.key, property.value]),
  ) as Record<string, ViewFilterPropertyValue>
  if (!hasCaseInsensitiveKey(properties, 'tags')) properties.tags = note.tags
  return properties
}

function mobileNoteViewRelationships(note: MobileNote): Record<string, string[]> {
  const relationships: Record<string, string[]> = {}
  for (const relationship of note.relationships) {
    for (const key of relationshipLookupKeys(relationship)) {
      relationships[key] = relationship.values.map((value) => value.ref ?? value.title)
    }
  }
  return relationships
}

function hasCaseInsensitiveKey(record: Record<string, unknown>, key: string): boolean {
  const lowerKey = key.toLowerCase()
  return Object.keys(record).some((candidate) => candidate.toLowerCase() === lowerKey)
}

export function sortMobileNotesBySort(notes: MobileNote[], sort: SortValue): MobileNote[] {
  const sortSpec = sortConfig(sort)
  if (!sortSpec) return notes

  return [...notes].sort((left, right) => compareNotes(left, right, sortSpec.field, sortSpec.direction))
}

function compareNotes(left: MobileNote, right: MobileNote, field: SortField, direction: SortDirection) {
  if (field.kind === 'builtIn' && field.key === 'status') return compareStatusNotes(left, right, direction)

  const leftValue = sortFieldValue(left, field)
  const rightValue = sortFieldValue(right, field)
  const missingResult = compareMissingValues(leftValue, rightValue)
  if (missingResult !== null) return missingResult

  const result = comparePresentFieldValue(leftValue, rightValue)
  return direction === 'asc' ? result : -result
}

function sortFieldValue(note: MobileNote, field: SortField): SortFieldValue {
  if (field.kind === 'property') return sortPropertyValue(note, field.key)
  if (field.key === 'modified') return displayTimestamp(note)
  if (field.key === 'created') return note.createdAt ?? note.modifiedAt ?? 0
  if (field.key === 'title') return note.title
  if (field.key === 'type') return note.type
  if (field.key === 'status') return note.status
  return null
}

function compareStatusNotes(left: MobileNote, right: MobileNote, direction: SortDirection) {
  const leftOrder = statusSortRank(left.status)
  const rightOrder = statusSortRank(right.status)
  if (leftOrder !== rightOrder) {
    const result = leftOrder - rightOrder
    return direction === 'asc' ? result : -result
  }

  return displayTimestamp(right) - displayTimestamp(left)
}

function displayTimestamp(note: MobileNote) {
  return note.modifiedAt ?? note.createdAt ?? 0
}

function sortPropertyValue(note: MobileNote, key: FieldKey): SortFieldValue {
  const property = note.properties?.find((candidate) => candidate.key.toLowerCase() === key.toLowerCase())
  return property?.value ?? null
}

function sortConfig(sort: SortValue): { direction: SortDirection; field: SortField } | null {
  const parsed = parseSortConfig(sort)
  if (!parsed) return null
  return { direction: parsed.direction, field: sortField(parsed.option) }
}

function sortField(rawField: FieldKey): SortField {
  const propertyPrefix = 'property:'
  if (rawField.startsWith(propertyPrefix)) {
    return { key: rawField.slice(propertyPrefix.length), kind: 'property' }
  }

  const field = rawField.toLowerCase()
  return isBuiltInSortOption(field) ? { key: field, kind: 'builtIn' } : { key: rawField, kind: 'property' }
}

function compareMissingValues(left: SortFieldValue, right: SortFieldValue) {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return null
}

function comparePresentFieldValue(left: SortFieldValue, right: SortFieldValue) {
  return compareSortableValues(left, right)
}

function isFilterGroup(node: MobileViewFilterNode): node is MobileViewFilterGroup {
  return 'all' in node || 'any' in node
}

function fallbackViewName(filename: ViewFilename, index: ViewIndex) {
  const fallback = filename.replace(/\.[^.]+$/, '').replaceAll('-', ' ').trim()
  return fallback ? titleCase(fallback) : `View ${index + 1}`
}

function titleCase(value: YamlText) {
  return value.replace(/\b\w/gu, (char) => char.toUpperCase())
}

function serializedFilterGroup(group: MobileViewFilterGroup, indent: number): string[] {
  const kind = 'any' in group ? 'any' : 'all'
  const nodes = 'any' in group ? group.any : group.all
  const prefix = spaces(indent)

  return [
    `${prefix}${kind}:`,
    ...nodes.flatMap((node) => serializedFilterNode(node, indent + 2)),
  ]
}

function serializedFilterNode(node: MobileViewFilterNode, indent: number): string[] {
  if (isFilterGroup(node)) return serializedNestedFilterGroup(node, indent)
  return serializedFilterCondition(node, indent)
}

function serializedNestedFilterGroup(group: MobileViewFilterGroup, indent: number): string[] {
  const kind = 'any' in group ? 'any' : 'all'
  const nodes = 'any' in group ? group.any : group.all
  const prefix = spaces(indent)

  return [
    `${prefix}- ${kind}:`,
    ...nodes.flatMap((node) => serializedFilterNode(node, indent + 4)),
  ]
}

function serializedFilterCondition(condition: MobileViewFilterCondition, indent: number): string[] {
  const prefix = spaces(indent)
  const childPrefix = spaces(indent + 2)
  const lines = [
    `${prefix}- field: ${yamlScalar(condition.field)}`,
    `${childPrefix}op: ${yamlScalar(condition.op)}`,
  ]

  if (condition.regex === true) lines.push(`${childPrefix}regex: true`)
  if (condition.value !== undefined) lines.push(...serializedYamlValue('value', condition.value, indent + 2))

  return lines
}

function serializedYamlValue(key: string, value: unknown, indent: number): string[] {
  const prefix = spaces(indent)
  if (!Array.isArray(value)) return [`${prefix}${key}: ${yamlScalar(yamlSerializableScalar(value))}`]

  return [
    `${prefix}${key}:`,
    ...value.map((item) => `${spaces(indent + 2)}- ${yamlScalar(yamlSerializableScalar(item))}`),
  ]
}

function yamlSerializableScalar(value: unknown): YamlScalar {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  return String(value)
}

function yamlScalar(value: YamlScalar): string {
  if (value === null) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function spaces(count: number) {
  return ' '.repeat(count)
}

function compareSavedViews(left: MobileSavedView, right: MobileSavedView) {
  const leftOrder = left.definition.order
  const rightOrder = right.definition.order
  if (typeof leftOrder === 'number' && typeof rightOrder === 'number') return leftOrder - rightOrder
  if (typeof leftOrder === 'number') return -1
  if (typeof rightOrder === 'number') return 1
  return left.filename.localeCompare(right.filename)
}

function savedViewFilename(views: MobileSavedView[], viewId: string): ViewFilename | null {
  const view = views.find((candidate) => candidate.id === viewId || candidate.filename === viewId)
  return view?.filename ?? null
}

function slugify(value: YamlText) {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '') || 'view'
}
