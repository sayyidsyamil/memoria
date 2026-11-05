import {
  ACCESS_ROLES,
  ACCESS_VAULT_SCOPE,
  ROUTES,
  type AccessGrant,
  type AccessRole,
  type VaultAccess,
} from '../../../packages/protocol/src/index'
import { remoteVaultConfig } from '../vaultBackend/remoteConfig'
import { currentSharedVaultId } from './sharedVaultLocation'

/**
 * What the user may do in the vault this page shows (TOL-237). The own vault is the owner's;
 * a vault shared with the user is read only until `GET /v1/vault` says what its `access`
 * grants, so nothing is written on a viewer's behalf meanwhile.
 *
 * - `owner`: everything (the own vault, the desktop app, demo data).
 * - `checking`: a shared vault whose access is not known yet.
 * - `shared`: the grants the server reported.
 * - `revoked`: the share is gone; the server no longer shows this vault to the user.
 */
export type VaultAccessState =
  | { kind: 'owner' }
  | { kind: 'checking' }
  | { kind: 'shared'; access: VaultAccess }
  | { kind: 'revoked' }

export type SharedRole = Exclude<AccessRole, 'owner'>

const OWNER: VaultAccessState = { kind: 'owner' }
const CHECKING: VaultAccessState = { kind: 'checking' }
const REVOKED: VaultAccessState = { kind: 'revoked' }
/** Answers that mean the vault is not (or no longer) shared with the user. */
const REFUSED_STATUSES = new Set([401, 403, 404])
const RETRY_MS = 5_000
const ROLE_RANK = new Map<AccessRole, number>([['viewer', 1], ['editor', 2], ['owner', 3]])

function rank(role: AccessRole): number {
  return ROLE_RANK.get(role) ?? 0
}

function grantCovers(grant: AccessGrant, path: string): boolean {
  return grant.scope === ACCESS_VAULT_SCOPE || grant.scope === path
}

/** The strongest role the grants give on `path`, or null when none covers it. */
export function roleOn(grants: readonly AccessGrant[], path: string): AccessRole | null {
  let best: AccessRole | null = null
  for (const grant of grants) {
    if (!grantCovers(grant, path)) continue
    if (!best || rank(grant.role) > rank(best)) best = grant.role
  }
  return best
}

function sharedGrants(state: VaultAccessState): readonly AccessGrant[] {
  return state.kind === 'shared' ? state.access.grants : []
}

function writesWith(role: AccessRole | null): boolean {
  return role === 'editor' || role === 'owner'
}

/** True when the user may change the note at `path`. */
export function canWritePath(state: VaultAccessState, path: string): boolean {
  if (state.kind === 'owner') return true
  return writesWith(roleOn(sharedGrants(state), path))
}

/** True when the user may add, move or delete files: the owner, or an editor of the whole vault. */
export function canChangeVault(state: VaultAccessState): boolean {
  if (state.kind === 'owner') return true
  return writesWith(roleOn(sharedGrants(state), ACCESS_VAULT_SCOPE))
}

/** The role to show for a shared vault: editor when any grant lets the user write. */
export function sharedRoleOf(state: VaultAccessState): SharedRole | null {
  if (state.kind !== 'shared') return null
  return state.access.grants.some((grant) => writesWith(grant.role)) ? 'editor' : 'viewer'
}

/** True when nothing in the vault may be changed: a viewer, a share being checked, or a revoked one. */
export function isViewOnly(state: VaultAccessState): boolean {
  if (state.kind === 'owner') return false
  return sharedRoleOf(state) !== 'editor'
}

function isGrant(value: unknown): value is AccessGrant {
  const grant = value as Partial<AccessGrant> | null
  return typeof grant?.scope === 'string' && grant.scope !== '' && ACCESS_ROLES.includes(grant.role as AccessRole)
}

/** A well-formed `access` of `GET /v1/vault`; anything else is not trusted with any role. */
function isVaultAccess(value: unknown): value is VaultAccess {
  const access = value as Partial<VaultAccess> | null
  const subjectOk = access?.subject === null || (typeof access?.subject === 'string' && access.subject !== '')
  return subjectOk && Array.isArray(access?.grants) && access.grants.every(isGrant)
}

/** Owner only as the server reports the token: no subject and `owner` on the whole vault. */
function isOwnerAccess(access: VaultAccess): boolean {
  return access.subject === null && roleOn(access.grants, ACCESS_VAULT_SCOPE) === 'owner'
}

/** What the answer grants; null (still unknown, so read only) when it is malformed. */
function fromAccess(value: unknown): VaultAccessState | null {
  if (!isVaultAccess(value)) return null
  if (isOwnerAccess(value)) return OWNER
  return value.subject === null ? null : { kind: 'shared', access: value }
}

// ── The page's state ────────────────────────────────────────────────────────

let state: VaultAccessState | null = null
let check: Promise<void> | null = null
let retry: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function initialState(): VaultAccessState {
  return remoteVaultConfig() && currentSharedVaultId() ? CHECKING : OWNER
}

export function getVaultAccess(): VaultAccessState {
  state ??= initialState()
  return state
}

export function subscribeVaultAccess(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publish(next: VaultAccessState): void {
  state = next
  for (const listener of listeners) listener()
}

async function fetchAccess(): Promise<VaultAccessState | null> {
  const remote = remoteVaultConfig()
  if (!remote) return null
  const response = await fetch(`${remote.baseUrl}${ROUTES.vault}`, {
    headers: { authorization: `Bearer ${remote.token}` },
    cache: 'no-store',
  })
  if (REFUSED_STATUSES.has(response.status)) return REVOKED
  if (!response.ok) return null
  const body = (await response.json().catch(() => null)) as { access?: unknown } | null
  return fromAccess(body?.access)
}

function scheduleRetry(): void {
  if (retry || getVaultAccess().kind !== 'checking') return
  retry = setTimeout(() => {
    retry = null
    void checkVaultAccess()
  }, RETRY_MS)
}

/**
 * Asks the server what the user may do in this page's shared vault, once at a time. The own
 * vault needs no answer. A failure keeps what is known and tries again while still unknown.
 */
export function checkVaultAccess(): Promise<void> {
  if (!currentSharedVaultId() || getVaultAccess().kind === 'revoked') return Promise.resolve()
  check ??= fetchAccess()
    .then((next) => {
      if (next) publish(next)
      else scheduleRetry()
    }, scheduleRetry)
    .finally(() => {
      check = null
    })
  return check
}

/** A live document was refused (a revoke or downgrade): find out what is left. */
export function reportAccessDenied(): void {
  void checkVaultAccess()
}

export class ViewOnlyAccessError extends Error {
  constructor(action: string) {
    super(`This vault was shared with you to view, so ${action} is not possible`)
    this.name = 'ViewOnlyAccessError'
  }
}

/** Refuses a change in a vault the user may only view, before anything is sent. */
export function assertSharedVaultWritable(action: string): void {
  if (isViewOnly(getVaultAccess())) throw new ViewOnlyAccessError(action)
}

/** Tests only: forget the page's state. */
export function resetVaultAccessForTests(next: VaultAccessState | null = null): void {
  if (retry) clearTimeout(retry)
  retry = null
  check = null
  state = next
  listeners.clear()
}
