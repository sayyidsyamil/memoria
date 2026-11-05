import { describe, expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import {
  applyMobileWorkspaceEditWithWrites,
  type MobileWorkspaceEdit,
} from './mobileWorkspaceEditing'
import type { MobileNote, MobileWorkspaceSnapshot } from './mobileWorkspaceModel'

describe('mobile workspace bulk editing', () => {
  it('applies selected note edits as one reducer command and one write batch', () => {
    const base = workspaceScenarioForId('default')
    const editableNotes = [
      editableNote(base.notes[0], '---\ntype: Essay\n---\n# Workflow\n'),
      editableNote(base.notes[1], '---\ntype: Procedure\n---\n# Open Source\n'),
    ]
    const result = applyMobileWorkspaceEditWithWrites(snapshotWithNotes(base, editableNotes), bulkOrganizeEdit(editableNotes))

    expect(result.snapshot.notes.map((note) => note.organized)).toEqual([true, true])
    expect(result.writes).toEqual([
      expect.objectContaining({ kind: 'saveNote', path: editableNotes[0]?.path }),
      expect.objectContaining({ kind: 'saveNote', path: editableNotes[1]?.path }),
    ])
    expect(result.writes.every((write) => write.kind === 'saveNote' && write.content.includes('_organized: true'))).toBe(true)
  })
})

function bulkOrganizeEdit(notes: MobileNote[]): MobileWorkspaceEdit {
  return {
    edits: notes.map((note) => ({ noteId: note.id, organized: true, type: 'setOrganized' })),
    type: 'bulkEdit',
  }
}

function editableNote(note: MobileNote, rawContent: string): MobileNote {
  return {
    ...note,
    rawContent,
  }
}

function snapshotWithNotes(
  snapshot: MobileWorkspaceSnapshot,
  notes: MobileNote[],
): MobileWorkspaceSnapshot {
  return {
    ...snapshot,
    allNotes: notes,
    notes,
    selectedNoteId: notes[0]?.id,
  }
}
