import { describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { awarenessMessage, RejectedChange, receive, syncStep1, updateMessage } from '../../../packages/protocol/src/collabWire.ts'
import { COLLAB_MAX_MESSAGE_BYTES, COLLAB_MESSAGE } from '../../../packages/protocol/src/index.ts'
import { DEFAULT_FLUSH_POLICY, FlushScheduler, flushDue, simulateFlushes, type Timers } from '../src/collab/flush.ts'
import { TICKET_LIFETIME_MS, TicketBook } from '../src/collab/tickets.ts'
import { WaitingRoom } from '../src/collab/upgrade.ts'

const POLICY = { idleMs: 5_000, maxWaitMs: 60_000 }

/** Timers on a clock the test moves by hand. */
class FakeTimers implements Timers {
  time = 0
  private readonly pending = new Map<number, { at: number; callback: () => void }>()
  private next = 1

  now(): number {
    return this.time
  }

  set(callback: () => void, delayMs: number): unknown {
    this.pending.set(this.next, { at: this.time + delayMs, callback })
    return this.next++
  }

  clear(handle: unknown): void {
    this.pending.delete(handle as number)
  }

  advanceTo(time: number): void {
    const due = [...this.pending].filter(([, timer]) => timer.at <= time).sort((a, b) => a[1].at - b[1].at)
    for (const [handle, timer] of due) {
      this.pending.delete(handle)
      this.time = timer.at
      timer.callback()
    }
    this.time = time
  }
}

/** Replays edits through a real scheduler and returns when it flushed. */
function scheduled(editTimes: number[], end: number): number[] {
  const timers = new FakeTimers()
  const flushes: number[] = []
  const scheduler = new FlushScheduler(POLICY, () => flushes.push(timers.time), timers)
  for (const time of editTimes) {
    timers.advanceTo(time)
    scheduler.touch()
  }
  timers.advanceTo(end)
  return flushes
}

describe('flush policy', () => {
  it('is due after the idle time, or after the maximum wait when the typing never stops', () => {
    expect(flushDue(POLICY, 1_000, 1_000)).toBe(6_000)
    expect(flushDue(POLICY, 1_000, 59_000)).toBe(61_000)
  })

  it.each([
    ['one burst', [0, 1_000, 2_000], [7_000]],
    ['two bursts apart', [0, 1_000, 30_000], [6_000, 35_000]],
    ['typing without a pause', Array.from({ length: 150 }, (_, second) => second * 1_000), [60_000, 120_000, 154_000]],
    ['no edits', [], []],
  ])('flushes %s at the same times in the simulation and in the scheduler', (_name, edits, expected) => {
    expect(simulateFlushes(POLICY, edits)).toEqual(expected)
    expect(scheduled(edits, 1_000_000)).toEqual(expected)
  })

  it('has nothing pending after a reset and uses real timers by default', () => {
    const scheduler = new FlushScheduler(DEFAULT_FLUSH_POLICY, () => {})
    scheduler.touch()
    expect(scheduler.pending).toBe(true)

    scheduler.reset()

    expect(scheduler.pending).toBe(false)
  })
})

describe('tickets', () => {
  const grant = { docId: 'doc-1', access: 'write' as const }

  it('opens the document it was issued for, once', () => {
    const book = new TicketBook()
    const { ticket } = book.issue(grant)

    expect([book.redeem(ticket, 'doc-1')?.access, book.redeem(ticket, 'doc-1')]).toEqual(['write', null])
  })

  it('does not open another document, and is spent by the attempt', () => {
    const book = new TicketBook()
    const { ticket } = book.issue(grant)

    expect([book.redeem(ticket, 'doc-2'), book.redeem(ticket, 'doc-1')]).toEqual([null, null])
  })

  it('expires, and expired tickets are dropped when the next one is issued', () => {
    let now = 1_000
    const book = new TicketBook(() => now)
    const first = book.issue(grant)
    expect(first.expiresAt).toBe(new Date(1_000 + TICKET_LIFETIME_MS).toISOString())

    now += TICKET_LIFETIME_MS
    const second = book.issue({ docId: 'doc-1', access: 'read' })

    expect([book.redeem(first.ticket, 'doc-1'), book.redeem(second.ticket, 'doc-1')?.access]).toEqual([null, 'read'])
  })

  it('issues tickets that cannot be guessed from one another', () => {
    const book = new TicketBook()

    expect(book.issue(grant).ticket).not.toBe(book.issue(grant).ticket)
    expect(book.issue(grant).ticket).toMatch(/^[\w-]{43}$/)
  })
})

describe('wire messages', () => {
  function shared(): { doc: Y.Doc; awareness: Awareness } {
    const doc = new Y.Doc()
    return { doc, awareness: new Awareness(doc) }
  }

  it('answers sync step 1 with what the asker is missing', () => {
    const [server, client] = [shared(), shared()]
    server.doc.getText('t').insert(0, 'hello')

    const { kind, reply } = receive(syncStep1(client.doc), server, { origin: {}, readOnly: false })
    receive(reply as Uint8Array, client, { origin: {}, readOnly: false })

    expect(kind).toBe('sync-step1')
    expect(client.doc.getText('t').toString()).toBe('hello')
  })

  it('answers an awareness query with everyone present', () => {
    const [server, client] = [shared(), shared()]
    server.awareness.setLocalState({ user: 'server-side' })

    const { reply } = receive(new Uint8Array([COLLAB_MESSAGE.queryAwareness]), server, { origin: {}, readOnly: false })
    receive(reply as Uint8Array, client, { origin: {}, readOnly: false })

    expect(client.awareness.getStates().get(server.doc.clientID)).toEqual({ user: 'server-side' })
    expect(reply).toEqual(awarenessMessage(server.awareness, [server.doc.clientID]))
  })

  it('ignores a message type it does not know and refuses bytes that are no message', () => {
    const target = shared()

    expect(receive(new Uint8Array([42, 1, 2]), target, { origin: {}, readOnly: false })).toEqual({ kind: 'unknown' })
    expect(() => receive(new Uint8Array([]), target, { origin: {}, readOnly: false })).toThrow()
  })

  it('does not apply a sync message of a subtype it does not know', () => {
    const [source, target] = [shared(), shared()]
    source.doc.getText('t').insert(0, 'smuggled')
    const update = Y.encodeStateAsUpdate(source.doc)
    const frame = new Uint8Array([COLLAB_MESSAGE.sync, 9, update.length, ...update])

    expect(receive(frame, target, { origin: {}, readOnly: false })).toEqual({ kind: 'unknown' })
    expect(target.doc.getText('t').toString()).toBe('')
  })

  it('applies a change its receiver accepts, throws for one it turns down, and leaves one it judges later out', () => {
    const [source, target] = [shared(), shared()]
    source.doc.getText('t').insert(0, 'change')
    const frame = updateMessage(Y.encodeStateAsUpdate(source.doc))
    const judged = (verdict: boolean | 'later') => ({ origin: {}, readOnly: false, accept: () => verdict })

    expect(receive(frame, target, judged('later'))).toEqual({ kind: 'update' })
    expect(target.doc.getText('t').toString()).toBe('')
    expect(() => receive(frame, target, judged(false))).toThrow(RejectedChange)
    expect(target.doc.getText('t').toString()).toBe('')
    receive(frame, target, judged(true))
    expect(target.doc.getText('t').toString()).toBe('change')
  })

  it('refuses a message above the size limit before reading it', () => {
    const oversized = new Uint8Array(COLLAB_MAX_MESSAGE_BYTES + 1)

    expect(() => receive(oversized, shared(), { origin: {}, readOnly: false })).toThrow(/too large/)
  })
})

describe('messages sent before the document has opened', () => {
  it('are held in order and released once', () => {
    const waiting = new WaitingRoom(8)

    expect([waiting.hold(new Uint8Array([1, 2])), waiting.hold(new Uint8Array([3]))]).toEqual([true, true])
    expect(waiting.release()).toEqual([new Uint8Array([1, 2]), new Uint8Array([3])])
    expect(waiting.release()).toEqual([])
  })

  it('are refused, and dropped, once they add up to more than one message may be', () => {
    const waiting = new WaitingRoom(8)
    waiting.hold(new Uint8Array(5))

    expect(waiting.hold(new Uint8Array(4))).toBe(false)
    expect(waiting.release()).toEqual([])
  })
})
