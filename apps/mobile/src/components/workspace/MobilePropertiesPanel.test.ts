import { describe, expect, it } from 'vitest'
import {
  mobileInspectorPlaceholderActionLabel,
  mobileInspectorPlaceholderRowLayoutContract,
  mobileInspectorReferenceRowLayoutContract,
  mobileRelationshipValueMetricSegments,
} from './MobilePropertiesPanelModel'
import { desktopPropertyParity, desktopRelationshipParity } from '../../ui/desktopParity'
import type { MobileRelationship } from '../../workspace/mobileWorkspaceModel'

type RelationshipValue = MobileRelationship['values'][number]

describe('mobileRelationshipValueMetricSegments', () => {
  it('keeps reference rows aligned with typed relationship row density', () => {
    expect(mobileInspectorReferenceRowLayoutContract).toEqual({
      iconSize: desktopRelationshipParity.iconSize,
      minHeight: desktopPropertyParity.rowMinHeight,
      paddingHorizontal: desktopRelationshipParity.rowPaddingHorizontal,
      paddingVertical: desktopRelationshipParity.rowPaddingVertical,
      radius: desktopRelationshipParity.rowRadius,
      textFontSize: desktopRelationshipParity.textFontSize,
      textFontWeight: desktopRelationshipParity.textFontWeight,
    })
  })

  it('keeps placeholder add rows aligned with desktop property row density', () => {
    expect(mobileInspectorPlaceholderRowLayoutContract).toEqual({
      labelTextSize: desktopPropertyParity.labelTextSize,
      minHeight: desktopPropertyParity.rowMinHeight,
      paddingHorizontal: desktopPropertyParity.rowPaddingHorizontal,
    })
  })

  it('uses property-specific copy for property placeholder rows', () => {
    expect(mobileInspectorPlaceholderActionLabel('property')).toBe('Add property')
    expect(mobileInspectorPlaceholderActionLabel('relationship')).toBe('Add')
  })

  it('keeps first relationship row metric ids stable for native layout gates', () => {
    expect(mobileRelationshipValueMetricSegments([
      relationshipValue('LLM Workflow'),
      relationshipValue('Memoria MVP'),
    ])).toEqual(['llm-workflow', 'memoria-mvp'])
  })

  it('suffixes only duplicate relationship row ids', () => {
    expect(mobileRelationshipValueMetricSegments([
      relationshipValue('LLM Workflow'),
      relationshipValue('LLM Workflow'),
      relationshipValue('LLM Workflow', '[[Projects/LLM Workflow]]'),
    ])).toEqual([
      'llm-workflow',
      'llm-workflow-2',
      'llm-workflow-3',
    ])
  })
})

function relationshipValue(title: string, ref?: string): RelationshipValue {
  return {
    ref,
    title,
    type: 'Essay',
    typeTone: 'green',
  }
}
