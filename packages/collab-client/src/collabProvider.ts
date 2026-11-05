import { Awareness, removeAwarenessStates } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import { awarenessMessage, receive, syncStep1, updateMessage } from '../../protocol/src/collabWire.ts'
import { COLLAB_CLOSE } from '../../protocol/src/index.ts'
import { AwarenessThrottle, keepPresenceFresh, type PresencePacing } from './awarenessPacing.ts'

/**
 * The client end of the collaboration channel: keeps a local `Y.Doc` and its awareness in
 * step with the server's room over one websocket, and reconnects when it drops. Edits made
 * while offline stay in the document and are sent when the connection is back.
 */

/** `connecting`: no socket yet. `syncing`: catching up. `synced`: in step. `offline`: retrying. */
export type CollabStatus = 'connecting' | 'syncing' | 'synced' | 'offline' | 'closed'

/** The part of the browser `WebSocket` the provider uses; `ws` in Node fits too. */
export interface SocketLike {
  binaryType: string
  readyState: number
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  /** The browser passes the close event; its code tells a revoked access from a dropped network. */
  onclose: ((event?: { code?: number }) => void) | null
  onerror: (() => void) | null
  send(data: Uint8Array): void
  close(): void
}

export interface ProviderOptions extends PresencePacing {
  doc: Y.Doc
  /**
   * Opens a websocket to the document. Called for every attempt, because the URL carries a
   * ticket that works once.
   */
  openSocket(): Promise<SocketLike>
  /** Delay before the first reconnect attempt; it doubles up to `maxRetryMs`. */
  retryMs?: number
  maxRetryMs?: number
}

interface AwarenessChange {
  added: number[]
  updated: number[]
  removed: number[]
}

/** Ends something that was started. */
type Stop = () => void

const OPEN = 1
const DEFAULT_RETRY_MS = 500
const DEFAULT_MAX_RETRY_MS = 15_000

/** Ticket answers that will not change by retrying: no credential, no permission, no such document. */
const DENIED_STATUSES = new Set([401, 403, 404])

/** A refused ticket request: the remote backend's errors carry the HTTP status. */
function isDenial(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' && DENIED_STATUSES.has(status)
}

/** A binary frame's bytes, or null for a frame that is not binary. */
type Frame = Uint8Array | null

/** The bytes of a binary frame; null for anything else (a text frame carries nothing of ours). */
function asBytes(data: unknown): Frame {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return data instanceof Uint8Array ? data : null
}

export class CollabProvider {
  readonly doc: Y.Doc
  readonly awareness: Awareness
  private readonly options: ProviderOptions
  private readonly listeners = new Set<(status: CollabStatus) => void>()
  private socket: SocketLike | null = null
  private current: CollabStatus = 'connecting'
  private attempts = 0
  private retry: ReturnType<typeof setTimeout> | null = null
  private readonly outgoingAwareness: AwarenessThrottle
  private readonly stopPresenceRenewal: Stop

  constructor(options: ProviderOptions) {
    this.options = options
    this.doc = options.doc
    this.awareness = new Awareness(options.doc)
    this.outgoingAwareness = new AwarenessThrottle(
      (clients) => this.send(awarenessMessage(this.awareness, clients)),
      options.awarenessThrottleMs,
    )
    this.stopPresenceRenewal = options.presenceTimeoutMs
      ? keepPresenceFresh(this.awareness, options.presenceTimeoutMs, this)
      : () => {}
    this.doc.on('update', this.sendUpdate)
    this.awareness.on('update', this.sendAwareness)
    this.connect()
  }

  get status(): CollabStatus {
    return this.current
  }

  /** Calls the listener now and on every change of status. Returns how to stop. */
  onStatus(listener: (status: CollabStatus) => void): () => void {
    this.listeners.add(listener)
    listener(this.current)
    return () => this.listeners.delete(listener)
  }

