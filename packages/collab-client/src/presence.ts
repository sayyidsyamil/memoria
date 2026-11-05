/**
 * Who is in a document, read from its awareness states. Each client publishes
 * `{ user: { name, color } }`, which is also what BlockNote's cursors show.
 */

export interface PresentUser {
  clientId: number
  name: string
  color: string
  /** True for the client looking at the list. */
  self: boolean
}

/** Text and cursor colours that stay readable on light and dark editor backgrounds. */
export const PRESENCE_COLORS = ['#d9480f', '#2f9e44', '#1971c2', '#9c36b5', '#c2255c', '#0c8599', '#e67700', '#5f3dc4'] as const

const FALLBACK_NAME = '?'
/** Longer names a peer announces are cut: a name only has to be told apart, not read in full. */
export const MAX_NAME_LENGTH = 64

interface AnnouncedUser {
  name?: unknown
  color?: unknown
}

/** The `user` a client announced in its awareness state, if any. */
function announcedUser(state: unknown): AnnouncedUser | null {
  const user = state instanceof Object ? (state as { user?: unknown }).user : undefined
  return user instanceof Object ? (user as AnnouncedUser) : null
}

/** A peer's announced name, trimmed and cut to `MAX_NAME_LENGTH` characters. */
export function safeName(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed === '' ? FALLBACK_NAME : [...trimmed].slice(0, MAX_NAME_LENGTH).join('')
}

/** The only colour form a peer may announce; anything else is replaced by a palette colour. */
const HEX_COLOR = /^#[0-9a-f]{6}$/iu

/** A peer's announced colour when it is a plain `#rrggbb`, else null. */
export function safeColor(value: unknown): string | null {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value : null
}

/** A stable colour for a name, so a person looks the same to everyone. */
export function userColor(name: string): string {
  let hash = 0
  for (const character of name) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 1_000_003
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length]
}

/**
 * A colour for one open document: two windows of the same device share a name, so their
 * carets are told apart by colour. Everyone sees it, because it is published with the name.
 */
export function clientColor(clientId: number): string {
  const index = Number.isFinite(clientId) ? Math.abs(Math.trunc(clientId)) : 0
  return PRESENCE_COLORS[index % PRESENCE_COLORS.length]
}

/** Up to two letters standing for a name: "Ada Lovelace" is "AL". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean)
  const letters = words.length > 1 ? [words[0], words.at(-1) as string] : words
  const short = letters.map((word) => [...word][0]).join('')
  return (short || FALLBACK_NAME).toLocaleUpperCase()
}

/** Everyone who announced a user, the viewer first, the others by name. */
export function presentUsers(states: ReadonlyMap<number, unknown>, selfId: number): PresentUser[] {
  const users: PresentUser[] = []
  for (const [clientId, state] of states) {
    const user = announcedUser(state)
    if (!user) continue
    const name = safeName(user.name)
    users.push({ clientId, name, color: safeColor(user.color) ?? userColor(name), self: clientId === selfId })
  }
  return users.sort((a, b) => Number(b.self) - Number(a.self) || a.name.localeCompare(b.name))
}
