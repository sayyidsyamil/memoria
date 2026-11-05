import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createNativeEditorRecovery } from './nativeEditorRecovery'

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

function fixture(active = true) {
  let blocked = false
  const restart = vi.fn()
  const recovery = createNativeEditorRecovery({ active, isBlocked: () => blocked, restart })
  return { recovery, restart, block: (value: boolean) => { blocked = value } }
}

it('ignores healthy foreground transitions and restarts only the lost session', () => {
  const { recovery, restart } = fixture()
  recovery.setActive(false)
  recovery.setActive(true)
  expect(restart).not.toHaveBeenCalled()
  recovery.lost(0, 'contentProcessTerminated')
  expect(restart).toHaveBeenCalledExactlyOnceWith(1, 'contentProcessTerminated')
  recovery.lost(0, 'contentProcessTerminated')
  expect(restart).toHaveBeenCalledTimes(1)
  recovery.lost(1, 'renderProcessGone')
  expect(restart).toHaveBeenLastCalledWith(2, 'renderProcessGone')
})

it('retries an unacknowledged initial document only once', () => {
  const { recovery, restart } = fixture()
  recovery.lost(0, 'initialContentSyncFailed')
  expect(restart).toHaveBeenCalledExactlyOnceWith(1, 'initialContentSyncFailed')
  recovery.lost(1, 'initialContentSyncFailed')
  expect(restart).toHaveBeenCalledExactlyOnceWith(1, 'initialContentSyncFailed')
})

it('defers background process loss until the app is active', () => {
  const { recovery, restart } = fixture(false)
  recovery.lost(0, 'contentProcessTerminated')
  vi.advanceTimersByTime(60_000)
  expect(restart).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
  recovery.setActive(true)
  expect(restart).toHaveBeenCalledTimes(1)
})

it('does not restart an editor during working-copy replacement', () => {
  const { recovery, restart, block } = fixture()
  block(true)
  recovery.lost(0, 'contentProcessTerminated')
  recovery.lost(0, 'renderProcessGone')
  vi.advanceTimersByTime(1_000)
  expect(restart).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(1)
  block(false)
  vi.advanceTimersByTime(100)
  expect(restart).toHaveBeenCalledExactlyOnceWith(1, 'contentProcessTerminated')
  expect(vi.getTimerCount()).toBe(0)
})

it('stops blocked polling in the background and cancels recovery on unmount', () => {
  const { recovery, restart, block } = fixture()
  block(true)
  recovery.lost(0, 'contentProcessTerminated')
  recovery.setActive(false)
  expect(vi.getTimerCount()).toBe(0)
  recovery.setActive(true)
  expect(vi.getTimerCount()).toBe(1)
  recovery.dispose()
  block(false)
  vi.runAllTimers()
  recovery.setActive(true)
  recovery.lost(0, 'contentProcessTerminated')
  expect(restart).not.toHaveBeenCalled()
})
