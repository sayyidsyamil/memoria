import { afterEach, expect, it, vi } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import * as frontmatter from './localVaultFrontmatter'
import { applyMobileWorkspaceEditWithWrites, type MobileWorkspaceEdit } from './mobileWorkspaceEditing'
import type { MobileWorkspaceSnapshot } from './mobileWorkspaceModel'

afterEach(() => vi.restoreAllMocks())

function largeSnapshot(): MobileWorkspaceSnapshot {
  const fixture = workspaceScenarioForId('default')
  const template = fixture.notes[0]
  if (!template) throw new Error('Missing fixture note')
  const notes = Array.from({ length: 1000 }, (_, index) => ({
    ...template,
    id: `note-${index}`,
    path: `note-${index}.md`,
    title: `Note ${index}`,
    modified: '1d ago',
    rawContent: `---\ntype: Essay\n_favorite: false\n---\n# Note ${index}\n\nBody`,
  }))
  return { ...fixture, notes: notes.slice(0, 100), allNotes: notes, selectedNoteId: 'note-0' }
}

it.each<MobileWorkspaceEdit>([
  { type: 'toggleFavorite', noteId: 'note-0' },
  { type: 'setArchived', noteId: 'note-0', archived: true },
  { type: 'setOrganized', noteId: 'note-0', organized: true },
])('does bounded parsing and preserves unrelated notes for $type', (edit) => {
  const snapshot = largeSnapshot()
  const parse = vi.spyOn(frontmatter, 'parseLocalVaultDocument')
  const result = applyMobileWorkspaceEditWithWrites(snapshot, edit)
  expect(parse.mock.calls.length).toBeLessThanOrEqual(4)
  expect(result.writes).toHaveLength(1)
  expect(result.snapshot.notes[1]).toBe(snapshot.notes[1])
  expect(result.snapshot.allNotes?.[999]).toBe(snapshot.allNotes?.[999])
  expect(result.snapshot.notes[0]?.relationships).toBe(snapshot.notes[0]?.relationships)
  expect(result.snapshot.notes[1]?.modified).toBe('1d ago')
})
