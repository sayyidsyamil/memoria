import { expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { editorBlocksForSelection, editorBulletsForSelection } from './tabletWorkspaceEditorContent'

it('preserves selected-note content, binary empty states and legacy fallbacks', () => {
  const snapshot = workspaceScenarioForId(null)
  const note = snapshot.notes[0]
  expect(editorBlocksForSelection(snapshot, null)).toBe(snapshot.editorBlocks)
  expect(editorBulletsForSelection(snapshot, null)).toBe(snapshot.editorBullets)
  const own = { ...note, editorBlocks: [], editorBullets: [] }
  expect(editorBlocksForSelection(snapshot, own)).toBe(own.editorBlocks)
  expect(editorBulletsForSelection(snapshot, own)).toBe(own.editorBullets)
  const binary = { ...note, fileKind: 'binary' as const }
  expect(editorBlocksForSelection(snapshot, binary)).toEqual([])
  expect(editorBulletsForSelection(snapshot, binary)).toEqual([])
  const summary = { ...note, editorBlocks: undefined, editorBullets: undefined }
  const complete = { ...snapshot, allNotes: [summary] }
  expect(editorBlocksForSelection(complete, summary)).toEqual([])
  expect(editorBulletsForSelection(complete, summary)).toEqual([])
  const legacy = { ...snapshot, allNotes: undefined }
  expect(editorBlocksForSelection(legacy, summary)).toBe(legacy.editorBlocks)
  expect(editorBulletsForSelection(legacy, summary)).toBe(legacy.editorBullets)
})
