import { describe, expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { applyMobileWorkspaceEdit } from './mobileWorkspaceEditing'

describe('mobile selected editor fallback', () => {
  it('preserves fixture fallback editor blocks after selecting a generated blank note', () => {
    const base = workspaceScenarioForId('default')
    const result = applyMobileWorkspaceEdit(base, {
      defaults: { type: 'Essay' },
      title: '',
      type: 'createNote',
    })
    const generatedNote = result.notes.find((note) => note.id === result.selectedNoteId)

    expect(generatedNote?.editorBlocks).toEqual([])
    expect(result.editorBlocks).toEqual(base.editorBlocks)
    expect(result.editorBullets).toEqual(base.editorBullets)
  })
})
