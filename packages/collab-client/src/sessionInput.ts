/**
 * What a person or a link may ask the collaborative page to open. Everything here comes from
 * a form, a URL or session storage; it is checked before any of it reaches the server, which
 * checks paths and credentials again on its side.
 */

export interface SessionInput {
  token: string
  name: string
  note: string
}

const MAX_TOKEN_LENGTH = 512
const MAX_NAME_LENGTH = 64
const MAX_NOTE_BYTES = 1024
const NOTE_EXTENSION = '.md'
const LAST_C0_CONTROL = 0x1f
const DELETE = 0x7f
const LAST_C1_CONTROL = 0x9f
const TOKEN = /^[\x21-\x7e]+$/u

function isControl(character: string): boolean {
  const code = character.codePointAt(0) ?? 0
  return code <= LAST_C0_CONTROL || (code >= DELETE && code <= LAST_C1_CONTROL)
}

function hasControl(text: string): boolean {
  return [...text].some(isControl)
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isToken(token: string): boolean {
  return token.length <= MAX_TOKEN_LENGTH && TOKEN.test(token)
}

function isName(name: string): boolean {
  return name !== '' && name.length <= MAX_NAME_LENGTH && !hasControl(name)
}

function isSegment(segment: string): boolean {
  return segment !== '' && segment !== '.' && segment !== '..' && !segment.toLowerCase().startsWith('.git')
}

/** A vault path of a note, by the path rules of the remote protocol. */
export function isNotePath(note: string): boolean {
  if (!note.endsWith(NOTE_EXTENSION) || hasControl(note) || note.includes('\\')) return false
  if (new TextEncoder().encode(note).length > MAX_NOTE_BYTES) return false
  return note.split('/').every(isSegment)
}

/** The input, trimmed, when every part of it is acceptable; otherwise null. */
export function validSession(input: Partial<Record<keyof SessionInput, unknown>>): SessionInput | null {
  const session = { token: asText(input.token), name: asText(input.name), note: asText(input.note) }
  return isToken(session.token) && isName(session.name) && isNotePath(session.note) ? session : null
}
