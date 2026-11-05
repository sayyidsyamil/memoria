import { describe, expect, it } from 'vitest'
import { visibleMobileWorkspaceSuggestions, type MobileWorkspaceSuggestionItem } from './MobileWorkspaceSuggestionListModel'

const suggestions: MobileWorkspaceSuggestionItem[] = [
  { label: 'First', value: 'first' },
  { label: 'Second', value: 'second' },
  { label: 'Third', value: 'third' },
]

describe('mobile workspace suggestion list', () => {
  it('preserves all suggestions when no visible cap is set', () => {
    expect(visibleMobileWorkspaceSuggestions(suggestions)).toEqual(suggestions)
  })

  it('limits visible suggestions when a form sheet cap is set', () => {
    expect(visibleMobileWorkspaceSuggestions(suggestions, 2)).toEqual(suggestions.slice(0, 2))
  })

  it('treats negative caps as no visible suggestions', () => {
    expect(visibleMobileWorkspaceSuggestions(suggestions, -1)).toEqual([])
  })
})
