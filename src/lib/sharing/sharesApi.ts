import type { SharedRole } from './vaultAccess'

/**
 * The hosted service's share records (TOL-237 on the API of TOL-18): `/api/shares` on the page's
 * own origin, with the session cookie. A self-hosted server has no such API; the shell then
 * offers no sharing (`unavailable`).
 */

const SHARES = '/api/shares'
const INCOMING = '/api/shares/incoming'

/** `*` for the whole vault, or the path of one note. */
export type ShareScope = string

export interface SharePerson {
  userId: string
  email: string | null
  github: string | null
}

/** A share of the user's own vault. */
export interface OutgoingShare {
  id: string
  scope: ShareScope
  role: SharedRole
  grantee: SharePerson
}

/** Something another user shared with this one ("Shared with me"). */
export interface IncomingShare {
  id: string
  vaultId: string
  scope: ShareScope
  role: SharedRole
  owner: SharePerson | null
}

export interface OutgoingShares {
  /** The user's own vault; null when they have none to share. */
  vaultId: string | null
  shares: OutgoingShare[]
}

/** Why a share request failed, for a message the user can act on. */
export type ShareErrorCode =
  | 'user_not_found'
  | 'invalid_request'
  | 'share_limit'
  | 'rate_limited'
  | 'unavailable'
  | 'failed'

export class ShareApiError extends Error {
  readonly code: ShareErrorCode

  constructor(code: ShareErrorCode) {
    super(`The share request failed: ${code}`)
    this.name = 'ShareApiError'
    this.code = code
  }
}

/** Who to invite: an email address or a GitHub login; a user id names someone already shared with. */
export type Invitee = { email: string } | { github: string } | { userId: string }

const EMAIL = /^[^\s@]+@[^\s@]+$/u
const GITHUB_LOGIN = /^@?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))$/u

/** The invitee the user typed, or null when it is neither an email address nor a GitHub login. */
export function parseInvitee(text: string): { email: string } | { github: string } | null {
  const value = text.trim()
  if (EMAIL.test(value)) return { email: value }
  const login = GITHUB_LOGIN.exec(value)?.[1]
  return login ? { github: login } : null
}

/** How a person is named in the sharing UI: their GitHub login, else their email. */
export function personLabel(person: SharePerson | null): string {
  if (!person) return ''
  return person.github ? `@${person.github}` : person.email ?? person.userId
}

const KNOWN_ERRORS = new Set<ShareErrorCode>(['user_not_found', 'invalid_request', 'share_limit', 'rate_limited'])

/** Statuses that mean there is no share API for this page: not signed in, or no vault service. */
const UNAVAILABLE_STATUSES = new Set([401, 503])

async function errorCode(response: Response): Promise<string | undefined> {
  const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null
  return body?.error?.code
}

function isKnownError(code: string | undefined): code is ShareErrorCode {
  return KNOWN_ERRORS.has(code as ShareErrorCode)
}

async function errorOf(response: Response): Promise<ShareApiError> {
  if (UNAVAILABLE_STATUSES.has(response.status)) return new ShareApiError('unavailable')
  const code = await errorCode(response)
  if (isKnownError(code)) return new ShareApiError(code)
  // A 404 without a share error is a page with no share API behind it.
  return new ShareApiError(response.status === 404 ? 'unavailable' : 'failed')
}

/** The only routes this module calls: the share API of the page's own origin. */
const SHARE_ROUTES = new Set([SHARES])

/** `/api/shares`, `/api/shares/incoming` and `/api/shares/<id>` all belong to the share API. */
function routeOf(path: string): string {
  return path.split('/').slice(0, 3).join('/')
}

function send(path: string, init: RequestInit): Promise<Response> {
  if (SHARE_ROUTES.has(routeOf(path))) {
    return fetch(path, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json', ...init.headers },
    }).catch(() => Promise.reject(new ShareApiError('failed')))
  }
  return Promise.reject(new ShareApiError('failed'))
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await send(path, init)
  if (!response.ok) throw await errorOf(response)
  const body = (await response.json().catch(() => null)) as T | null
  if (body === null) throw new ShareApiError('unavailable')
  return body
}

function isShareList(body: unknown): body is { shares: unknown[] } {
  return typeof body === 'object' && body !== null && Array.isArray((body as { shares?: unknown }).shares)
}

/** The shares of the user's own vault. */
export async function listOutgoingShares(): Promise<OutgoingShares> {
  const body = await call<{ vaultId?: string; shares?: OutgoingShare[] }>(SHARES)
  if (!isShareList(body)) throw new ShareApiError('unavailable')
  return { vaultId: body.vaultId ?? null, shares: body.shares ?? [] }
}

/** What other users shared with this one. */
export async function listIncomingShares(): Promise<IncomingShare[]> {
  const body = await call<{ shares?: IncomingShare[] }>(INCOMING)
  if (!isShareList(body)) throw new ShareApiError('unavailable')
  return body.shares ?? []
}

export interface ShareRequest {
  vaultId: string
  invitee: Invitee
  role: SharedRole
  /** The note to share; none shares the whole vault. */
  path: string | null
}

/** Shares the vault or a note; sharing the same scope with the same person again changes the role. */
export async function createShare({ vaultId, invitee, role, path }: ShareRequest): Promise<OutgoingShare> {
  const body = { ...invitee, role, vaultId, ...(path ? { path } : {}) }
  const { share } = await call<{ share: OutgoingShare }>(SHARES, { method: 'POST', body: JSON.stringify(body) })
  return share
}

/** Gives an existing share another role: the same person and scope, shared again. */
export function changeShareRole(vaultId: string, share: OutgoingShare, role: SharedRole): Promise<OutgoingShare> {
  const path = share.scope === '*' ? null : share.scope
  return createShare({ vaultId, invitee: { userId: share.grantee.userId }, role, path })
}

/** Withdraws a share; the person's open notes close at once. */
export async function revokeShare(id: string): Promise<void> {
  await call<{ revoked: boolean }>(`${SHARES}/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
