import { applyMobileWorkspaceEditWithWrites, type MobileWorkspaceEditResult } from './mobileWorkspaceEditing'

export function withDefaultNoteType(result: MobileWorkspaceEditResult): MobileWorkspaceEditResult {
  if (!result.writes.some(write => write.kind === 'createNote')) return result

  const definition = applyMobileWorkspaceEditWithWrites(result.snapshot, {
    type: 'createTypeDefinition',
    typeName: 'Note',
  })
  if (definition.writes.length === 0) return result

  return { snapshot: definition.snapshot, writes: [...result.writes, ...definition.writes] }
}