  /** Resolves the next time the document is in step with the server. */
  whenSynced(): Promise<void> {
    return new Promise((resolve) => {
      const stop = this.onStatus((status) => {
        if (status !== 'synced') return
        queueMicrotask(() => stop())
        resolve()
      })
    })
  }

  /** Leaves the document: withdraws presence and closes the connection for good. */
  destroy(): void {
    if (this.current === 'closed') return
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'destroy')
    this.outgoingAwareness.flush()
    this.outgoingAwareness.stop()
    this.stopPresenceRenewal()
    this.setStatus('closed')
    if (this.retry) clearTimeout(this.retry)
    this.doc.off('update', this.sendUpdate)
    this.awareness.off('update', this.sendAwareness)
    this.awareness.destroy()
    this.socket?.close()
    this.socket = null
  }

  private connect(): void {
    this.options
      .openSocket()
      .then((socket) => this.attach(socket))
      .catch((error: unknown) => {
        if (isDenial(error)) this.denied(null)
        else this.dropped(null)
      })
  }

  private attach(socket: SocketLike): void {
    if (this.current === 'closed') {
      socket.close()
      return
    }
    this.socket = socket
    socket.binaryType = 'arraybuffer'
    socket.onopen = () => this.opened(socket)
    socket.onmessage = (event) => {
      const bytes = asBytes(event.data)
      if (bytes) this.received(socket, bytes)
    }
    socket.onclose = (event) => {
      if (event?.code === COLLAB_CLOSE.revoked) this.denied(socket)
      else this.dropped(socket)
    }
    socket.onerror = () => socket.close()
    if (socket.readyState === OPEN) this.opened(socket)
  }

  private opened(socket: SocketLike): void {
    if (socket !== this.socket || this.current === 'syncing') return
    this.setStatus('syncing')
    socket.send(syncStep1(this.doc))
    if (this.awareness.getLocalState() !== null) socket.send(awarenessMessage(this.awareness, [this.doc.clientID]))
  }

  private received(socket: SocketLike, data: Uint8Array): void {
    if (socket !== this.socket) return
    let received: ReturnType<typeof receive>
    try {
      received = receive(data, this, { origin: this, readOnly: false })
    } catch {
      // A frame that does not decode means the connection is broken: start over on a new one.
      socket.close()
      return
    }
    const { kind, reply } = received
    if (reply) socket.send(reply)
    if (kind !== 'sync-step2') return
    this.attempts = 0
    this.setStatus('synced')
  }

  private dropped(socket: SocketLike | null): void {
    if (socket !== this.socket || this.current === 'closed') return
    this.socket = null
    this.setStatus('offline')
    // Everyone else is out of sight while offline; they announce themselves again on reconnect.
    const others = [...this.awareness.getStates().keys()].filter((client) => client !== this.doc.clientID)
    removeAwarenessStates(this.awareness, others, this)
    const { retryMs = DEFAULT_RETRY_MS, maxRetryMs = DEFAULT_MAX_RETRY_MS } = this.options
    const delay = Math.min(retryMs * 2 ** this.attempts++, maxRetryMs)
    this.retry = setTimeout(() => this.connect(), delay)
  }

  /**
   * The server withdrew access to the document (TOL-237): the socket closed with `4403`, or a
   * new ticket was refused. The provider closes for good instead of retrying; whoever opened
   * it sees `closed` without having left.
   */
  private denied(socket: SocketLike | null): void {
    if (socket !== this.socket || this.current === 'closed') return
    this.destroy()
  }

  private readonly sendUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin !== this) this.send(updateMessage(update))
  }

  private readonly sendAwareness = ({ added, updated, removed }: AwarenessChange, origin: unknown): void => {
    if (origin !== this) this.outgoingAwareness.push([...added, ...updated, ...removed])
  }

  private send(data: Uint8Array): void {
    if (this.socket?.readyState === OPEN) this.socket.send(data)
  }

  private setStatus(status: CollabStatus): void {
    if (status === this.current) return
    this.current = status
    for (const listener of this.listeners) listener(status)
  }
}
