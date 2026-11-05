import { describe, expect, it, vi } from 'vitest'
import { onLiveNoteTitle, reportLiveNoteTitle } from './liveNoteTitle'

describe('live note title channel', () => {
  it('delivers reported titles to listeners until they unsubscribe', () => {
    const listener = vi.fn()
    const stop = onLiveNoteTitle(listener)

    reportLiveNoteTitle('untitled-note-1.md', 'Big Idea')
    stop()
    reportLiveNoteTitle('untitled-note-1.md', 'Ignored')

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith('untitled-note-1.md', 'Big Idea')
  })
})
