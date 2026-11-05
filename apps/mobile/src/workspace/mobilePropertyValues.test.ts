import { describe, expect, it } from 'vitest'
import {
  canSubmitMobilePropertyValue,
  mobilePropertyValueFormText,
  mobilePropertyValueKind,
  mobilePropertyValueKindForKey,
  mobilePropertySuggestionValue,
  mobilePropertyValueTextForKindChange,
  parseMobilePropertyValue,
} from './mobilePropertyValues'

describe('mobile property values', () => {
  it('infers the editable value kind from existing values', () => {
    expect(mobilePropertyValueKind('Priority', 'High')).toBe('string')
    expect(mobilePropertyValueKind('Estimate', 13)).toBe('number')
    expect(mobilePropertyValueKind('Shipped', true)).toBe('boolean')
    expect(mobilePropertyValueKind('Areas', ['Design'])).toBe('list')
    expect(mobilePropertyValueKind('tags', 'Design')).toBe('list')
    expect(mobilePropertyValueKind('Status', 'Shipped')).toBe('status')
    expect(mobilePropertyValueKind('Date', '2026-06-14')).toBe('date')
    expect(mobilePropertyValueKind('deadline', 'active')).toBe('string')
    expect(mobilePropertyValueKind('due', '02/25/2026')).toBe('date')
    expect(mobilePropertyValueKind('due_date', '2026-01-15T10:00')).toBe('date')
    expect(mobilePropertyValueKind('due', '2026-6-1')).toBe('string')
    expect(mobilePropertyValueKind('due', '02/30/2026')).toBe('string')
    expect(mobilePropertyValueKind('URL', 'https://example.com')).toBe('url')
    expect(mobilePropertyValueKind('accent_color', '#3b82f6')).toBe('color')
    expect(mobilePropertyValueKind('custom', '#3b82f699')).toBe('color')
    expect(mobilePropertyValueKind('fill', 'red')).toBe('color')
    expect(mobilePropertyValueKind('background', 'blue')).toBe('color')
    expect(mobilePropertyValueKind('custom_field', 'red')).toBe('string')
    expect(mobilePropertyValueKind('background', '#zzzzzz')).toBe('string')
  })

  it('uses desktop-style key patterns for suggested property kinds', () => {
    expect(mobilePropertyValueKindForKey('tags', 'string')).toBe('list')
    expect(mobilePropertyValueKindForKey('labels', 'string')).toBe('list')
    expect(mobilePropertyValueKindForKey('Status', 'string')).toBe('status')
    expect(mobilePropertyValueKindForKey('Due Date', 'string')).toBe('date')
    expect(mobilePropertyValueKindForKey('URL', 'string')).toBe('url')
    expect(mobilePropertyValueKindForKey('Brand color', 'string')).toBe('color')
    expect(mobilePropertyValueKindForKey('fill', 'string')).toBe('color')
    expect(mobilePropertyValueKindForKey('accentSurface', 'string')).toBe('color')
    expect(mobilePropertyValueKindForKey('Priority', 'number')).toBe('number')
  })

  it('uses persisted desktop display modes before heuristic value detection', () => {
    const displayModes = {
      Assignee: 'tags',
      Estimate: 'number',
      Priority: 'status',
    } as const

    expect(mobilePropertyValueKind('Priority', 'High', displayModes)).toBe('status')
    expect(mobilePropertyValueKind('Estimate', '13', displayModes)).toBe('number')
    expect(mobilePropertyValueKindForKey('Assignee', 'string', displayModes)).toBe('list')
  })

  it('serializes typed values from form text', () => {
    expect(parseMobilePropertyValue({ key: 'tags', kind: 'string', valueText: 'AI, Design' })).toEqual(['AI', 'Design'])
    expect(parseMobilePropertyValue({ key: 'tags', kind: 'string', valueText: 'Design, "AI, UX", Mobile' })).toEqual(['Design', 'AI, UX', 'Mobile'])
    expect(parseMobilePropertyValue({ key: 'tags', kind: 'string', valueText: "'Owner''s Plan', Research" })).toEqual(["Owner's Plan", 'Research'])
    expect(parseMobilePropertyValue({ key: 'Estimate', kind: 'number', valueText: '13.5' })).toBe(13.5)
    expect(parseMobilePropertyValue({ key: 'Estimate', kind: 'number', valueText: 'later' })).toBe('later')
    expect(parseMobilePropertyValue({ key: 'Published', kind: 'boolean', valueText: 'yes' })).toBe(true)
    expect(parseMobilePropertyValue({ key: 'Published', kind: 'boolean', valueText: 'false' })).toBe(false)
    expect(parseMobilePropertyValue({ key: 'Priority', kind: 'string', valueText: ' High ' })).toBe('High')
    expect(parseMobilePropertyValue({ key: 'Date', kind: 'date', valueText: ' 2026-06-14 ' })).toBe('2026-06-14')
    expect(parseMobilePropertyValue({ key: 'Date', kind: 'date', valueText: '2026-01-15T10:00' })).toBe('2026-01-15')
    expect(parseMobilePropertyValue({ key: 'Date', kind: 'date', valueText: '02/25/2026' })).toBe('2026-02-25')
    expect(parseMobilePropertyValue({ key: 'Status', kind: 'status', valueText: ' Active ' })).toBe('Active')
    expect(parseMobilePropertyValue({ key: 'URL', kind: 'url', valueText: ' https://example.com ' })).toBe('https://example.com')
    expect(parseMobilePropertyValue({ key: 'Brand color', kind: 'color', valueText: ' #3b82f6 ' })).toBe('#3b82f6')
  })

  it('matches desktop submit validation for number property values', () => {
    expect(canSubmitMobilePropertyValue({ key: 'Estimate', kind: 'number', valueText: '13.5' })).toBe(true)
    expect(canSubmitMobilePropertyValue({ key: 'Estimate', kind: 'number', valueText: '-1' })).toBe(true)
    expect(canSubmitMobilePropertyValue({ key: 'Estimate', kind: 'number', valueText: '' })).toBe(false)
    expect(canSubmitMobilePropertyValue({ key: 'Estimate', kind: 'number', valueText: 'later' })).toBe(false)
    expect(canSubmitMobilePropertyValue({ key: 'Priority', kind: 'string', valueText: 'later' })).toBe(true)
    expect(canSubmitMobilePropertyValue({ key: '', kind: 'string', valueText: 'later' })).toBe(false)
  })

  it('matches desktop submit validation for date property values', () => {
    expect(canSubmitMobilePropertyValue({ key: 'Date', kind: 'date', valueText: '2026-06-14' })).toBe(true)
    expect(canSubmitMobilePropertyValue({ key: 'Date', kind: 'date', valueText: '2026-06-14T10:00' })).toBe(true)
    expect(canSubmitMobilePropertyValue({ key: 'Date', kind: 'date', valueText: '02/25/2026' })).toBe(true)
    expect(canSubmitMobilePropertyValue({ key: 'Date', kind: 'date', valueText: '' })).toBe(true)
    expect(canSubmitMobilePropertyValue({ key: 'Date', kind: 'date', valueText: '2026-6-14' })).toBe(false)
    expect(canSubmitMobilePropertyValue({ key: 'Date', kind: 'date', valueText: '02/30/2026' })).toBe(false)
  })

  it('formats existing values for editing', () => {
    expect(mobilePropertyValueFormText(['AI', 'Design'])).toBe('AI, Design')
    expect(mobilePropertyValueFormText(['AI, UX', 'Design'])).toBe('"AI, UX", Design')
    expect(mobilePropertyValueFormText(false)).toBe('false')
    expect(mobilePropertyValueFormText(8)).toBe('8')
  })

  it('normalizes boolean value text when switching kinds', () => {
    expect(mobilePropertyValueTextForKindChange('no', 'boolean')).toBe('false')
    expect(mobilePropertyValueTextForKindChange('', 'boolean')).toBe('true')
    expect(mobilePropertyValueTextForKindChange('8', 'number')).toBe('8')
  })

  it('completes the active comma segment for every list-valued property', () => {
    expect(mobilePropertySuggestionValue({
      key: 'Areas',
      kind: 'list',
      suggestion: 'Research',
      valueText: 'Design, res',
    })).toBe('Design, Research')
    expect(mobilePropertySuggestionValue({
      key: 'Areas',
      kind: 'list',
      suggestion: 'Design',
      valueText: 'Design, des',
    })).toBe('Design')
    expect(mobilePropertySuggestionValue({
      key: 'Areas',
      kind: 'list',
      suggestion: 'Research',
      valueText: '"AI, UX", res',
    })).toBe('"AI, UX", Research')
    expect(mobilePropertySuggestionValue({
      key: 'Priority',
      kind: 'string',
      suggestion: 'High',
      valueText: 'H',
    })).toBe('High')
  })
})
