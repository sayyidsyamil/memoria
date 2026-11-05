import { userColor } from '../../../../packages/collab-client/src/presence'
import { type SessionInput, validSession } from '../../../../packages/collab-client/src/sessionInput'

/** What the page needs to open a note: who is editing, which note, and the server token. */
export interface CollabSession {
  token: string
  name: string
  color: string
  note: string
}

const STORAGE_KEY = 'memoria:collab-session'
const NOTE_PARAM = 'note'

function stored(): Partial<CollabSession> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}')
    return parsed instanceof Object ? parsed : {}
  } catch {
    return {}
  }
}

/** The note named in the URL, so a link opens the same note for everyone. */
export function noteFromLocation(search: string = window.location.search): string {
  return new URLSearchParams(search).get(NOTE_PARAM) ?? ''
}

function withColor(input: SessionInput): CollabSession {
  return { ...input, color: userColor(input.name) }
}

/** The session kept for this tab, if it is complete and valid. The token never leaves session storage. */
export function loadSession(): CollabSession | null {
  const { token, name, note } = stored()
  const valid = validSession({ token, name, note: noteFromLocation() || note })
  return valid ? withColor(valid) : null
}

/** Keeps a valid session for this tab and puts its note in the URL. Null: the input was refused. */
export function saveSession(input: SessionInput): CollabSession | null {
  const valid = validSession(input)
  if (!valid) return null
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(valid))
  const url = new URL(window.location.href)
  url.searchParams.set(NOTE_PARAM, valid.note)
  window.history.replaceState(null, '', url)
  return withColor(valid)
}
