import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import { COLLAB_MAX_MESSAGE_BYTES, COLLAB_MESSAGE } from './index.ts'

/**
 * The websocket messages of the collaboration channel: y-protocols sync and awareness,
 * framed as y-websocket frames them, so stock Yjs providers can connect. Used by the server
 * and by the web client. Kept out of `index.ts`, which has no dependency at all.
 */

export interface Shared {
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
}

export interface Sender {
  /** Passed to Yjs as the origin of what this message changes. */
  origin: object
  /** A read-only sender may ask for the document but not change it. */
  readOnly: boolean
  /**
   * Decides whether a change may be applied. Given the update before it touches the document;
   * returning false makes `receive` throw `RejectedChange`, and `'later'` leaves the change out
   * without blaming the sender, for a change that cannot be judged yet. Absent: every change is
   * applied.
   */
  accept?(update: Uint8Array): boolean | 'later'
  /**
   * Whether the sender may publish the presence of an awareness client id. Entries of an
   * awareness update for other ids are dropped before it is applied. Absent: all are applied.
   */
  ownsClient?(clientId: number): boolean
}

/** Thrown by `receive` for a change the receiver's `accept` turned down. Nothing was applied. */
export class RejectedChange extends Error {
  constructor() {
    super('the change was rejected')
    this.name = 'RejectedChange'
  }
}

/** What an incoming message was, and the answer to send back when it asks for one. */
export interface Received {
  kind: 'sync-step1' | 'sync-step2' | 'update' | 'awareness' | 'awareness-query' | 'unknown'
  reply?: Uint8Array
}

type Reader = (decoder: decoding.Decoder, shared: Shared, sender: Sender) => Received

function message(type: number, write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, type)
  write(encoder)
  return encoding.toUint8Array(encoder)
}

/** "This is what I have": the peer answers with what is missing. */
export function syncStep1(doc: Y.Doc): Uint8Array {
  return message(COLLAB_MESSAGE.sync, (encoder) => syncProtocol.writeSyncStep1(encoder, doc))
}

export function updateMessage(update: Uint8Array): Uint8Array {
  return message(COLLAB_MESSAGE.sync, (encoder) => syncProtocol.writeUpdate(encoder, update))
}

export function awarenessMessage(awareness: awarenessProtocol.Awareness, clients: number[]): Uint8Array {
  const update = awarenessProtocol.encodeAwarenessUpdate(awareness, clients)
  return message(COLLAB_MESSAGE.awareness, (encoder) => encoding.writeVarUint8Array(encoder, update))
}

/** The sync messages that carry document changes. Any other subtype is not applied. */
const SYNC_CHANGES = new Map<number, 'sync-step2' | 'update'>([
  [syncProtocol.messageYjsSyncStep2, 'sync-step2'],
  [syncProtocol.messageYjsUpdate, 'update'],
])

function applyChange(update: Uint8Array, doc: Y.Doc, { origin, accept }: Sender): void {
  const verdict = accept ? accept(update) : true
  if (verdict === false) throw new RejectedChange()
  if (verdict === true) Y.applyUpdate(doc, update, origin)
}

function readSync(decoder: decoding.Decoder, { doc }: Shared, sender: Sender): Received {
  const { readOnly } = sender
  const step = decoding.readVarUint(decoder)
  if (step === syncProtocol.messageYjsSyncStep1) {
    const reply = message(COLLAB_MESSAGE.sync, (encoder) => syncProtocol.readSyncStep1(decoder, encoder, doc))
    return { kind: 'sync-step1', reply }
  }
  const kind = SYNC_CHANGES.get(step)
  if (!kind) return { kind: 'unknown' }
  // Step 2 and update both carry changes: a read-only sender's are dropped.
  if (!readOnly) applyChange(decoding.readVarUint8Array(decoder), doc, sender)
  return { kind }
}

function readAwareness(decoder: decoding.Decoder, { awareness }: Shared, { origin, ownsClient }: Sender): Received {
  const update = decoding.readVarUint8Array(decoder)
  awarenessProtocol.applyAwarenessUpdate(awareness, ownsClient ? ownEntries(update, ownsClient) : update, origin)
  return { kind: 'awareness' }
}

type AwarenessEntry = [clientId: number, clock: number, state: string]

/** The awareness update with only the entries of the client ids `owns` accepts, encoded as y-protocols does. */
function ownEntries(update: Uint8Array, owns: (clientId: number) => boolean): Uint8Array {
  const decoder = decoding.createDecoder(update)
  const kept: AwarenessEntry[] = []
  for (let left = decoding.readVarUint(decoder); left > 0; left--) {
    const entry: AwarenessEntry = [decoding.readVarUint(decoder), decoding.readVarUint(decoder), decoding.readVarString(decoder)]
    if (owns(entry[0])) kept.push(entry)
  }
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, kept.length)
  for (const [clientId, clock, state] of kept) {
    encoding.writeVarUint(encoder, clientId)
    encoding.writeVarUint(encoder, clock)
    encoding.writeVarString(encoder, state)
  }
  return encoding.toUint8Array(encoder)
}

function readAwarenessQuery(_decoder: decoding.Decoder, { awareness }: Shared): Received {
  return { kind: 'awareness-query', reply: awarenessMessage(awareness, [...awareness.getStates().keys()]) }
}

const READERS = new Map<number, Reader>([
  [COLLAB_MESSAGE.sync, readSync],
  [COLLAB_MESSAGE.awareness, readAwareness],
  [COLLAB_MESSAGE.queryAwareness, readAwarenessQuery],
])

/**
 * Applies one incoming message. Throws on bytes that are not a message and on a message
 * above `COLLAB_MAX_MESSAGE_BYTES`, before reading it; unknown message types are ignored,
 * so the channel can grow.
 */
export function receive(data: Uint8Array, shared: Shared, sender: Sender): Received {
  if (data.byteLength > COLLAB_MAX_MESSAGE_BYTES) throw new RangeError('collaboration message is too large')
  const decoder = decoding.createDecoder(data)
  const reader = READERS.get(decoding.readVarUint(decoder))
  return reader ? reader(decoder, shared, sender) : { kind: 'unknown' }
}
