import type { MobileNote } from './mobileWorkspaceModel'
import {
  mobileNoteIdentitySearchMatch,
  mobileQuickOpenSearchText,
  normalizedMobileSearchQuery,
  type MobileNoteSearchMatch,
} from './mobileNoteSearch'

export type MobileQuickOpenDirection = 'next' | 'previous'

export const mobileQuickOpenResultLimit = 16
const noQuickOpenMatch: MobileNoteSearchMatch = {
  match: false,
  rank: Number.POSITIVE_INFINITY,
  score: 0,
}

export function mobileQuickOpenResults(
  notes: MobileNote[],
  query: string,
  limit = mobileQuickOpenResultLimit,
): MobileNote[] {
  const normalizedQuery = normalizedMobileSearchQuery(query)
  const activeNotes = notes.filter((note) => !note.archived)
  if (!normalizedQuery) return activeNotes.slice(0, limit)

  return activeNotes
    .map((note, index) => ({
      index,
      match: mobileQuickOpenRankNote(note, normalizedQuery),
      note,
    }))
    .filter(({ match }) => match.match)
    .sort((left, right) => (
      left.match.rank - right.match.rank ||
      right.match.score - left.match.score ||
      left.index - right.index
    ))
    .map(({ note }) => note)
    .slice(0, limit)
}

export function mobileQuickOpenMoveIndex(
  currentIndex: number,
  resultCount: number,
  direction: MobileQuickOpenDirection,
): number {
  if (resultCount <= 0) return 0
  if (direction === 'next') return Math.min(currentIndex + 1, resultCount - 1)

  return Math.max(currentIndex - 1, 0)
}

export function mobileQuickOpenSelectedNote(
  results: MobileNote[],
  selectedIndex: number,
): MobileNote | null {
  return results.at(selectedIndex) ?? null
}

function mobileQuickOpenRankNote(note: MobileNote, normalizedQuery: string): MobileNoteSearchMatch {
  const identityMatch = mobileNoteIdentitySearchMatch(note, normalizedQuery)
  if (identityMatch.match) return identityMatch

  const fullText = mobileQuickOpenSearchText(note)
  const textIndex = fullText.indexOf(normalizedQuery)
  if (textIndex === -1) return noQuickOpenMatch

  return {
    match: true,
    rank: 6,
    score: -textIndex,
  }
}
