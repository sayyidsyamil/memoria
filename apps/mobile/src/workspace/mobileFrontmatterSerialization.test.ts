import matter from 'gray-matter'
import { describe, expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { applyMobileWorkspaceEditWithWrites } from './mobileWorkspaceEditing'

describe('mobile frontmatter serialization', () => {
  it('writes note relationship refs as YAML strings', () => {
    const result = applyMobileWorkspaceEditWithWrites(workspaceScenarioForId('default'), {
      defaults: {
        relationships: { belongs_to: ['[[Memoria MVP]]'] },
        type: 'Procedure',
      },
      title: 'Launch Checklist',
      type: 'createNote',
    })

    const noteContent = result.writes.find((write) => write.kind === 'createNote')?.content ?? ''

    expect(noteContent).toContain('belongs_to: "[[Memoria MVP]]"')
    expect(matter(noteContent).data.belongs_to).toBe('[[Memoria MVP]]')
  })

  it('writes type schema relationship refs as YAML strings', () => {
    const result = applyMobileWorkspaceEditWithWrites(workspaceScenarioForId('default'), {
      patch: {
        relationships: {
          belongs_to: ['[[Memoria MVP]]'],
          depends_on: ['[[Project Board]]'],
        },
      },
      type: 'updateTypeDefinition',
      typeName: 'Procedure',
    })

    const typeContent = result.writes.find((write) => write.kind === 'saveNote')?.content ?? ''

    expect(typeContent).toContain('belongs_to:\n  - "[[Memoria MVP]]"')
    expect(typeContent).toContain('depends_on:\n  - "[[Project Board]]"')
    expect(matter(typeContent).data.belongs_to).toEqual(['[[Memoria MVP]]'])
    expect(matter(typeContent).data.depends_on).toEqual(['[[Project Board]]'])
  })
})
