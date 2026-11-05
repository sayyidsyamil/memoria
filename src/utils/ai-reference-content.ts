import { createVaultBackend } from '../lib/vaultBackend'
import type { NoteReference } from './ai-context'

function readNoteContent(path: string, vaultPath: string): Promise<string | null> {
  const backend = createVaultBackend(vaultPath)
  return backend.files.read(path).then(file => file.content).catch(() => null)
}

export async function hydrateNoteReferences(references?: NoteReference[], vaultPath?: string): Promise<NoteReference[] | undefined> {
  if (!references?.length || !vaultPath) return references

  return Promise.all(references.map(async (reference) => {
    if (reference.content !== undefined) return reference

    const content = await readNoteContent(reference.path, vaultPath)
    return content === null ? reference : { ...reference, content }
  }))
}
