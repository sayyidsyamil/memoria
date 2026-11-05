import { randomBytes } from 'node:crypto'
import type { CollabAccess, CollabTicketResponse } from '../../../../packages/protocol/src/index.ts'
import { ROUTES } from '../../../../packages/protocol/src/index.ts'
import type { Access } from '../access.ts'
import type { DocId } from '../docIndex.ts'

/**
 * Browsers cannot put an `Authorization` header on a websocket. A client that holds the
 * bearer token asks for a ticket over HTTP and opens the websocket with it: the ticket is
 * random, opens one document once, and expires within a minute, so it is safe in a URL.
 */

export interface Grant {
  docId: DocId
  access: CollabAccess
  /** The credential the ticket was asked for with, when it was an access ticket: revocations follow it. */
  holder?: Access
}

interface Issued extends Grant {
  expiresAt: number
}

const TICKET_BYTES = 32
export const TICKET_LIFETIME_MS = 60_000

export class TicketBook {
  private readonly issued = new Map<string, Issued>()
  private readonly now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  issue(grant: Grant): CollabTicketResponse {
    this.dropExpired()
    const ticket = randomBytes(TICKET_BYTES).toString('base64url')
    const expiresAt = this.now() + TICKET_LIFETIME_MS
    this.issued.set(ticket, { ...grant, expiresAt })
    return {
      ticket,
      expiresAt: new Date(expiresAt).toISOString(),
      path: `${ROUTES.collabDocs}/${grant.docId}`,
      access: grant.access,
    }
  }

  /** What a ticket gives on a document, or null. A ticket works once. */
  redeem(ticket: string, docId: DocId): Grant | null {
    const found = this.issued.get(ticket)
    if (!found) return null
    this.issued.delete(ticket)
    if (found.docId !== docId || found.expiresAt <= this.now()) return null
    return { docId: found.docId, access: found.access, holder: found.holder }
  }

  private dropExpired(): void {
    const now = this.now()
    for (const [ticket, { expiresAt }] of this.issued) {
      if (expiresAt <= now) this.issued.delete(ticket)
    }
  }
}
