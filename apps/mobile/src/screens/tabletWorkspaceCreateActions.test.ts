import { describe, expect, it, vi } from 'vitest'
import { createTypedWorkspaceNote } from './tabletWorkspaceCreateActions'

describe('tablet workspace create actions', () => {
  it('creates title-less typed note edits with Type defaults', () => {
    const applyEdit = vi.fn()
    const closeAction = vi.fn()

    createTypedWorkspaceNote({
      applyEdit,
      closeAction,
      typeDefinitions: {
        Project: {
          properties: { priority: 'High' },
          relationships: { belongs_to: ['[[Memoria MVP]]'] },
          template: '## Objective\n',
        },
      },
      typeName: 'Project',
    })

    expect(applyEdit).toHaveBeenCalledWith({
      defaults: {
        properties: { priority: 'High' },
        relationships: { belongs_to: ['[[Memoria MVP]]'] },
        template: '## Objective\n',
        type: 'Project',
      },
      title: '',
      type: 'createNote',
    })
    expect(closeAction).toHaveBeenCalledOnce()
  })
})
