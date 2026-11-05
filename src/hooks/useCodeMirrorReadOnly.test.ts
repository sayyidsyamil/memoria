import { renderHook } from '@testing-library/react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { applyCodeMirrorReadOnly, useCodeMirrorReadOnly } from './useCodeMirrorReadOnly'

const views: EditorView[] = []

function createView(): EditorView {
  const view = new EditorView({ state: EditorState.create({ doc: 'body' }), parent: document.body })
  views.push(view)
  return view
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
})

describe('applyCodeMirrorReadOnly', () => {
  it('leaves an editable view untouched until it must turn read-only', () => {
    const view = createView()
    const compartment = new Compartment()
    applyCodeMirrorReadOnly(view, compartment, false)
    expect(compartment.get(view.state)).toBeUndefined()

    applyCodeMirrorReadOnly(view, compartment, true)
    expect(view.state.readOnly).toBe(true)
    expect(view.contentDOM.getAttribute('contenteditable')).toBe('false')

    applyCodeMirrorReadOnly(view, compartment, false)
    expect(view.state.readOnly).toBe(false)
    expect(view.contentDOM.getAttribute('contenteditable')).toBe('true')
  })
})

describe('useCodeMirrorReadOnly', () => {
  it('follows the read-only flag', () => {
    const view = createView()
    const viewRef = { current: view }
    const { rerender } = renderHook(({ readOnly }) => useCodeMirrorReadOnly(viewRef, readOnly), {
      initialProps: { readOnly: true },
    })
    expect(view.state.readOnly).toBe(true)
    rerender({ readOnly: false })
    expect(view.state.readOnly).toBe(false)
  })

  it('never touches an editable view', () => {
    const untouchable = { current: {} as EditorView }
    expect(() => renderHook(() => useCodeMirrorReadOnly(untouchable, false))).not.toThrow()
  })

  it('does nothing without a view', () => {
    expect(() => renderHook(() => useCodeMirrorReadOnly({ current: null }, true))).not.toThrow()
  })
})
