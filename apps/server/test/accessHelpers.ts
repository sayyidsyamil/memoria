import type { AccessGrant, AccessTicketPayload } from '../../../packages/protocol/src/index.ts'
import { accessTicketKey, signAccessTicket } from '../src/accessTickets.ts'

export const TOKEN = 'test-token-0123456789'
export const NOTE = 'projects/alpha.md'
export const OTHER_NOTE = 'welcome.md'

/** A ticket signed with the test token, as a front end would mint it for a user. */
export function accessTicket(sub: string, grants: AccessGrant[], times: Partial<Pick<AccessTicketPayload, 'iat' | 'exp'>> = {}): string {
  const iat = times.iat ?? Date.now()
  return signAccessTicket({ v: 1, sub, grants, iat, exp: times.exp ?? iat + 60_000 }, accessTicketKey(TOKEN))
}

export const VAULT_VIEWER = (): string => accessTicket('viewer-1', [{ scope: '*', role: 'viewer' }])
export const VAULT_EDITOR = (): string => accessTicket('editor-1', [{ scope: '*', role: 'editor' }])
export const NOTE_EDITOR = (): string => accessTicket('note-editor-1', [{ scope: NOTE, role: 'editor' }])
export const NOTE_VIEWER = (): string => accessTicket('note-viewer-1', [{ scope: NOTE, role: 'viewer' }])
export const OWNER_TICKET = (): string => accessTicket('owner-1', [{ scope: '*', role: 'owner' }])

export function bearer(credential: string): Record<string, string> {
  return { authorization: `Bearer ${credential}` }
}
