import { isColorKeyName, isValidCssColor } from '../../../../src/utils/colorUtils'
import { parseDashDateParts, parseSlashDateParts } from '../../../../src/utils/dateStringParts'

type MobilePropertyKey = string
type MobilePropertyValueText = string
type PropertyKeyPattern = string

const colorPropertyKeySuffixes = [' color']
const datePropertyKeyPatterns = ['date', 'deadline', 'due', 'start', 'end', 'scheduled']
const listPropertyKeyPatterns = ['tags', 'keywords', 'categories', 'labels']
const statusPropertyKeyPatterns = ['status']
const urlPropertyKeyPatterns = ['url', 'uri', 'link', 'website']

const mobileStatusValues = new Set([
  'active',
  'archived',
  'blocked',
  'cancelled',
  'closed',
  'done',
  'draft',
  'dropped',
  'in progress',
  'mixed',
  'not started',
  'open',
  'paused',
  'pending',
  'published',
])

function normalizedPropertyKey(key: MobilePropertyKey): string {
  return key.trim().toLowerCase()
}

function keyMatchesPatterns(key: MobilePropertyKey, patterns: readonly PropertyKeyPattern[]): boolean {
  const lower = normalizedPropertyKey(key)
  return patterns.some((pattern) => lower === pattern || lower.includes(pattern))
}

function isMobileStatusPropertyValue(value: MobilePropertyValueText): boolean {
  return mobileStatusValues.has(value.trim().toLowerCase())
}

function hasMobileColorSuggestionSuffix(key: MobilePropertyKey): boolean {
  const lower = normalizedPropertyKey(key)
  return colorPropertyKeySuffixes.some((suffix) => lower.endsWith(suffix))
}

export function isMobileListPropertyKey(key: MobilePropertyKey): boolean {
  return keyMatchesPatterns(key, listPropertyKeyPatterns)
}

export function isMobileStatusPropertyKey(key: MobilePropertyKey): boolean {
  return keyMatchesPatterns(key, statusPropertyKeyPatterns)
}

export function isMobileDatePropertyKey(key: MobilePropertyKey): boolean {
  return keyMatchesPatterns(key, datePropertyKeyPatterns)
}

export function isMobileUrlPropertyKey(key: MobilePropertyKey): boolean {
  return keyMatchesPatterns(key, urlPropertyKeyPatterns)
}

export function isMobileColorPropertyKey(key: MobilePropertyKey): boolean {
  return isColorKeyName(normalizedPropertyKey(key)) || hasMobileColorSuggestionSuffix(key)
}

export function isMobileStatusProperty(key: MobilePropertyKey, value: MobilePropertyValueText): boolean {
  if (isMobileStatusPropertyKey(key)) return true
  if (isMobileDatePropertyKey(key)) return false
  return isMobileStatusPropertyValue(value)
}

export function isMobileDatePropertyValue(value: MobilePropertyValueText): boolean {
  const trimmed = value.trim()
  return parseDashDateParts(trimmed) !== null || parseSlashDateParts(trimmed) !== null
}

export function isMobileUrlPropertyValue(value: MobilePropertyValueText): boolean {
  return /^https?:\/\/\S+$/iu.test(value.trim())
}

export function isMobileColorProperty(key: MobilePropertyKey, value: MobilePropertyValueText): boolean {
  const trimmed = value.trim()
  return isValidCssColor(trimmed) && (trimmed.startsWith('#') || isMobileColorPropertyKey(key))
}
