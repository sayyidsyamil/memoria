import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCodeMirror } from './useCodeMirror'

const noopCallbacks = { onDocChange: () => {}, onCursorActivity: () => {}, onSave: () => {}, onEscape: () => false }

describe('raw source integrity', () => {
  it('preserves original mixed line endings and source syntax across raw edits', () => {
    const ref = { current: document.createElement('div') }
    const original = 'One &lt;term&gt;\r\nTwo `[[x]]`\nThree\r\n'
    const onDocChange = vi.fn()
    const { result } = renderHook(() => useCodeMirror(ref, original, { ...noopCallbacks, onDocChange }))
    const view = result.current.current
    if (!view) throw new Error('Missing raw editor')
    act(() => view.dispatch({ changes: { from: 0, insert: 'X' } }))
    expect(onDocChange).toHaveBeenLastCalledWith(`X${original}`)
    const newline = view.state.doc.line(1).to
    act(() => view.dispatch({ changes: { from: newline, to: newline + 1, insert: '' } }))
    expect(onDocChange).toHaveBeenLastCalledWith(`X${original.replace('\r\n', '')}`)
  })

})
