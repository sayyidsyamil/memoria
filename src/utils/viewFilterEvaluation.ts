import type { FilterCondition, FilterGroup, FilterNode, ViewDefinition } from './viewSchema'
import { toDateFilterTimestamp } from './filterDates'
import { compileSafeUserRegex } from './safeRegex'
import { evaluateArrayFieldCondition, type ViewFilterArrayKind } from './viewFilterArrayFields'

export type ViewFilterPropertyScalar = string | number | boolean | null
export type ViewFilterPropertyArray = Array<string | number | boolean>
export type ViewFilterPropertyValue = ViewFilterPropertyScalar | ViewFilterPropertyArray

export interface ViewFilterEntry {
  archived: boolean
  createdAt: number | null
  favorite: boolean
  filename: string
  isA: string | null
  modifiedAt: number | null
  path: string
  properties: Record<string, ViewFilterPropertyValue>
  relationships: Record<string, string[]>
  snippet: string
  status: string | null
  title: string
}

type FieldScalar = string | number | boolean | null
type FieldKey = string
type FieldText = string
type TimestampMs = number
type ResolvedField =
  | { kind: 'scalar'; value: FieldScalar }
  | { arrayKind: ViewFilterArrayKind; kind: 'array'; values: FieldText[] }
type BuiltInFieldReader<T extends ViewFilterEntry> = (entry: T) => ResolvedField
type TextOp = FilterCondition['op']

const builtInFieldReaders = new Map<string, BuiltInFieldReader<ViewFilterEntry>>([
  ['type', (entry) => scalarField(entry.isA)],
  ['isa', (entry) => scalarField(entry.isA)],
  ['status', (entry) => scalarField(entry.status)],
  ['title', (entry) => scalarField(entry.title)],
  ['filename', (entry) => scalarField(entry.filename)],
  ['archived', (entry) => scalarField(entry.archived)],
  ['favorite', (entry) => scalarField(entry.favorite)],
  ['body', (entry) => scalarField(entry.snippet)],
])

export function evaluateViewEntries<T extends ViewFilterEntry>(
  definition: ViewDefinition,
  entries: T[],
): T[] {
  return entries.filter((entry) => !entry.archived && evaluateGroup(definition.filters, entry))
}

function evaluateGroup(group: FilterGroup, entry: ViewFilterEntry): boolean {
  if ('all' in group) return group.all.every((node) => evaluateNode(node, entry))
  if ('any' in group) return group.any.some((node) => evaluateNode(node, entry))
  return true
}

function isFilterGroup(node: FilterNode): node is FilterGroup {
  return 'all' in node || 'any' in node
}

function evaluateNode(node: FilterNode, entry: ViewFilterEntry): boolean {
  if (isFilterGroup(node)) return evaluateGroup(node, entry)
  return evaluateCondition(node as FilterCondition, entry)
}

function findCaseInsensitiveEntry<Value>(record: Record<FieldKey, Value>, lower: FieldKey): [FieldKey, Value] | undefined {
  return Object.entries(record).find(([key]) => key !== '' && key.toLowerCase() === lower)
}

function scalarField(value: FieldScalar): ResolvedField {
  return { kind: 'scalar', value }
}

function arrayField(values: FieldText[], arrayKind: ViewFilterArrayKind): ResolvedField {
  return { arrayKind, kind: 'array', values }
}

function propertyField(value: ViewFilterPropertyValue): ResolvedField {
  if (Array.isArray(value)) return arrayField(value.map(toFilterString), 'property')
  return scalarField(value)
}

function resolveRelationshipField(entry: ViewFilterEntry, lower: FieldKey): ResolvedField | null {
  const relationship = findCaseInsensitiveEntry(entry.relationships, lower)
  if (!relationship) return null
  return arrayField(relationship[1] ?? [], 'relationship')
}

function resolvePropertyField(entry: ViewFilterEntry, lower: FieldKey): ResolvedField | null {
  const property = findCaseInsensitiveEntry(entry.properties, lower)
  if (!property) return null
  return propertyField(property[1] ?? null)
}

function resolveField(entry: ViewFilterEntry, field: FieldKey): ResolvedField {
  const lower = field.toLowerCase()
  return builtInFieldReaders.get(lower)?.(entry)
    ?? resolveRelationshipField(entry, lower)
    ?? resolvePropertyField(entry, lower)
    ?? scalarField(null)
}

function toFilterString(value: unknown): FieldText {
  if (value == null) return ''
  if (typeof value === 'string') return value
  return String(value)
}

function compileRegex(condition: FilterCondition, value: FieldText): RegExp | null {
  if (condition.regex !== true) return null
  const compiled = compileSafeUserRegex(value, 'i')
  return compiled.ok ? compiled.pattern : null
}

function usesRegex(condition: FilterCondition): boolean {
  return condition.regex === true
    && (
      condition.op === 'contains'
      || condition.op === 'not_contains'
      || condition.op === 'equals'
      || condition.op === 'not_equals'
    )
}

function evaluateEmptyCondition(op: FilterCondition['op'], resolved: ResolvedField): boolean | null {
  if (op === 'is_empty') return isEmptyField(resolved)
  if (op === 'is_not_empty') return !isEmptyField(resolved)
  return null
}

