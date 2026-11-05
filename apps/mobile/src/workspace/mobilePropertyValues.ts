import type { MobilePropertyDisplayMode, MobilePropertyValue } from './mobileWorkspaceModel'
import { parseDashDateParts, parseSlashDateParts, type DateParts } from '../../../../src/utils/dateStringParts'
import {
  isMobileColorProperty,
  isMobileColorPropertyKey,
  isMobileDatePropertyKey,
  isMobileDatePropertyValue,
  isMobileListPropertyKey,
  isMobileStatusProperty,
  isMobileStatusPropertyKey,
  isMobileUrlPropertyKey,
  isMobileUrlPropertyValue,
} from './mobilePropertyValueDetectors'
import {
  formatMobileCommaListText,
  mobileCommaListTextParts,
  parseMobileCommaListText,
} from './mobileCommaListText'

export { isMobileListPropertyKey } from './mobilePropertyValueDetectors'

type MobilePropertyKey = string
type MobilePropertyValueText = string
type MobileStringPropertyValueKind = Exclude<MobilePropertyValueKind, 'boolean' | 'list' | 'number' | 'string'>

export type MobilePropertyValueKind = 'boolean' | 'color' | 'date' | 'list' | 'number' | 'status' | 'string' | 'url'

export type MobilePropertyValueInput = {
  kind: MobilePropertyValueKind
  key: MobilePropertyKey
  valueText: MobilePropertyValueText
}

export type MobilePropertySuggestionValueInput = MobilePropertyValueInput & {
  suggestion: string
}

export function canSubmitMobilePropertyValue(input: MobilePropertyValueInput): boolean {
  if (!input.key.trim()) return false
  const kind = mobilePropertyValueKindForKey(input.key, input.kind)
  if (kind === 'date') return isValidDatePropertyValue(input.valueText)
  return kind !== 'number' || isValidNumberPropertyValue(input.valueText)
}

export function mobilePropertyValueFormText(value: MobilePropertyValue): string {
  if (Array.isArray(value)) return formatMobileCommaListText(value)
  return String(value)
}

export function mobilePropertyValueKind(
  key: MobilePropertyKey,
  value: MobilePropertyValue,
  displayModes: Record<string, MobilePropertyDisplayMode> | null | undefined = null,
): MobilePropertyValueKind {
  const configuredKind = mobilePropertyValueKindFromDisplayMode(displayModes?.[key])
  if (configuredKind) return configuredKind
  if (isMobileListPropertyKey(key) || Array.isArray(value)) return 'list'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  return mobileStringPropertyValueKind(key, value)
}

export function mobilePropertyValueKindForKey(
  key: MobilePropertyKey,
  currentKind: MobilePropertyValueKind,
  displayModes: Record<string, MobilePropertyDisplayMode> | null | undefined = null,
): MobilePropertyValueKind {
  const configuredKind = mobilePropertyValueKindFromDisplayMode(displayModes?.[key])
  if (configuredKind) return configuredKind
  if (isMobileListPropertyKey(key)) return 'list'
  if (isMobileStatusPropertyKey(key)) return 'status'
  if (isMobileDatePropertyKey(key)) return 'date'
  if (isMobileUrlPropertyKey(key)) return 'url'
  if (isMobileColorPropertyKey(key)) return 'color'
  return currentKind
}

export function mobilePropertyValueTextForKindChange(
  currentValueText: MobilePropertyValueText,
  nextKind: MobilePropertyValueKind,
): string {
  if (nextKind !== 'boolean') return currentValueText
  if (isBooleanFalseText(currentValueText)) return 'false'
  return 'true'
}

export function mobilePropertyDisplayModeFromValueKind(
  kind: MobilePropertyValueKind,
): MobilePropertyDisplayMode | null {
  if (kind === 'string') return null
  if (kind === 'list') return 'tags'
  return kind
}

export function parseMobilePropertyValue(input: MobilePropertyValueInput): MobilePropertyValue {
  const kind = mobilePropertyValueKindForKey(input.key, input.kind)
  if (kind === 'list') return listPropertyValue(input.valueText)
  if (kind === 'boolean') return booleanPropertyValue(input.valueText)
  if (kind === 'number') return numberPropertyValue(input.valueText)
  if (kind === 'date') return datePropertyValue(input.valueText)
  return input.valueText.trim()
}

export function mobilePropertySuggestionValue(input: MobilePropertySuggestionValueInput): string {
  const kind = mobilePropertyValueKindForKey(input.key, input.kind)
  if (kind !== 'list') return input.suggestion
  return listPropertySuggestionValue(input.valueText, input.suggestion)
}

function mobileStringPropertyValueKind(key: MobilePropertyKey, value: string): MobilePropertyValueKind {
  return stringPropertyValueKindDetectors.find((detector) => detector.matches(key, value))?.kind ?? 'string'
}

function listPropertyValue(value: MobilePropertyValueText): string[] {
  return parseMobileCommaListText(value)
}

function listPropertySuggestionValue(valueText: MobilePropertyValueText, suggestion: string): string {
  const parts = mobileCommaListTextParts(valueText)
  const existing = parts.slice(0, -1).filter(Boolean)
  const withoutSuggestion = existing.filter((part) => part.toLowerCase() !== suggestion.toLowerCase())
  return formatMobileCommaListText([...withoutSuggestion, suggestion])
}

function booleanPropertyValue(value: MobilePropertyValueText): boolean {
  return /^(true|yes|1|on)$/iu.test(value.trim())
}

function isBooleanFalseText(value: MobilePropertyValueText): boolean {
  return /^(false|no|0|off)$/iu.test(value.trim())
}

function numberPropertyValue(value: MobilePropertyValueText): number | string {
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? parsed : value.trim()
}

function isValidNumberPropertyValue(value: MobilePropertyValueText): boolean {
  const trimmed = value.trim()
  return trimmed !== '' && Number.isFinite(Number(trimmed))
}

function datePropertyValue(value: MobilePropertyValueText): MobilePropertyValueText {
  return normalizedDatePropertyValue(value) ?? value.trim()
}

function isValidDatePropertyValue(value: MobilePropertyValueText): boolean {
  const trimmed = value.trim()
  return trimmed === '' || normalizedDatePropertyValue(trimmed) !== null
}

function normalizedDatePropertyValue(value: MobilePropertyValueText): MobilePropertyValueText | null {
  const trimmed = value.trim()
  if (trimmed === '') return ''
  const parts = parseDashDateParts(trimmed) ?? parseSlashDateParts(trimmed)
  return parts ? formatDateParts(parts) : null
}

function formatDateParts(parts: DateParts): MobilePropertyValueText {
  return [
    String(parts.year).padStart(4, '0'),
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0'),
  ].join('-')
}

const stringPropertyValueKindDetectors: readonly {
  kind: MobileStringPropertyValueKind
  matches: (key: MobilePropertyKey, value: MobilePropertyValueText) => boolean
}[] = [
  { kind: 'status', matches: isMobileStatusProperty },
  { kind: 'date', matches: (_key, value) => isMobileDatePropertyValue(value) },
  { kind: 'url', matches: (key, value) => isMobileUrlPropertyKey(key) || isMobileUrlPropertyValue(value) },
  { kind: 'color', matches: isMobileColorProperty },
]

function mobilePropertyValueKindFromDisplayMode(
  mode: MobilePropertyDisplayMode | null | undefined,
): MobilePropertyValueKind | null {
  if (!mode || mode === 'text') return null
  if (mode === 'tags') return 'list'
  return mode
}
