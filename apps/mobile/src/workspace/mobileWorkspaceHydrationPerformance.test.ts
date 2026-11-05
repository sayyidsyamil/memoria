import { afterEach, expect, it, vi } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import * as frontmatter from './localVaultFrontmatter'
import { applyMobileWorkspaceEditWithWrites } from './mobileWorkspaceEditing'

afterEach(() => vi.restoreAllMocks())

it('opening a note parses only its content and preserves unrelated note identities', () => {
  const fixture = workspaceScenarioForId('default')
  const notes = Array.from({ length: 1000 }, (_, index) => ({
    ...fixture.notes[0], id: `note-${index}`, path: `note-${index}.md`, title: `Note ${index}`,
    rawContent: `---\ntype: Essay\n---\n# Note ${index}\n\nBody`,
  }))
  const target = { ...notes[0], rawContent: undefined, modified: '6h ago', modifiedAt: 1234 }
  const snapshot = { ...fixture, notes: [target, notes[1]], allNotes: [target, ...notes.slice(1)], selectedNoteId: target.id }
  const parse = vi.spyOn(frontmatter, 'parseLocalVaultDocument')
  const result = applyMobileWorkspaceEditWithWrites(snapshot, {
    type: 'hydrateNoteContent', noteId: target.id,
    rawContent: '---\ntype: Essay\nrelated_to: "[[note-999]]"\n---\n# Note 0\n\nLoaded body',
  })
  expect(parse.mock.calls.length).toBeLessThanOrEqual(6)
  expect(result.writes).toEqual([])
  expect(result.snapshot.notes[1]).toBe(snapshot.notes[1])
  expect(result.snapshot.allNotes?.[999]).toBe(snapshot.allNotes[999])
  expect(result.snapshot.notes[0]).toMatchObject({ modified: '6h ago', modifiedAt: 1234, title: 'Note 0' })
  expect(result.snapshot.notes[0].relationships[0].values[0]).toMatchObject({ title: 'Note 999' })
})
