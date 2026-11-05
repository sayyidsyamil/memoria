export type MobileWorkspaceSuggestionItem = {
  label: string
  meta?: string
  testId?: string
  value: string
}

export function visibleMobileWorkspaceSuggestions(
  suggestions: MobileWorkspaceSuggestionItem[],
  maxVisibleItems?: number,
) {
  if (typeof maxVisibleItems !== 'number') return suggestions
  return suggestions.slice(0, Math.max(0, maxVisibleItems))
}
