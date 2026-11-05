import { createHash } from 'node:crypto'
import {
  ACCESS_ROLES,
  ACCESS_VAULT_SCOPE,
  type AccessGrant,
  type AccessRole,
  type VaultAccess,
} from '../../../packages/protocol/src/index.ts'
import type { CoAuthor } from './coAuthors.ts'
import { notFound, VaultError } from './errors.ts'

/**
 * What one request may do in the vault (protocol 1.9, ADR 0296). The bearer token is the owner;
 * an access ticket gives its subject roles on the whole vault (`*`) or on single notes:
 *
 * - `viewer` reads what its scope covers;
 * - `editor` also writes the content of what its scope covers;
 * - creating, moving and deleting files, folders and imports needs `editor` on the vault;
 * - revoking needs `owner`, which only the vault scope can carry.
 *
 * A path outside every grant is answered as if it did not exist.
 */
/** `*` (the whole vault) or the path of a file in it: what a grant covers, and what a request touches. */
export type Scope = string

export class Access {
  /** The bearer token. */
  static readonly OWNER = new Access(null, [{ scope: ACCESS_VAULT_SCOPE, role: 'owner' }], 0)

  readonly subject: string | null
  readonly grants: readonly AccessGrant[]
  /** When the ticket was minted; 0 for the token. */
  readonly issuedAt: number
  /** The token, or `owner` on the whole vault. */
  readonly isOwner: boolean
  /** Who the subject is in git, when the ticket says (since 1.10). */
  readonly author: CoAuthor | null

  constructor(subject: string | null, grants: readonly AccessGrant[], issuedAt: number, author: CoAuthor | null = null) {
    this.subject = subject
    this.grants = grants
    this.issuedAt = issuedAt
    this.author = author
    this.isOwner = subject === null || this.rankOn(ACCESS_VAULT_SCOPE) >= OWNER
  }

  /**
   * Who the commits this access causes name besides the owner, who makes them: nobody for the
   * owner, so the owner's commits stay exactly as they were (ADR 0297).
   */
  coAuthors(): CoAuthor[] {
    if (this.isOwner || !this.author) return []
    return [this.author]
  }

  /** The strongest role any grant gives on `path`, or null. */
  role(path: Scope): AccessRole | null {
    let best = NONE
    for (const grant of this.grants) {
      best = Math.max(best, rankIn(grant, path))
    }
    if (best === NONE) return null
    return ACCESS_ROLES[best]
  }

  canRead(path: Scope): boolean {
    return this.rankOn(path) >= VIEWER
  }

  canWrite(path: Scope): boolean {
    return this.rankOn(path) >= EDITOR
  }


  /** Whether every read and write this access allows is also allowed by `other`. */
  coveredBy(other: Access): boolean {
    return this.grants.every((grant) => other.rankOn(grant.scope) >= rank(grant.role))
  }

  /** Readable entries only: the owner sees everything unfiltered. */
  visible<T>(items: T[], pathOf: (item: T) => string): T[] {
    return this.isOwner ? items : items.filter((item) => this.canRead(pathOf(item)))
  }

  /** Tells apart the views of the same vault head that two accesses get, for entity tags. */
  viewTag(): string {
    if (this.isOwner) return ''
    const digest = createHash('sha256').update(JSON.stringify([this.subject, this.grants])).digest('base64url')
    return `.${digest.slice(0, 16)}`
  }

  describe(): VaultAccess {
    return { subject: this.subject, grants: [...this.grants] }
  }

  requireRead(path: Scope): void {
    if (!this.canRead(path)) throw notFound(path)
  }

  requireWrite(path: Scope): void {
    this.requireRead(path)
    if (!this.canWrite(path)) throw REFUSALS.readOnly()
  }

  /** Creating, moving or deleting files. */
  requireVaultWrite(): void {
    if (!this.canWrite(ACCESS_VAULT_SCOPE)) throw REFUSALS.structure()
  }

  /** Any write at all, for routes such as `POST /v1/sync` that change no particular file. */
  requireSomeWrite(): void {
    if (!this.grants.some((grant) => rank(grant.role) >= EDITOR)) throw REFUSALS.readOnly()
  }

  requireOwner(): void {
    if (!this.isOwner) throw REFUSALS.ownerOnly()
  }

  private rankOn(path: Scope): number {
    const role = this.role(path)
    if (role === null) return NONE
    return rank(role)
  }
}

const NONE = -1
const [VIEWER, EDITOR, OWNER] = [0, 1, 2]

function rank(role: AccessRole): number {
  return ACCESS_ROLES.indexOf(role)
}

/** The rank a grant gives on `path`, NONE when it does not cover it. */
function rankIn(grant: AccessGrant, path: Scope): number {
  if (grant.scope !== ACCESS_VAULT_SCOPE && grant.scope !== path) return NONE
  return rank(grant.role)
}

const REFUSALS = {
  readOnly: () => new VaultError(403, 'forbidden', 'this access is read-only here'),
  structure: () => new VaultError(403, 'forbidden', 'this access cannot add, move or delete files'),
  ownerOnly: () => new VaultError(403, 'forbidden', 'only the vault owner can do this'),
}
