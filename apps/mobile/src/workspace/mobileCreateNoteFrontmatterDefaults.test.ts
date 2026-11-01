import { describe, expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { mobileCreateNoteDefaultsForType } from './mobileCreateNoteDefaults'
import { applyMobileWorkspaceEditWithWrites } from './mobileWorkspaceEditing'

describe('mobile create-note frontmatter defaults', () => {
  it('writes single default relationships with the same scalar frontmatter as desktop creation', () => {
    const result = applyMobileWorkspaceEditWithWrites(workspaceScenarioForId('default'), {
      defaults: {
        properties: { Rating: 5 },
        relationships: { Author: ['[[person/frank-herbert]]'] },
      },
      title: 'Dune',
      type: 'createNote',
    })
    const createdNote = result.snapshot.notes.find((note) => note.title === 'Dune')

    expect(createdNote?.rawContent).toContain('Rating: 5')
    expect(createdNote?.rawContent).toContain('Author: "[[person/frank-herbert]]"')
    expect(createdNote?.rawContent).not.toContain('Author:\n  - "[[person/frank-herbert]]"')
    expect(result.writes).toEqual([{
      content: expect.stringContaining('Author: "[[person/frank-herbert]]"'),
      kind: 'createNote',
      path: 'dune.md',
    }])
  })

  it('keeps multiple default relationships as desktop-style frontmatter lists', () => {
    const result = applyMobileWorkspaceEditWithWrites(workspaceScenarioForId('default'), {
      defaults: {
        relationships: {
          Author: ['[[person/frank-herbert]]', '[[person/beverly-herbert]]'],
        },
      },
      title: 'Dune Notes',
      type: 'createNote',
    })
    const createdNote = result.snapshot.notes.find((note) => note.title === 'Dune Notes')

    expect(createdNote?.rawContent).toContain('Author:\n  - "[[person/frank-herbert]]"\n  - "[[person/beverly-herbert]]"')
    expect(result.writes).toEqual([{
      content: expect.stringContaining('Author:\n  - "[[person/frank-herbert]]"\n  - "[[person/beverly-herbert]]"'),
      kind: 'createNote',
      path: 'dune-notes.md',
    }])
  })

  it('writes Type schema relationship defaults when creating typed notes', () => {
    const defaults = mobileCreateNoteDefaultsForType('Project', {
      Project: {
        properties: { Priority: 'High' },
        relationships: { belongs_to: ['[[Memoria MVP]]'] },
      },
    })
    const result = applyMobileWorkspaceEditWithWrites(workspaceScenarioForId('default'), {
      defaults,
      title: 'Launch Plan',
      type: 'createNote',
    })

    expect(defaults).toEqual({
      properties: { Priority: 'High' },
      relationships: { belongs_to: ['[[Memoria MVP]]'] },
      type: 'Project',
    })
    expect(result.writes).toEqual([{
      content: expect.stringContaining('belongs_to: "[[Memoria MVP]]"'),
      kind: 'createNote',
      path: 'launch-plan.md',
    }])
  })
})
