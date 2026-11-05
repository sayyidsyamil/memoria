import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const markStartupPhase = vi.hoisted(() => vi.fn())
vi.mock('../lib/startupPerformance', () => ({ markStartupPhase }))

import { useNoteListPaintedMark } from './useNoteListPaintedMark'

describe('useNoteListPaintedMark', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    markStartupPhase.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('marks the note list painted a frame after it first has rows', async () => {
    const { rerender } = renderHook(({ hasRows }) => useNoteListPaintedMark(hasRows), { initialProps: { hasRows: false } })
    await vi.advanceTimersByTimeAsync(50)
    expect(markStartupPhase).not.toHaveBeenCalled()

    rerender({ hasRows: true })
    await vi.advanceTimersByTimeAsync(50)

    expect(markStartupPhase).toHaveBeenCalledWith('note_list_painted')
  })

  it('does not mark a list that went away before it painted', async () => {
    const { unmount } = renderHook(() => useNoteListPaintedMark(true))
    unmount()
    await vi.advanceTimersByTimeAsync(50)

    expect(markStartupPhase).not.toHaveBeenCalled()
  })
})
