import { Access } from './access.ts'
import { accessTicketKey, isAccessTicket, readAccessTicket } from './accessTickets.ts'
import type { Revocations } from './accessRevocations.ts'
import { isAuthorized } from './httpIo.ts'
import { ACCOUNT } from './rateLimit.ts'

/** Who a request is, for the rate limits, and what it may do. */
export interface Credential {
  /** The rate limit and connection bucket: the token's account, or one per ticket subject. */
  account: string
  access: Access
}

const BEARER = /^Bearer (\S+)$/

export function subjectAccount(subject: string): string {
  return `subject:${subject}`
}

/** Reads the bearer credential of a request: the server token, or an access ticket signed with it. */
export class Credentials {
  private readonly token: string
  private readonly key: Buffer
  private readonly revocations: Revocations
  private readonly now: () => number

  constructor(token: string, revocations: Revocations, now: () => number = Date.now) {
    this.token = token
    this.key = accessTicketKey(token)
    this.revocations = revocations
    this.now = now
  }

  /** Null for a missing, wrong, expired or revoked credential. */
  of(authorization: string | undefined): Credential | null {
    if (isAuthorized(authorization, this.token)) return { account: ACCOUNT, access: Access.OWNER }
    const credential = BEARER.exec(authorization ?? '')?.[1] ?? ''
    if (!isAccessTicket(credential)) return null
    const access = readAccessTicket(credential, this.key, this.now())
    if (!access?.subject || this.revocations.refuses(access)) return null
    return { account: subjectAccount(access.subject), access }
  }
}
