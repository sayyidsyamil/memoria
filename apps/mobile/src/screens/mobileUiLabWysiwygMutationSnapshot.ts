import { nativeWysiwygMutationProbeInitialContent } from '../qa/nativeWysiwygMutationProbe'
import type { MobileNote, MobileWorkspaceSnapshot } from '../workspace/mobileWorkspaceModel'

const mutationProbeMetadata: Pick<MobileNote, 'favorite' | 'status' | 'tags' | 'type'> = {
  favorite: true,
  status: 'Draft',
  tags: ['Design', 'AI'],
  type: 'Essay',
}

export function mobileSnapshotWithWysiwygMutationProbeContent(
  snapshot: MobileWorkspaceSnapshot,
): MobileWorkspaceSnapshot {
  const selectedNoteId = snapshot.selectedNoteId ?? snapshot.notes[0]?.id
  if (!selectedNoteId) return snapshot

  const seedSelectedNote = (note: MobileNote): MobileNote => note.id === selectedNoteId
    ? {
        ...note,
        rawContent: nativeWysiwygMutationProbeInitialContent({
          ...note,
          ...mutationProbeMetadata,
        }),
      }
    : note

  return {
    ...snapshot,
    allNotes: snapshot.allNotes?.map(seedSelectedNote),
    notes: snapshot.notes.map(seedSelectedNote),
  }
}
