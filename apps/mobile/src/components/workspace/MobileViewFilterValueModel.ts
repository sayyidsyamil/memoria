import type { MobileViewFilterCondition, MobileViewFilterOp } from '../../workspace/mobileWorkspaceModel'
import { compileSafeUserRegex } from '../../../../../src/utils/safeRegex'
import { parseDateFilterInput } from '../../../../../src/utils/filterDates'
import {
  formatMobileCommaListText,
  mobileCommaListTextParts,
  parseMobileCommaListText,
} from '../../workspace/mobileCommaListText'

type MobileViewFilterValueInputKind = 'date' | 'text'

const dateFilterOps = new Set<MobileViewFilterOp>(['after', 'before'])
const listFilterOps = new Set<MobileViewFilterOp>(['any_of', 'none_of'])
const noValueFilterOps = new Set<MobileViewFilterOp>(['is_empty', 'is_not_empty'])
const regexFilterOps = new Set<MobileViewFilterOp>(['contains', 'equals', 'not_contains', 'not_equals'])
const datePreviewFormatter = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

export function mobileViewFilterValueInputKind(op: MobileViewFilterOp): MobileViewFilterValueInputKind {
  return dateFilterOps.has(op) ? 'date' : 'text'
}

export function mobileViewFilterRegexSupported(op: MobileViewFilterOp): boolean {
  return regexFilterOps.has(op)
}

export function mobileViewFilterRegexIsInvalid(condition: MobileViewFilterCondition): boolean {
  if (!mobileViewFilterRegexSupported(condition.op) || condition.regex !== true) return false
  return !compileSafeUserRegex(String(condition.value ?? ''), 'i').ok
}

export function mobileViewFilterDatePreviewLabel(value: string, reference = new Date()): string | null {
  const parsed = parseDateFilterInput(value, reference)
  return parsed ? datePreviewFormatter.format(parsed) : null
}

export function mobileViewFilterConditionWithOperator(
  condition: MobileViewFilterCondition,
  op: MobileViewFilterOp,
  regexEnabled = condition.regex === true,
): MobileViewFilterCondition {
  const next: MobileViewFilterCondition = {
    field: condition.field,
    op,
  }
  if (noValueFilterOps.has(op)) return next

  next.value = mobileViewFilterValueForOperator(condition, op)
  if (mobileViewFilterRegexSupported(op) && regexEnabled) next.regex = true
  return next
}

export function mobileViewFilterValueFromText(
  op: MobileViewFilterOp,
  valueText: string,
): unknown {
  return listFilterOps.has(op) ? parseMobileCommaListText(valueText) : valueText
}

export function mobileViewFilterValueText(condition: MobileViewFilterCondition): string {
  return Array.isArray(condition.value)
    ? formatMobileCommaListText(condition.value.map(String))
    : String(condition.value ?? '')
}

export function mobileViewFilterValueWithSuggestion(
  condition: MobileViewFilterCondition,
  suggestion: string,
): unknown {
  if (!listFilterOps.has(condition.op)) return suggestion

  const currentParts = mobileCommaListTextParts(mobileViewFilterValueText(condition))
  const completedParts = currentParts.slice(0, -1).filter(Boolean)
  const nextParts = completedParts.filter((part) => part.toLowerCase() !== suggestion.toLowerCase())
  return [...nextParts, suggestion]
}

function mobileViewFilterValueForOperator(
  condition: MobileViewFilterCondition,
  op: MobileViewFilterOp,
): unknown {
  if (listFilterOps.has(op)) {
    return Array.isArray(condition.value)
      ? [...condition.value]
      : parseMobileCommaListText(String(condition.value ?? ''))
  }

  return Array.isArray(condition.value)
    ? mobileViewFilterValueText(condition)
    : condition.value ?? ''
}
