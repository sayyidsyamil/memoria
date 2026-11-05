import { ACCESS_TICKET_MAX_LIFETIME_MS } from '../../../packages/protocol/src/index.ts'
import type { Access } from './access.ts'

/** An open connection (websocket or change feed) admitted on a subject's access ticket. */
export interface LiveAccess {
  /** Whether what this connection does is still allowed by the subject's remaining access. */
  allowedBy(remaining: Access): boolean
  close(): void
}

export interface Revocation {
  /** What the subject still holds. */
  remaining: Access
  /** Tickets of the subject issued at or before this time are refused. */
  before: number
}

/**
 * Revocations of access tickets: the subject's tickets minted before the revocation are refused
 * for the rest of their (short) life, and its open connections that its remaining access does
 * not cover are closed.
 */
export class Revocations {
  private readonly cutoffs = new Map<string, number>()
  private readonly live = new Map<string, Set<LiveAccess>>()
  private readonly now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  /** Whether a ticket was issued before a revocation of its subject. */
  refuses(access: Access): boolean {
    if (access.subject === null) return false
    const cutoff = this.cutoffs.get(access.subject)
    return cutoff !== undefined && access.issuedAt <= cutoff
  }

  /** Keeps a connection for revocations of `subject`; the returned function forgets it. */
  track(subject: string, connection: LiveAccess): () => void {
    let connections = this.live.get(subject)
    if (!connections) {
      connections = new Set()
      this.live.set(subject, connections)
    }
    connections.add(connection)
    return () => this.forget(subject, connection)
  }

  /** Applies a revocation. Answers how many connections were closed. */
  revoke(subject: string, { remaining, before }: Revocation): number {
    this.dropStale()
    this.cutoffs.set(subject, Math.max(before, this.cutoffs.get(subject) ?? before))
    let closed = 0
    for (const connection of [...(this.live.get(subject) ?? [])]) {
      if (connection.allowedBy(remaining)) continue
      this.forget(subject, connection)
      connection.close()
      closed += 1
    }
    return closed
  }

  private forget(subject: string, connection: LiveAccess): void {
    const connections = this.live.get(subject)
    connections?.delete(connection)
    if (connections?.size === 0) this.live.delete(subject)
  }

  /** A cutoff older than any ticket could live refuses nothing any more. */
  private dropStale(): void {
    const oldest = this.now() - 2 * ACCESS_TICKET_MAX_LIFETIME_MS
    for (const [subject, cutoff] of this.cutoffs) {
      if (cutoff < oldest) this.cutoffs.delete(subject)
    }
  }
}
