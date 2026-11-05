import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { type RawData, type WebSocket, WebSocketServer } from 'ws'
import {
  COLLAB_CLOSE,
  COLLAB_MAX_MESSAGE_BYTES,
  COLLAB_TICKET_PARAM,
  type CollabAccess,
  ROUTES,
} from '../../../../packages/protocol/src/index.ts'
import type { Access } from '../access.ts'
import type { Revocations } from '../accessRevocations.ts'
import { type Credential, type Credentials, subjectAccount } from '../credentials.ts'
import type { DocId, DocIndex } from '../docIndex.ts'
import { singleHeader } from '../httpIo.ts'
import { ACCOUNT, ANONYMOUS, type RateLimiter, retryAfterSeconds } from '../rateLimit.ts'
import { type ConnectionCounter, watchIdle } from './connectionLimits.ts'
import type { CollabHub, Connection } from './hub.ts'
import type { TicketBook } from './tickets.ts'

export interface UpgradeOptions {
  hub: CollabHub
  tickets: TicketBook
  docs: DocIndex
  /** The bearer token or an access ticket, on upgrades that can send headers. */
  credentials: Credentials
  /** Closes sockets admitted on access tickets when their access is revoked. */
  revocations: Revocations
  maxMessageBytes: number
  /** Every upgrade is charged: an admitted one to the account, a refused one like an HTTP request. */
  limiter: RateLimiter
  connections: ConnectionCounter
  idleTimeoutMs: number
  log(message: string): void
}

interface Admission {
  docId: DocId
  access: CollabAccess
  /** Set when the socket was admitted on an access ticket, directly or through a collab ticket. */
  holder?: Access
}

const DOC_PREFIX = `${ROUTES.collabDocs}/`
const REFUSALS = new Map([
  [401, 'Unauthorized'],
  [404, 'Not Found'],
  [429, 'Too Many Requests'],
])
const INTERNAL_ERROR = 1011
const MESSAGE_TOO_BIG = 1009

/** Thrown with the HTTP status the upgrade is refused with. */
class Refusal extends Error {
  readonly status: number
  /** Seconds for `Retry-After`, when trying again later helps. */
  readonly retryAfter?: number

  constructor(status: number, retryAfter?: number) {
    super(`upgrade refused with ${status}`)
    this.status = status
    this.retryAfter = retryAfter
  }
}

function bytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data)
  return data instanceof ArrayBuffer ? new Uint8Array(data) : data
}

function credentialOf(request: IncomingMessage, { credentials }: UpgradeOptions): Credential | null {
  return credentials.of(singleHeader(request.headers, 'authorization'))
}

/** Header credentials open a document with the most they allow on it; one that allows nothing finds no document. */
function admitCredential(docId: DocId, path: string, { access }: Credential): Admission {
  if (!access.canRead(path)) throw new Refusal(404)
  return { docId, access: access.canWrite(path) ? 'write' : 'read', holder: access.subject === null ? undefined : access }
}

/** A collab ticket asked for on an access ticket stops working once that access is revoked. */
function admitTicket(url: URL, docId: DocId, { tickets, revocations }: UpgradeOptions): Admission {
  const grant = tickets.redeem(url.searchParams.get(COLLAB_TICKET_PARAM) ?? '', docId)
  if (!grant || isRevoked(grant.holder, revocations)) throw new Refusal(401)
  return { docId, access: grant.access, holder: grant.holder }
}

function isRevoked(holder: Access | undefined, revocations: Revocations): boolean {
  return holder !== undefined && revocations.refuses(holder)
}

/** Who may open which document: the bearer token or an access ticket, or a ticket issued for this document. */
function admit(request: IncomingMessage, options: UpgradeOptions): Admission {
  const url = new URL(request.url ?? '/', 'http://vault.invalid')
  const docId = url.pathname.startsWith(DOC_PREFIX) ? url.pathname.slice(DOC_PREFIX.length) : ''
  const path = options.docs.pathOf(docId)
  if (!path) throw new Refusal(404)
  const credential = credentialOf(request, options)
  return credential ? admitCredential(docId, path, credential) : admitTicket(url, docId, options)
}

/** Charges one upgrade to `account`'s request bucket; a `429` refusal once it is empty. */
function charge(account: string, limiter: RateLimiter): void {
  const wait = limiter.take(account)
  if (wait > 0) throw new Refusal(429, retryAfterSeconds(wait))
}

/**
 * Admits the upgrade, or charges its refusal to the bucket an HTTP request with the same
 * credentials would use: the anonymous one without the token, so refusals cost the account nothing.
 */
function admitCharged(request: IncomingMessage, options: UpgradeOptions): Admission {
  try {
    return admit(request, options)
  } catch (refusal) {
    charge(credentialOf(request, options)?.account ?? ANONYMOUS, options.limiter)
    throw refusal
  }
}

/**
 * Takes the account's place for one more websocket on this document, freed when its TCP socket
 * closes, however the upgrade ends. The account is the token's, or the subject's when the socket
 * was admitted on an access ticket.
 */
