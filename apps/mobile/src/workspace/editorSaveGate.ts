type EditorDocumentAdapter<Document> = {
  read: () => Promise<Document>
  commit: (document: Document) => void
  setEditable: (editable: boolean) => void
  isFocused?: () => boolean
}

/** Invalidates older bridge replies before a checkout can replace the document. */
export function createEditorSaveGate<Document>(adapter: EditorDocumentAdapter<Document>) {
  let version = 0
  let paused = false
  const resume = (preparedVersion: number) => {
    if (!paused || preparedVersion !== version) return
    paused = false
    version += 1
    adapter.setEditable(true)
  }
  return {
    updateAdapter: (next: EditorDocumentAdapter<Document>) => { adapter = next },
    save: async () => {
      if (paused) return
      const requestedVersion = ++version
      const document = await adapter.read()
      if (!paused && requestedVersion === version) adapter.commit(document)
    },
    prepare: async (deferWhileFocused = false) => {
      if (shouldDeferEditorPause(adapter, deferWhileFocused)) throw new Error('editorSyncDeferred')
      if (paused) throw new Error('editorAlreadyPaused')
      paused = true
      version += 1
      const preparedVersion = version
      try {
        adapter.setEditable(false)
        adapter.commit(await adapter.read())
        return () => resume(preparedVersion)
      } catch (error) {
        resume(preparedVersion)
        throw error
      }
    },
  }
}

function shouldDeferEditorPause(adapter: Pick<EditorDocumentAdapter<unknown>, 'isFocused'>, requested: boolean) {
  return requested && adapter.isFocused?.()
}
