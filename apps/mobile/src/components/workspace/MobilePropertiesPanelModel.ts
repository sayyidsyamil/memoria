import type { MobileRelationship } from '../../workspace/mobileWorkspaceModel'
import { desktopPropertyParity, desktopRelationshipParity } from '../../ui/desktopParity'
import { mobileText } from '../../i18n/mobileText'

export type MobileInspectorPlaceholderActionKind = 'property' | 'relationship'

export const mobileInspectorReferenceRowLayoutContract = {
  iconSize: desktopRelationshipParity.iconSize,
  minHeight: desktopPropertyParity.rowMinHeight,
  paddingHorizontal: desktopRelationshipParity.rowPaddingHorizontal,
  paddingVertical: desktopRelationshipParity.rowPaddingVertical,
  radius: desktopRelationshipParity.rowRadius,
  textFontSize: desktopRelationshipParity.textFontSize,
  textFontWeight: desktopRelationshipParity.textFontWeight,
} as const

export const mobileInspectorPlaceholderRowLayoutContract = {
  labelTextSize: desktopPropertyParity.labelTextSize,
  minHeight: desktopPropertyParity.rowMinHeight,
  paddingHorizontal: desktopPropertyParity.rowPaddingHorizontal,
} as const

export function mobileInspectorPlaceholderActionLabel(kind: MobileInspectorPlaceholderActionKind): string {
  return kind === 'property'
    ? mobileText('inspector.properties.addProperty')
    : mobileText('inspector.relationship.add')
}

export function mobileRelationshipValueMetricSegments(
  values: MobileRelationship['values'],
): string[] {
  const seen = new Map<string, number>()

  return values.map((value, index) => {
    const base = relationshipValueBaseSegment(value) || `relationship-${index + 1}`
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)

    return count === 1 ? base : `${base}-${count}`
  })
}

function relationshipValueBaseSegment(value: MobileRelationship['values'][number]) {
  return testIdSegment(value.title)
}

function testIdSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
