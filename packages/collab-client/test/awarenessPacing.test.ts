import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { AwarenessThrottle, keepPresenceFresh, staleClients } from '../src/awarenessPacing.ts'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/** Another client's awareness, as a peer of `observer`: its updates reach the observer when sent. */
function peerOf(observer: Awareness, name: string) {
  const peer = new Awareness(new Y.Doc())
  peer.setLocalState({ user: { name } })
  const forward = () => applyAwarenessUpdate(observer, encodeAwarenessUpdate(peer, [peer.clientID]), 'remote')
  forward()
  return { peer, forward }
}

describe('AwarenessThrottle', () => {
  it('sends the first change at once and the ones that follow together, once per interval', () => {
    const sent: number[][] = []
    const throttle = new AwarenessThrottle((clients) => sent.push(clients), 100)

    throttle.push([1])
    throttle.push([1])
    throttle.push([2, 1])
    expect(sent).toEqual([[1]])

    vi.advanceTimersByTime(100)
    expect(sent).toEqual([[1], [1, 2]])

    vi.advanceTimersByTime(100)
    throttle.push([3])
    expect(sent).toEqual([[1], [1, 2], [3]])
  })

  it('sends each change at once without an interval', () => {
    const sent: number[][] = []
    const throttle = new AwarenessThrottle((clients) => sent.push(clients))

    throttle.push([1])
    throttle.push([2])

    expect(sent).toEqual([[1], [2]])
  })

  it('flushes what waits, and sends nothing more once stopped', () => {
    const sent: number[][] = []
    const throttle = new AwarenessThrottle((clients) => sent.push(clients), 100)
    throttle.push([1])
    throttle.push([2])

    throttle.flush()
    throttle.flush()
    throttle.push([3])
    throttle.stop()
    vi.advanceTimersByTime(500)

    expect(sent).toEqual([[1], [2]])
  })
})

describe('presence freshness', () => {
  it('drops another client that stopped renewing, and keeps one that renews', () => {
    const observer = new Awareness(new Y.Doc())
    const silent = peerOf(observer, 'Silent')
    const talking = peerOf(observer, 'Talking')
    const stop = keepPresenceFresh(observer, 3_000, 'local')
    const stopTalking = keepPresenceFresh(talking.peer, 3_000, 'local')
    talking.peer.on('update', talking.forward)

    vi.advanceTimersByTime(4_000)

    expect([...observer.getStates().keys()].sort()).toEqual([observer.clientID, talking.peer.clientID].sort())
    expect(observer.getStates().has(silent.peer.clientID)).toBe(false)
    stop()
    stopTalking()
  })

  it('renews the own state without announcing a change', () => {
    const awareness = new Awareness(new Y.Doc())
    awareness.setLocalState({ user: { name: 'Me' } })
    const updates = vi.fn()
    const changes = vi.fn()
    awareness.on('update', updates)
    awareness.on('change', changes)
    const stop = keepPresenceFresh(awareness, 3_000, 'local')

    vi.advanceTimersByTime(1_000)

    expect([updates.mock.calls.length, changes.mock.calls.length]).toEqual([1, 0])
    stop()
  })

  it('renews nothing once the own presence was withdrawn', () => {
    const awareness = new Awareness(new Y.Doc())
    awareness.setLocalState(null)
    const updates = vi.fn()
    awareness.on('update', updates)
    const stop = keepPresenceFresh(awareness, 3_000, 'local')

    vi.advanceTimersByTime(3_000)

    expect(updates).not.toHaveBeenCalled()
    stop()
  })

  it('never counts the own client or a client already gone as stale', () => {
    const observer = new Awareness(new Y.Doc())
    const gone = peerOf(observer, 'Gone')
    gone.peer.setLocalState(null)
    gone.forward()

    expect(staleClients(observer, 1_000, Date.now() + 10_000)).toEqual([])
  })
})
