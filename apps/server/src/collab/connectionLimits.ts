import type { WebSocket } from 'ws'
import { COLLAB_CLOSE } from '../../../../packages/protocol/src/index.ts'

/** Limits of the collaboration channel, so one client cannot hold the container's sockets or memory. */
export interface ConnectionLimits {
  /** Open websockets of one account, over every document. */
  perAccount: number
  /** Open websockets of one document. */
  perDoc: number
  /** A socket that sends nothing, not even a pong to the server's ping, for this long is closed. */
  idleTimeoutMs: number
}

export const DEFAULT_CONNECTION_LIMITS: ConnectionLimits = { perAccount: 128, perDoc: 32, idleTimeoutMs: 60_000 }

function increment(counts: Map<string, number>, key: string, by: number): void {
  const count = (counts.get(key) ?? 0) + by
  if (count > 0) counts.set(key, count)
  else counts.delete(key)
}

/** Counts the open websockets per account and per document. */
export class ConnectionCounter {
  private readonly limits: ConnectionLimits
  private readonly accounts = new Map<string, number>()
  private readonly docs = new Map<string, number>()

  constructor(limits: ConnectionLimits) {
    this.limits = limits
  }

  /** Takes a place for one websocket: the function that frees it, or null when either limit is reached. */
  admit(account: string, docId: string): (() => void) | null {
    if ((this.accounts.get(account) ?? 0) >= this.limits.perAccount) return null
    if ((this.docs.get(docId) ?? 0) >= this.limits.perDoc) return null
    increment(this.accounts, account, 1)
    increment(this.docs, docId, 1)
    let freed = false
    return () => {
      if (freed) return
      freed = true
      increment(this.accounts, account, -1)
      increment(this.docs, docId, -1)
    }
  }
}

/**
 * Pings a websocket every `timeoutMs` and closes it with `4408` when nothing arrived since the
 * last ping. Browsers answer pings on their own, so only a dead or stuck peer is closed.
 */
export function watchIdle(ws: WebSocket, timeoutMs: number): void {
  let heard = true
  const hear = (): void => {
    heard = true
  }
  const timer = setInterval(() => {
    if (!heard) {
      clearInterval(timer)
      ws.close(COLLAB_CLOSE.idle, 'nothing received for too long')
      return
    }
    heard = false
    ws.ping()
  }, timeoutMs)
  ws.on('message', hear)
  ws.on('pong', hear)
  ws.on('close', () => clearInterval(timer))
}
