import type { MobileNote } from './mobileWorkspaceModel'
import { normalizedMobileSearchQuery, sortMobileNotesByIdentityMatch } from './mobileNoteSearch'
import { mobileWikilinkTargetForNote } from './mobileWikilinks'
import {
  deduplicateByPath,
  disambiguateTitles,
  MAX_RESULTS as MAX_WIKILINK_SUGGESTIONS,
  MIN_QUERY_LENGTH as MIN_WIKILINK_QUERY_LENGTH,
} from '../../../../src/utils/wikilinkSuggestions'

type CursorOffset = number
type MarkdownContent = string
type WikilinkQuery = string
type WikilinkTarget = string
type PersonMentionQuery = string
type EmojiShortcodeQuery = string
type MobileWikilinkSuggestionNote = MobileNote & { path: string }
type InlineQueryOptions = {
  invalidQuery: (query: string) => boolean
  replacement: (target: WikilinkTarget, nextCharacter: string) => string
  trigger: string
  validBoundary?: (text: string, triggerIndex: number) => boolean
}

export type MobileWikilinkAutocompleteMatch = {
  cursor: CursorOffset
  query: WikilinkQuery
  start: CursorOffset
}

export type MobileWikilinkAutocompleteReplacement = {
  cursor: CursorOffset
  text: MarkdownContent
}

const wikilinkQueryOptions: InlineQueryOptions = {
  invalidQuery: (query) => query.includes(']') || query.includes('\n'),
  replacement: (target) => `[[${target}]]`,
  trigger: '[[',
}
const personMentionQueryOptions: InlineQueryOptions = {
  invalidQuery: (query) => query.includes('@') || query.includes(']') || /\s/u.test(query),
  replacement: personMentionReplacement,
  trigger: '@',
  validBoundary: hasPersonMentionBoundary,
}
const emojiShortcodeQueryOptions: InlineQueryOptions = {
  invalidQuery: (query) => query.includes(':') || /\s/u.test(query),
  replacement: (emoji) => emoji,
  trigger: ':',
  validBoundary: hasInlineShortcutBoundary,
}

export function activeMobileWikilinkQuery(
  text: MarkdownContent,
  cursor: CursorOffset,
): MobileWikilinkAutocompleteMatch | null {
  return activeMobileInlineQuery(text, cursor, wikilinkQueryOptions)
}

export function replaceActiveMobileWikilinkQuery(
  text: MarkdownContent,
  cursor: CursorOffset,
  target: WikilinkTarget,
): MobileWikilinkAutocompleteReplacement | null {
  return replaceActiveMobileInlineQuery(text, cursor, target, wikilinkQueryOptions)
}

export function mobileWikilinkAutocompleteSuggestions(
  notes: MobileNote[],
  query: WikilinkQuery,
): MobileNote[] {
  const candidates = notes.filter((note) => !note.archived)
  if (query.length < MIN_WIKILINK_QUERY_LENGTH) return []

  return finalizeMobileWikilinkSuggestions(sortMobileNotesByIdentityMatch(candidates, query))
}

export const mobileWikilinkAutocompleteTarget = mobileWikilinkTargetForNote

export type MobilePersonMentionAutocompleteMatch = {
  cursor: CursorOffset
  query: PersonMentionQuery
  start: CursorOffset
}

export function activeMobilePersonMentionQuery(
  text: MarkdownContent,
  cursor: CursorOffset,
): MobilePersonMentionAutocompleteMatch | null {
  return activeMobileInlineQuery(text, cursor, personMentionQueryOptions)
}

export function replaceActiveMobilePersonMentionQuery(
  text: MarkdownContent,
  cursor: CursorOffset,
  target: WikilinkTarget,
): MobileWikilinkAutocompleteReplacement | null {
  return replaceActiveMobileInlineQuery(text, cursor, target, personMentionQueryOptions)
}

export type MobileEmojiShortcodeAutocompleteMatch = {
  cursor: CursorOffset
  query: EmojiShortcodeQuery
  start: CursorOffset
}

