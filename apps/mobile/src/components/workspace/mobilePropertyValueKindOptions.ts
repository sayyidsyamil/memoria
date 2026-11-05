import type { mobileText } from '../../i18n/mobileText'
import type { MobilePropertyValueKind } from '../../workspace/mobilePropertyValues'

type MobilePropertyValueKindOption = {
  kind: MobilePropertyValueKind
  labelKey: Parameters<typeof mobileText>[0]
}

export const mobilePropertyValueKindOptions: MobilePropertyValueKindOption[] = [
  { kind: 'string', labelKey: 'inspector.properties.valueKind.text' },
  { kind: 'number', labelKey: 'inspector.properties.valueKind.number' },
  { kind: 'date', labelKey: 'inspector.properties.valueKind.date' },
  { kind: 'boolean', labelKey: 'inspector.properties.valueKind.boolean' },
  { kind: 'status', labelKey: 'inspector.properties.valueKind.status' },
  { kind: 'url', labelKey: 'inspector.properties.valueKind.url' },
  { kind: 'list', labelKey: 'inspector.properties.valueKind.list' },
  { kind: 'color', labelKey: 'inspector.properties.valueKind.color' },
]
