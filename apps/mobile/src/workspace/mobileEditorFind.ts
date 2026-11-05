import {
  buildEditorFindReplacementChange,
  buildEditorFindReplacementChanges,
  clampEditorFindIndex,
  findEditorMatches,
  type EditorFindChange,
  type EditorFindMatch,
  type EditorFindOptions,
} from '../../../../src/utils/editorFind'

export type MobileEditorFindOptions = EditorFindOptions

export type MobileEditorFindSnapshot = {
  activeIndex: number
  activeMatch: EditorFindMatch | null
  error: string | null
  hasMatches: boolean
  matchCount: number
}

export function mobileEditorFindSnapshot(
  content: string,
  query: string,
  options: MobileEditorFindOptions,
  activeIndex: number,
): MobileEditorFindSnapshot {
  const result = findEditorMatches(content, query, options)
  const clampedIndex = clampEditorFindIndex(activeIndex, result.matches.length)
  const activeMatch = result.matches.at(clampedIndex) ?? null

  return {
    activeIndex: clampedIndex,
    activeMatch,
    error: result.error,
    hasMatches: result.error === null && result.matches.length > 0,
    matchCount: result.matches.length,
  }
}

export function nextMobileEditorFindIndex(
  currentIndex: number,
  matchCount: number,
  direction: 1 | -1,
): number {
  if (matchCount <= 0) return 0
  return (clampEditorFindIndex(currentIndex, matchCount) + direction + matchCount) % matchCount
}

export function replaceCurrentMobileEditorFindMatch({
  activeIndex,
  content,
  options,
  query,
  replacement,
}: {
  activeIndex: number
  content: string
  options: MobileEditorFindOptions
  query: string
  replacement: string
}): string | null {
  const snapshot = mobileEditorFindSnapshot(content, query, options, activeIndex)
  if (!snapshot.activeMatch || !snapshot.hasMatches) return null

  return applyMobileEditorFindChanges(content, [
    buildEditorFindReplacementChange(snapshot.activeMatch, query, replacement, options),
  ])
}

export function replaceAllMobileEditorFindMatches({
  content,
  options,
  query,
  replacement,
}: {
  content: string
  options: MobileEditorFindOptions
  query: string
  replacement: string
}): string | null {
  const result = findEditorMatches(content, query, options)
  if (result.error !== null || result.matches.length === 0) return null

  return applyMobileEditorFindChanges(
    content,
    buildEditorFindReplacementChanges(result.matches, query, replacement, options),
  )
}

export function applyMobileEditorFindChanges(
  content: string,
  changes: readonly EditorFindChange[],
): string {
  return [...changes]
    .sort((left, right) => right.from - left.from)
    .reduce((updatedContent, change) => (
      `${updatedContent.slice(0, change.from)}${change.insert}${updatedContent.slice(change.to)}`
    ), content)
}