export function activeMobileEmojiShortcodeQuery(
  text: MarkdownContent,
  cursor: CursorOffset,
): MobileEmojiShortcodeAutocompleteMatch | null {
  const match = activeMobileInlineQuery(text, cursor, emojiShortcodeQueryOptions)
  return match && match.query.length > 0 ? match : null
}

export function replaceActiveMobileEmojiShortcodeQuery(
  text: MarkdownContent,
  cursor: CursorOffset,
  emoji: string,
): MobileWikilinkAutocompleteReplacement | null {
  return replaceActiveMobileInlineQuery(text, cursor, emoji, emojiShortcodeQueryOptions)
}

export function mobilePersonMentionAutocompleteSuggestions(
  notes: MobileNote[],
  query: PersonMentionQuery,
): MobileNote[] {
  const normalizedQuery = normalizedMobileSearchQuery(query)
  if (normalizedQuery.length === 0) return []

  const matchingNotes = notes
    .filter((note) => !note.archived && note.type === 'Person')
    .filter((note) => mobilePersonMentionMatchesQuery(note, normalizedQuery))

  return finalizeMobileWikilinkSuggestions(
    sortMobileNotesByIdentityMatch(matchingNotes, normalizedQuery),
  )
}

function finalizeMobileWikilinkSuggestions(notes: MobileNote[]): MobileNote[] {
  return prepareMobileWikilinkSuggestions(notes)
    .slice(0, MAX_WIKILINK_SUGGESTIONS)
}

function prepareMobileWikilinkSuggestions(notes: MobileNote[]): MobileNote[] {
  return disambiguateTitles(deduplicateByPath(notes.map(toMobileWikilinkSuggestionNote)))
}

function mobileWikilinkIdentityPath(note: MobileNote): string {
  return note.path ?? note.id
}

function toMobileWikilinkSuggestionNote(note: MobileNote): MobileWikilinkSuggestionNote {
  return { ...note, path: mobileWikilinkIdentityPath(note) }
}

function boundedTextCursor(text: MarkdownContent, cursor: CursorOffset): CursorOffset {
  if (!Number.isFinite(cursor)) return text.length
  return Math.max(0, Math.min(cursor, text.length))
}

function hasPersonMentionBoundary(text: string, triggerIndex: number): boolean {
  return hasInlineShortcutBoundary(text, triggerIndex)
}

function hasInlineShortcutBoundary(text: string, triggerIndex: number): boolean {
  if (triggerIndex === 0) return true

  const previous = text.at(triggerIndex - 1)
  return /[\s([{:>,-]/u.test(previous ?? '')
}

function mobilePersonMentionMatchesQuery(note: MobileNote, normalizedQuery: string): boolean {
  return [
    note.title,
    ...(note.aliases ?? []),
  ].some((value) => normalizedMobileSearchQuery(value).includes(normalizedQuery))
}

function activeMobileInlineQuery(
  text: MarkdownContent,
  cursor: CursorOffset,
  options: InlineQueryOptions,
): MobileWikilinkAutocompleteMatch | null {
  const boundedCursor = boundedTextCursor(text, cursor)
  const beforeCursor = text.slice(0, boundedCursor)
  const triggerIndex = beforeCursor.lastIndexOf(options.trigger)
  if (triggerIndex === -1 || options.validBoundary?.(beforeCursor, triggerIndex) === false) return null

  const query = beforeCursor.slice(triggerIndex + options.trigger.length)
  if (options.invalidQuery(query)) return null

  return {
    cursor: boundedCursor,
    query,
    start: triggerIndex,
  }
}

function replaceActiveMobileInlineQuery(
  text: MarkdownContent,
  cursor: CursorOffset,
  target: WikilinkTarget,
  options: InlineQueryOptions,
): MobileWikilinkAutocompleteReplacement | null {
  const match = activeMobileInlineQuery(text, cursor, options)
  if (!match) return null

  const replacement = options.replacement(target, text.at(match.cursor) ?? '')
  return {
    cursor: match.start + replacement.length,
    text: `${text.slice(0, match.start)}${replacement}${text.slice(match.cursor)}`,
  }
}

function personMentionReplacement(target: WikilinkTarget, nextCharacter: string): string {
  return `[[${target}]]${/\s/u.test(nextCharacter) ? '' : ' '}`
}
