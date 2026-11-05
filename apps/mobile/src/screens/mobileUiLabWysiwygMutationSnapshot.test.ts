import { describe, expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { nativeWysiwygMutationProbeInitialContent } from '../qa/nativeWysiwygMutationProbe'
import { mobileSnapshotWithWysiwygMutationProbeContent } from './mobileUiLabWysiwygMutationSnapshot'

describe('mobileSnapshotWithWysiwygMutationProbeContent', () => {
  it('replaces existing selected-note content with the deterministic mutation fixture', () => {
    const snapshot = workspaceScenarioForId('default')
    const selectedNoteId = snapshot.selectedNoteId ?? snapshot.notes[0]?.id
    expect(selectedNoteId).toBeDefined()
    const seedSelectedNote = (note: (typeof snapshot.notes)[number]) => note.id === selectedNoteId
      ? {
          ...note,
          favorite: false,
          rawContent: '---\ntype: Stale\n---\nExisting vault content.\n',
          status: 'Published',
          tags: ['Existing'],
          type: 'Resource',
        }
      : note
    const seededSnapshot = {
      ...snapshot,
      allNotes: snapshot.notes.map(seedSelectedNote),
      notes: snapshot.notes.map(seedSelectedNote),
    }
    const expectedNote = seededSnapshot.notes.find((note) => note.id === selectedNoteId)
    expect(expectedNote).toBeDefined()
    if (!expectedNote) throw new Error('Selected fixture note is missing')
    const expectedContent = nativeWysiwygMutationProbeInitialContent({
      ...expectedNote,
      favorite: true,
      status: 'Draft',
      tags: ['Design', 'AI'],
      type: 'Essay',
    })

    const result = mobileSnapshotWithWysiwygMutationProbeContent(seededSnapshot)

    expect(result.notes.find((note) => note.id === selectedNoteId)?.rawContent)
      .toBe(expectedContent)
    expect(result.allNotes?.find((note) => note.id === selectedNoteId)?.rawContent)
      .toBe(expectedContent)
  })
})
