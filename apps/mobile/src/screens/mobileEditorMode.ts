export type InitialMobileEditorState = {
  initialEditorEditing: boolean
  initialEditorEditingMode: 'source' | 'wysiwyg'
}

export function initialMobileEditorStateFromMode(mode: string | null): InitialMobileEditorState {
  if (mode === 'read') {
    return { initialEditorEditing: false, initialEditorEditingMode: 'wysiwyg' }
  }

  if (mode === 'raw' || mode === 'source') {
    return { initialEditorEditing: true, initialEditorEditingMode: 'source' }
  }

  if (mode === 'wysiwyg') {
    return { initialEditorEditing: true, initialEditorEditingMode: 'wysiwyg' }
  }

  return { initialEditorEditing: true, initialEditorEditingMode: 'wysiwyg' }
}
