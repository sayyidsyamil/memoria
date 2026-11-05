import { formatDateValueForDisplay } from '../../../../src/utils/dateDisplay'
import type { MobilePropertyDisplayMode, MobilePropertyValue } from './mobileWorkspaceModel'
import { mobilePropertyValueKind, type MobilePropertyValueKind } from './mobilePropertyValues'

type MobileBooleanDisplayLabels = {
  false: string
  true: string
}

export type MobilePropertyDisplay = {
  colorValue?: string
  kind: MobilePropertyValueKind
  listItems: string[]
  text: string
}

export function mobilePropertyDisplay(
  key: string,
  value: MobilePropertyValue,
  booleanLabels: MobileBooleanDisplayLabels = { false: 'No', true: 'Yes' },
  displayModes: Record<string, MobilePropertyDisplayMode> | null | undefined = null,
): MobilePropertyDisplay {
  const kind = mobilePropertyValueKind(key, value, displayModes)

  if (kind === 'list' && Array.isArray(value)) {
    return propertyDisplay(kind, value.join(', '), { listItems: value })
  }

  if (kind === 'boolean' && typeof value === 'boolean') {
    return propertyDisplay(kind, value ? booleanLabels.true : booleanLabels.false)
  }

  if (kind === 'date' || kind === 'color') return stringPropertyDisplay(kind, value)

  return propertyDisplay(kind, propertyValueText(value))
}

function stringPropertyDisplay(kind: 'date' | 'color', value: MobilePropertyValue): MobilePropertyDisplay {
  if (typeof value !== 'string') return propertyDisplay(kind, propertyValueText(value))
  return kind === 'date'
    ? propertyDisplay(kind, formatDateValueForDisplay(value, 'friendly'))
    : propertyDisplay(kind, value, { colorValue: value })
}

function propertyDisplay(
  kind: MobilePropertyValueKind,
  text: string,
  overrides: Partial<Pick<MobilePropertyDisplay, 'colorValue' | 'listItems'>> = {},
): MobilePropertyDisplay {
  return {
    kind,
    text,
    listItems: overrides.listItems ?? [],
    colorValue: overrides.colorValue,
  }
}

function propertyValueText(value: MobilePropertyValue): string {
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}
