import { describe, expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { applyWorkspaceEditToWritableSnapshot } from './tabletWorkspacePersistence'

describe('applyWorkspaceEditToWritableSnapshot', () => {
  it('does not create transient content before a native vault is selected', () => {
    const snapshot = {
      ...workspaceScenarioForId('empty'),
      sync: { kind: 'noVault' as const },
    }

    const result = applyWorkspaceEditToWritableSnapshot(snapshot, {
      type: 'createNote',
      title: '',
    })

    expect(result).toEqual({ snapshot, writes: [] })
  })

  it('does not create transient content through a read-only vault bridge', () => {
    const snapshot = {
      ...workspaceScenarioForId('default'),
      sync: { kind: 'readOnly' as const },
    }

    const result = applyWorkspaceEditToWritableSnapshot(snapshot, {
      type: 'createNote',
      title: '',
    })

    expect(result).toEqual({ snapshot, writes: [] })
  })

  it('applies edits once the workspace is writable', () => {
    const snapshot = workspaceScenarioForId('empty')

    const result = applyWorkspaceEditToWritableSnapshot(snapshot, {
      type: 'createNote',
      title: '',
    })

    expect(result.snapshot.notes).toHaveLength(snapshot.notes.length + 1)
    expect(result.writes).toHaveLength(2)
    expect(result.writes[1]).toMatchObject({ kind: 'createNote', path: 'note.md' })
  })
})