function reserve(socket: Duplex, { docId, holder }: Admission, { limiter, connections }: UpgradeOptions): void {
  const account = holder?.subject ? subjectAccount(holder.subject) : ACCOUNT
  charge(account, limiter)
  const release = connections.admit(account, docId)
  if (!release) throw new Refusal(429)
  socket.once('close', release)
}

function refuse(socket: Duplex, error: unknown): void {
  const status = error instanceof Refusal ? error.status : 401
  const retry = error instanceof Refusal && error.retryAfter ? `Retry-After: ${error.retryAfter}\r\n` : ''
  socket.end(`HTTP/1.1 ${status} ${REFUSALS.get(status)}\r\n${retry}Connection: close\r\nContent-Length: 0\r\n\r\n`)
}

/**
 * Messages that arrive while the document is still opening. They are held up to the size of
 * one message in total: a client has no reason to send more before it has the document.
 */
export class WaitingRoom {
  private readonly held: Uint8Array[] = []
  private readonly limit: number
  private bytes = 0

  constructor(limit: number) {
    this.limit = limit
  }

  /** False when holding this message would exceed the limit; nothing more is held then. */
  hold(data: Uint8Array): boolean {
    this.bytes += data.byteLength
    if (this.bytes > this.limit) {
      this.held.length = 0
      return false
    }
    this.held.push(data)
    return true
  }

  release(): Uint8Array[] {
    this.bytes = 0
    return this.held.splice(0)
  }
}

/** One websocket from the upgrade until it is in its room, and from then on. */
class Arrival {
  private readonly ws: WebSocket
  private readonly waiting: WaitingRoom
  private connection: Connection | null = null
  private closed = false

  constructor(ws: WebSocket, maxMessageBytes: number) {
    this.ws = ws
    this.waiting = new WaitingRoom(maxMessageBytes)
  }

  message(data: Uint8Array): void {
    if (this.connection) this.connection.receive(data)
    else if (!this.waiting.hold(data)) this.ws.close(MESSAGE_TOO_BIG, 'too much sent before the document opened')
  }

  close(): void {
    this.closed = true
    this.connection?.closed()
  }

  /** The document is open. Null: the hub would not take the connection. */
  joined(connection: Connection | null): void {
    if (!connection) {
      this.ws.close(INTERNAL_ERROR, 'the document is not available')
      return
    }
    this.connection = connection
    if (this.closed) connection.closed()
    for (const data of this.waiting.release()) connection.receive(data)
  }
}

/** A socket admitted on an access ticket closes when a revocation leaves its subject without what it opened. */
function followRevocations(ws: WebSocket, { docId, access, holder }: Admission, { docs, revocations }: UpgradeOptions): void {
  if (!holder?.subject) return
  const allowedBy = (remaining: Access): boolean => {
    const path = docs.pathOf(docId) ?? ''
    return access === 'read' ? remaining.canRead(path) : remaining.canWrite(path)
  }
  const close = (): void => ws.close(COLLAB_CLOSE.revoked, 'access to this document was revoked')
  const forget = revocations.track(holder.subject, { allowedBy, close })
  ws.on('close', forget)
}

/** Joins a websocket to its document. Messages that arrive while the document opens wait. */
function serve(ws: WebSocket, admission: Admission, options: UpgradeOptions): void {
  const { docId, access } = admission
  const { hub, log, maxMessageBytes, idleTimeoutMs } = options
  const arrival = new Arrival(ws, maxMessageBytes)
  followRevocations(ws, admission, options)
  watchIdle(ws, idleTimeoutMs)
  ws.on('message', (data) => arrival.message(bytes(data)))
  ws.on('close', () => arrival.close())
  ws.on('error', (error) => log(`collab: websocket error: ${error.message}`))
  const socket = { send: (data: Uint8Array) => ws.send(data), close: (code: number, reason: string) => ws.close(code, reason) }
  hub
    .connect(docId, socket, access, admission.holder?.coAuthors())
    .then((joined) => arrival.joined(joined))
    .catch((error: unknown) => {
      log(`collab: opening document ${docId} failed: ${error instanceof Error ? error.message : String(error)}`)
      ws.close(INTERNAL_ERROR, 'the document could not be opened')
    })
}

/** Serves the collaboration channel on the HTTP server's websocket upgrades. */
export function attachCollab(server: Server, options: UpgradeOptions): WebSocketServer {
  // The websocket layer closes a connection that sends more, before the frame is buffered.
  const maxPayload = Math.min(options.maxMessageBytes, COLLAB_MAX_MESSAGE_BYTES)
  const sockets = new WebSocketServer({ noServer: true, maxPayload })
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    try {
      const admission = admitCharged(request, options)
      reserve(socket, admission, options)
      sockets.handleUpgrade(request, socket, head, (ws) => serve(ws, admission, options))
    } catch (error) {
      refuse(socket, error)
    }
  })
  return sockets
}
