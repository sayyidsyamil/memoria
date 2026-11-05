import { VaultError } from './errors.ts'

/**
 * Request rate limits, so one client cannot exhaust the vault container. One bearer token is
 * one account (docs/web/protocol.md, "Authentication and transport"), and so is each subject of
 * access tickets (`credentials.ts`); callers without valid credentials share an anonymous bucket,
 * so a flood of bad credentials never slows an account down.
 */

export interface RateLimit {
  /** Requests a bucket gains per second. */
  perSecond: number
  /** Requests a full bucket allows at once. */
  burst: number
}

export const DEFAULT_RATE_LIMIT: RateLimit = { perSecond: 50, burst: 500 }

export const ACCOUNT = 'account'
export const ANONYMOUS = 'anonymous'

class TokenBucket {
  private readonly limit: RateLimit
  private tokens: number
  private updatedAt: number

  constructor(limit: RateLimit, now: number) {
    this.limit = limit
    this.tokens = limit.burst
    this.updatedAt = now
  }

  /** Takes one request: 0 when it may go now, else the milliseconds until it may. */
  take(now: number): number {
    const refill = ((now - this.updatedAt) / 1000) * this.limit.perSecond
    this.tokens = Math.min(this.limit.burst, this.tokens + refill)
    this.updatedAt = now
    if (this.tokens >= 1) {
      this.tokens -= 1
      return 0
    }
    return Math.ceil(((1 - this.tokens) / this.limit.perSecond) * 1000)
  }
}

/** One token bucket per account. */
export class RateLimiter {
  private readonly buckets = new Map<string, TokenBucket>()
  private readonly limit: RateLimit
  private readonly now: () => number

  constructor(limit: RateLimit, now: () => number = Date.now) {
    this.limit = limit
    this.now = now
  }

  /** Charges one request to `account`: 0 when it may go now, else the milliseconds to wait. */
  take(account: string): number {
    const now = this.now()
    let bucket = this.buckets.get(account)
    if (!bucket) {
      bucket = new TokenBucket(this.limit, now)
      this.buckets.set(account, bucket)
    }
    return bucket.take(now)
  }
}

/** The `Retry-After` value for a wait: whole seconds, at least one. */
export function retryAfterSeconds(waitMs: number): number {
  return Math.max(1, Math.ceil(waitMs / 1000))
}

/** `429 rate_limited`; the reply carries `Retry-After`. */
export class RateLimited extends VaultError {
  readonly retryAfterSeconds: number

  constructor(waitMs: number) {
    const seconds = retryAfterSeconds(waitMs)
    super(429, 'rate_limited', `too many requests: try again in ${seconds} s`, { retryAfterSeconds: seconds })
    this.retryAfterSeconds = seconds
  }
}
