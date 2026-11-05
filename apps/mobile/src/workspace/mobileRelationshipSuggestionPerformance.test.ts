import { afterEach, describe, expect, it, vi } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { mobileRelationshipTargetSuggestions } from './mobileWorkspaceSuggestions'
import * as wikilinks from './mobileWikilinks'

afterEach(() => vi.restoreAllMocks())

describe('large-vault relationship picker', () => {
  it('resolves an existing link once, not once for every candidate note', () => {
    const template = workspaceScenarioForId('default').notes[0]
    if (!template) throw new Error('missingFixture')
    const notes = Array.from({ length: 1000 }, (_, index) => ({
      ...template, id: `note-${index}`, path: `note-${index}.md`, title: `Note ${index}`, archived: false,
    }))
    const selectedNote = {
      ...template,
      id: 'selected',
      relationships: [{
        key: 'related_to', label: 'Related to', kind: 'relatedTo' as const,
        values: [{ id: 'unresolved', title: 'Note 999', ref: '[[note-999]]', type: template.type, typeTone: template.typeTone }],
      }],
    }
    const resolve = vi.spyOn(wikilinks, 'mobileNoteForWikilinkTarget')
    expect(mobileRelationshipTargetSuggestions(notes, 'note-999', {
      selectedNote, relationshipKey: 'related_to',
    })).toEqual([])
    expect(resolve).toHaveBeenCalledTimes(1)
  })
})
