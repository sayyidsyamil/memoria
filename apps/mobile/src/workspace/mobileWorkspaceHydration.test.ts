import { describe, expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { applyMobileWorkspaceEditWithWrites } from './mobileWorkspaceEditing'
import type { MobileWorkspaceSnapshot } from './mobileWorkspaceModel'

describe('mobile workspace hydration', () => {
  it('preserves source timestamps when loading a metadata-only note body', () => {
    const base = workspaceScenarioForId('default')
    const metadataOnlyNote = {
      ...base.notes[1],
      editorBlocks: undefined,
      editorBullets: undefined,
      modified: '6h ago',
      modifiedAt: 1_786_521_564_000,
      rawContent: undefined,
    }
    const snapshot: MobileWorkspaceSnapshot = {
      ...base,
      allNotes: [base.notes[0], metadataOnlyNote],
      notes: [base.notes[0]],
      selectedNoteId: metadataOnlyNote.id,
    }

    const result = applyMobileWorkspaceEditWithWrites(snapshot, {
      noteId: metadataOnlyNote.id,
      rawContent: '# Hydrated Procedure\n\nFresh body.\n',
      type: 'hydrateNoteContent',
    })
    const hydrated = result.snapshot.allNotes?.find((note) => note.id === metadataOnlyNote.id)

    expect(hydrated).toMatchObject({
      modified: '6h ago',
      modifiedAt: 1_786_521_564_000,
      rawContent: '# Hydrated Procedure\n\nFresh body.\n',
    })
    expect(result.writes).toEqual([])
  })
})
