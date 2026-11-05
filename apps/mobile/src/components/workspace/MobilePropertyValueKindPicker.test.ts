import { describe, expect, it } from 'vitest'
import { mobileText } from '../../i18n/mobileText'
import { mobileSpace } from '../../ui/tokens'
import { mobilePropertyValueChoiceLayoutContract } from './MobileWorkspaceActionSheetModel'
import { mobilePropertyValueKindOptions } from './mobilePropertyValueKindOptions'

describe('mobile property value kind picker', () => {
  it('keeps the desktop display-mode option order', () => {
    expect(mobilePropertyValueKindOptions.map((option) => option.kind)).toEqual([
      'string',
      'number',
      'date',
      'boolean',
      'status',
      'url',
      'list',
      'color',
    ])
  })

  it('keeps the mobile labels aligned with the desktop display-mode menu', () => {
    expect(mobilePropertyValueKindOptions.map((option) => mobileText(option.labelKey))).toEqual([
      'Text',
      'Number',
      'Date',
      'Boolean',
      'Status',
      'URL',
      'Tags',
      'Color',
    ])
  })

  it('keeps value kind choices rendered as compact native controls', () => {
    expect(mobilePropertyValueChoiceLayoutContract).toEqual({
      gap: mobileSpace.xs,
      minHeight: 30,
      minWidth: 58,
      paddingHorizontal: mobileSpace.sm,
      radius: 6,
    })
  })
})