function isEmptyField(resolved: ResolvedField): boolean {
  if (resolved.kind === 'array') return resolved.values.length === 0
  const value = resolved.value
  return value == null || value === '' || value === false
}

function textMatchResult(op: FilterCondition['op'], matched: boolean): boolean {
  if (op === 'contains' || op === 'equals') return matched
  if (op === 'not_contains' || op === 'not_equals') return !matched
  return false
}

function evaluateArrayCondition(
  condition: FilterCondition,
  resolved: Extract<ResolvedField, { kind: 'array' }>,
  conditionValue: FieldText,
  regex: RegExp | null,
): boolean {
  return evaluateArrayFieldCondition({
    arrayKind: resolved.arrayKind,
    cond: condition,
    condVal: conditionValue,
    regex,
    values: resolved.values,
  })
}

function evaluateRegexScalarCondition(
  op: FilterCondition['op'],
  fieldRaw: FieldText,
  regex: RegExp,
): boolean {
  return textMatchResult(op, regex.test(fieldRaw))
}

function conditionList(value: unknown): FieldText[] | null {
  return Array.isArray(value) ? value.map(toFilterString) : null
}

function evaluateTextComparison(op: TextOp, fieldText: FieldText, conditionText: FieldText): boolean | null {
  if (op === 'equals') return fieldText === conditionText
  if (op === 'not_equals') return fieldText !== conditionText
  if (op === 'contains') return fieldText.includes(conditionText)
  if (op === 'not_contains') return !fieldText.includes(conditionText)
  return null
}

function evaluateTextSetCondition(op: TextOp, fieldText: FieldText, values: FieldText[] | null): boolean | null {
  if (!values) return null
  const matched = values.some((value) => value.toLowerCase() === fieldText)
  if (op === 'any_of') return matched
  if (op === 'none_of') return !matched
  return null
}

function evaluateTextCondition(
  condition: FilterCondition,
  fieldRaw: FieldText,
  conditionValue: FieldText,
  regex: RegExp | null,
): boolean {
  const { op } = condition
  if (regex) return evaluateRegexScalarCondition(op, fieldRaw, regex)

  const fieldText = fieldRaw.toLowerCase()
  const conditionText = conditionValue.toLowerCase()
  return evaluateTextComparison(op, fieldText, conditionText)
    ?? evaluateTextSetCondition(op, fieldText, conditionList(condition.value))
    ?? false
}

function fieldTimestamp(value: FieldScalar | undefined): TimestampMs | null {
  if (typeof value === 'number') return value * 1000
  if (typeof value === 'string') return toDateFilterTimestamp(value)
  return null
}

function evaluateDateCondition(
  condition: FilterCondition,
  scalar: string | number | boolean | null | undefined,
  conditionValue: FieldText,
): boolean {
  if (condition.op !== 'before' && condition.op !== 'after') return false

  const timestamp = fieldTimestamp(scalar)
  const target = toDateFilterTimestamp(conditionValue)
  if (timestamp == null || target == null) return false
  return condition.op === 'before' ? timestamp < target : timestamp > target
}

function isSameLocalDay(leftTimestamp: TimestampMs, rightTimestamp: TimestampMs): boolean {
  const leftDate = new Date(leftTimestamp)
  const rightDate = new Date(rightTimestamp)
  return leftDate.getFullYear() === rightDate.getFullYear()
    && leftDate.getMonth() === rightDate.getMonth()
    && leftDate.getDate() === rightDate.getDate()
}

function evaluateDateEqualityCondition(
  op: FilterCondition['op'],
  scalar: FieldScalar,
  conditionValue: FieldText,
): boolean | null {
  if (op !== 'equals' && op !== 'not_equals') return null

  const timestamp = fieldTimestamp(scalar)
  const target = toDateFilterTimestamp(conditionValue)
  if (timestamp == null || target == null) return null

  const matched = isSameLocalDay(timestamp, target)
  return op === 'equals' ? matched : !matched
}

function evaluateScalarDateCondition(
  condition: FilterCondition,
  scalar: FieldScalar,
  conditionValue: FieldText,
): boolean | null {
  if (condition.op === 'before' || condition.op === 'after') {
    return evaluateDateCondition(condition, scalar, conditionValue)
  }

  return evaluateDateEqualityCondition(condition.op, scalar, conditionValue)
}

function evaluateScalarCondition(
  condition: FilterCondition,
  scalar: FieldScalar,
  conditionValue: FieldText,
  regex: RegExp | null,
): boolean {
  const dateResult = evaluateScalarDateCondition(condition, scalar, conditionValue)
  if (dateResult !== null) return dateResult
  return evaluateTextCondition(condition, toFilterString(scalar), conditionValue, regex)
}

function evaluateCondition(condition: FilterCondition, entry: ViewFilterEntry): boolean {
  const resolved = resolveField(entry, condition.field)
  const emptyResult = evaluateEmptyCondition(condition.op, resolved)
  if (emptyResult !== null) return emptyResult

  const conditionValue = toFilterString(condition.value)
  const regex = usesRegex(condition) ? compileRegex(condition, conditionValue) : null
  if (usesRegex(condition) && !regex) return false

  if (resolved.kind === 'array') {
    return evaluateArrayCondition(condition, resolved, conditionValue, regex)
  }

  return evaluateScalarCondition(condition, resolved.value, conditionValue, regex)
}
