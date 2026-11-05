import { type Awareness, removeAwarenessStates } from 'y-protocols/awareness'

/**
 * How often presence goes over the wire. A caret moves with every keystroke, so its changes
 * are batched; and a client that vanished without a word (no network, a suspended phone) is
 * dropped by the others once it stops renewing its state, long before y-protocols' own 30 s.
 */

export interface PresencePacing {
  /** Sends awareness changes at most once per this many ms; 0 sends each one at once. */
  awarenessThrottleMs?: number
  /** Drops the others not heard from for this long, and renews the own state to stay present. Off when unset. */
  presenceTimeoutMs?: number
}

/** What a browser editor uses: a caret at 10 updates a second, and gone within about 5 s. */
export const BROWSER_PRESENCE_PACING: Required<PresencePacing> = {
  awarenessThrottleMs: 100,
  presenceTimeoutMs: 3_500,
}

/** The own state is renewed, and the others checked, this many times per timeout. */
const CHECKS_PER_TIMEOUT = 3

/** Collects the clients whose awareness changed and sends them together, once per interval. */
export class AwarenessThrottle {
  private readonly pending = new Set<number>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly send: (clients: number[]) => void
  private readonly intervalMs: number

  constructor(send: (clients: number[]) => void, intervalMs = 0) {
    this.send = send
    this.intervalMs = intervalMs
  }

  /** The first change goes at once; the ones that follow within the interval go at its end. */
  push(clients: readonly number[]): void {
    for (const client of clients) this.pending.add(client)
    if (this.timer === null) this.release()
  }

  /** Sends what is waiting now, as before leaving. */
  flush(): void {
    if (this.pending.size === 0) return
    const clients = [...this.pending]
    this.pending.clear()
    this.send(clients)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending.clear()
  }

  private release(): void {
    this.flush()
    if (this.intervalMs <= 0) return
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.pending.size > 0) this.release()
    }, this.intervalMs)
  }
}

/** The other clients whose state was last renewed more than `timeoutMs` ago. */
export function staleClients(awareness: Awareness, timeoutMs: number, now: number): number[] {
  const stale: number[] = []
  for (const [client, meta] of awareness.meta) {
    const present = client !== awareness.clientID && awareness.states.has(client)
    if (present && now - meta.lastUpdated > timeoutMs) stale.push(client)
  }
  return stale
}

/**
 * Renews the own state and drops the silent others, `origin` marking the drops as local so
 * they are not sent. Returns how to stop.
 */
export function keepPresenceFresh(awareness: Awareness, timeoutMs: number, origin: unknown): () => void {
  const tick = () => {
    const own = awareness.getLocalState()
    if (own !== null) awareness.setLocalState(own)
    const stale = staleClients(awareness, timeoutMs, Date.now())
    if (stale.length > 0) removeAwarenessStates(awareness, stale, origin)
  }
  const timer = setInterval(tick, timeoutMs / CHECKS_PER_TIMEOUT)
  return () => clearInterval(timer)
}
