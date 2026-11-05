/**
 * When an edited document is written to its file. Two rules, whichever comes first:
 *  - `idleMs` after the last edit: someone stopped typing;
 *  - `maxWaitMs` after the first edit that is not in the file yet: someone never stops.
 */
export interface FlushPolicy {
  idleMs: number
  maxWaitMs: number
}

export const DEFAULT_FLUSH_POLICY: FlushPolicy = { idleMs: 5_000, maxWaitMs: 60_000 }

export interface Timers {
  now(): number
  set(callback: () => void, delayMs: number): unknown
  clear(handle: unknown): void
}

const REAL_TIMERS: Timers = {
  now: () => Date.now(),
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
}

/** When the next flush is due, given the first unwritten edit and the latest edit. */
export function flushDue(policy: FlushPolicy, firstEditAt: number, lastEditAt: number): number {
  return Math.min(lastEditAt + policy.idleMs, firstEditAt + policy.maxWaitMs)
}

/**
 * The times at which a policy flushes for edits at the given times (ascending). Used to
 * compare policies on a recorded editing session without waiting for it to replay.
 */
export function simulateFlushes(policy: FlushPolicy, editTimes: readonly number[]): number[] {
  const flushes: number[] = []
  let firstEditAt: number | null = null
  let lastEditAt = 0
  for (const time of editTimes) {
    if (firstEditAt !== null && flushDue(policy, firstEditAt, lastEditAt) <= time) {
      flushes.push(flushDue(policy, firstEditAt, lastEditAt))
      firstEditAt = null
    }
    firstEditAt ??= time
    lastEditAt = time
  }
  if (firstEditAt !== null) flushes.push(flushDue(policy, firstEditAt, lastEditAt))
  return flushes
}

/** Calls `flush` when the policy says an edited document is due. */
export class FlushScheduler {
  private readonly policy: FlushPolicy
  private readonly flush: () => void
  private readonly timers: Timers
  private firstEditAt: number | null = null
  private timer: unknown = null

  constructor(policy: FlushPolicy, flush: () => void, timers: Timers = REAL_TIMERS) {
    this.policy = policy
    this.flush = flush
    this.timers = timers
  }

  /** True while an edit is waiting to be written. */
  get pending(): boolean {
    return this.firstEditAt !== null
  }

  /** Records an edit. */
  touch(): void {
    const now = this.timers.now()
    this.firstEditAt ??= now
    this.cancelTimer()
    const delay = flushDue(this.policy, this.firstEditAt, now) - now
    this.timer = this.timers.set(() => this.fire(), Math.max(delay, 0))
  }

  /** Forgets the pending edit: the caller is writing it now, or the document is gone. */
  reset(): void {
    this.cancelTimer()
    this.firstEditAt = null
  }

  private fire(): void {
    this.reset()
    this.flush()
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.timers.clear(this.timer)
    this.timer = null
  }
}
