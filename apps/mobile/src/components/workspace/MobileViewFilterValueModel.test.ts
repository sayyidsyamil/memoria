import { describe, expect, it } from 'vitest'
import type { MobileViewFilterCondition } from '../../workspace/mobileWorkspaceModel'
import {
  mobileViewFilterConditionWithOperator,
  mobileViewFilterDatePreviewLabel,
  mobileViewFilterRegexIsInvalid,
  mobileViewFilterRegexSupported,
  mobileViewFilterValueFromText,
  mobileViewFilterValueInputKind,
  mobileViewFilterValueText,
  mobileViewFilterValueWithSuggestion,
} from './MobileViewFilterValueModel'

describe('MobileViewFilterValueModel', () => {
  it('uses desktop date value semantics for before and after operators', () => {
    expect(mobileViewFilterValueInputKind('before')).toBe('date')
    expect(mobileViewFilterValueInputKind('after')).toBe('date')
    expect(mobileViewFilterValueInputKind('contains')).toBe('text')
  })

  it('previews parsed date filter values with desktop relative-date semantics', () => {
    const reference = new Date('2026-04-07T12:00:00Z')

    expect(mobileViewFilterDatePreviewLabel('2026-04-01', reference)).toBe('April 1, 2026')
    expect(mobileViewFilterDatePreviewLabel('10 days ago', reference)).toBe('March 28, 2026')
    expect(mobileViewFilterDatePreviewLabel('eventually', reference)).toBeNull()
  })

  it('validates regex-enabled text filters like desktop', () => {
    expect(mobileViewFilterRegexSupported('contains')).toBe(true)
    expect(mobileViewFilterRegexSupported('before')).toBe(false)
    expect(mobileViewFilterRegexIsInvalid(filterCondition({ value: '(' }))).toBe(true)
    expect(mobileViewFilterRegexIsInvalid(filterCondition({ regex: false, value: '(' }))).toBe(false)
    expect(mobileViewFilterRegexIsInvalid(filterCondition({ op: 'before', value: '(' }))).toBe(false)
    expect(mobileViewFilterRegexIsInvalid(filterCondition({ value: 'workflow|essay' }))).toBe(false)
  })

  it('round-trips desktop list-valued filter operators as comma-list arrays', () => {
    expect(mobileViewFilterValueText(filterCondition({
      op: 'any_of',
      value: ['Design', 'AI, UX'],
    }))).toBe('Design, "AI, UX"')
    expect(mobileViewFilterValueFromText('any_of', 'Design, "AI, UX"')).toEqual(['Design', 'AI, UX'])
    expect(mobileViewFilterValueFromText('none_of', '')).toEqual([])
    expect(mobileViewFilterValueFromText('equals', 'Design, AI')).toBe('Design, AI')
  })

  it('completes active list-valued filter suggestions without dropping existing values', () => {
    expect(mobileViewFilterValueWithSuggestion(filterCondition({
      op: 'any_of',
      value: ['Design', 'A'],
    }), 'AI')).toEqual(['Design', 'AI'])
    expect(mobileViewFilterValueWithSuggestion(filterCondition({
      op: 'any_of',
      value: ['Design', 'des'],
    }), 'Design')).toEqual(['Design'])
    expect(mobileViewFilterValueWithSuggestion(filterCondition({
      op: 'equals',
      value: 'A',
    }), 'AI')).toBe('AI')
  })

  it('normalizes values when switching operators so saved view YAML stays desktop-compatible', () => {
    expect(mobileViewFilterConditionWithOperator(filterCondition({
      op: 'contains',
      regex: true,
      value: 'Design',
    }), 'is_empty')).toEqual({
      field: 'title',
      op: 'is_empty',
    })
    expect(mobileViewFilterConditionWithOperator(filterCondition({
      op: 'contains',
      regex: true,
      value: 'Design, AI',
    }), 'any_of')).toEqual({
      field: 'title',
      op: 'any_of',
      value: ['Design', 'AI'],
    })
    expect(mobileViewFilterConditionWithOperator(filterCondition({
      op: 'any_of',
      regex: true,
      value: ['Design', 'AI, UX'],
    }), 'equals')).toEqual({
      field: 'title',
      op: 'equals',
      regex: true,
      value: 'Design, "AI, UX"',
    })
  })
})

function filterCondition(
  overrides: Partial<MobileViewFilterCondition>,
): MobileViewFilterCondition {
  return {
    field: 'title',
    op: 'contains',
    regex: true,
    value: '',
    ...overrides,
  }
}
