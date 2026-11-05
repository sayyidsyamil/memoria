import { useEffect, useRef } from 'react'
import { Compartment, EditorState, StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

const READ_ONLY_EXTENSION = [EditorState.readOnly.of(true), EditorView.editable.of(false)]

/** Switches an existing CodeMirror view between editable and read-only without recreating it. */
export function applyCodeMirrorReadOnly(view: EditorView, compartment: Compartment, readOnly: boolean): void {
  const extension = readOnly ? READ_ONLY_EXTENSION : []
  if (compartment.get(view.state) === undefined) {
    if (!readOnly) return
    view.dispatch({ effects: StateEffect.appendConfig.of(compartment.of(extension)) })
    return
  }
  view.dispatch({ effects: compartment.reconfigure(extension) })
}

/** Leaves the view alone until it first has to turn read-only (never, on desktop). */
export function useCodeMirrorReadOnly(viewRef: React.RefObject<EditorView | null>, readOnly: boolean): void {
  const compartmentRef = useRef<Compartment | null>(null)
  useEffect(() => {
    const view = viewRef.current
    if (!view || (!readOnly && !compartmentRef.current)) return
    compartmentRef.current ??= new Compartment()
    applyCodeMirrorReadOnly(view, compartmentRef.current, readOnly)
  }, [readOnly, viewRef])
}
