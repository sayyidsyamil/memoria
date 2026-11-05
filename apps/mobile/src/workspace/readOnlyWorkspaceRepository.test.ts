import { describe, expect, it, vi } from 'vitest'
import { workspaceScenarios } from '../fixtures/workspaceFixtures'
import { expoWorkspaceFileSystem } from './expoWorkspaceFileSystem'
import {
  fixtureReadOnlyWorkspaceRepository,
  HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY,
  HOST_WORKSPACE_SNAPSHOT_GLOBAL_KEY,
  HOST_WORKSPACE_SNAPSHOT_STORAGE_KEY,
  HOST_WORKSPACE_WRITE_FAILURE_GLOBAL_KEY,
  HOST_WORKSPACE_WRITES_GLOBAL_KEY,
  readOnlyWorkspaceRepository,
} from './readOnlyWorkspaceRepository'

describe('fixtureReadOnlyWorkspaceRepository', () => {
  it('returns the default read-only workspace snapshot when no scenario is requested', () => {
    const snapshot = fixtureReadOnlyWorkspaceRepository.readSnapshot()

    expect(snapshot).toBe(workspaceScenarios.default)
    expect(snapshot.notes[0]?.title).toBe('Workflow Orchestration Essay')
  })

  it('returns scenario snapshots through the read-only workspace boundary', () => {
    const snapshot = fixtureReadOnlyWorkspaceRepository.readSnapshot({ scenarioId: 'property-heavy' })

    expect(snapshot).toBe(workspaceScenarios['property-heavy'])
    expect(snapshot.sidebarSections.some((section) => section.id === 'folders')).toBe(true)
  })

  it('prefers an injected host snapshot only when explicitly requested', () => {
    const hostSnapshot = {
      ...workspaceScenarios.default,
      noteListSubtitle: '12 / 6,011',
      source: {
        kind: 'localVault' as const,
        label: 'Laputa',
        totalNotes: 6011,
        visibleNotes: 12,
      },
    }
    const storage = {
      getItem: (key: string) => key === HOST_WORKSPACE_SNAPSHOT_STORAGE_KEY ? JSON.stringify(hostSnapshot) : null,
    }

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: storage,
    })

    expect(readOnlyWorkspaceRepository.readSnapshot({ source: 'fixture' })).toBe(workspaceScenarios.default)
    expect(readOnlyWorkspaceRepository.readSnapshot({ source: 'host' })).toMatchObject({
      noteListSubtitle: '12 / 6,011',
      source: { kind: 'localVault', label: 'Laputa' },
    })

    Reflect.deleteProperty(globalThis, 'localStorage')
  })

  it('reads host snapshots from the injected global before localStorage', () => {
    const hostSnapshot = {
      ...workspaceScenarios.default,
      noteListSubtitle: 'global snapshot',
      source: {
        kind: 'localVault' as const,
        label: 'Laputa',
        totalNotes: 8846,
        visibleNotes: 80,
      },
    }

    Reflect.set(globalThis, HOST_WORKSPACE_SNAPSHOT_GLOBAL_KEY, hostSnapshot)
    expect(readOnlyWorkspaceRepository.readSnapshot({ source: 'host' })).toMatchObject({
      noteListSubtitle: 'global snapshot',
      source: { kind: 'localVault', label: 'Laputa' },
    })
    Reflect.deleteProperty(globalThis, HOST_WORKSPACE_SNAPSHOT_GLOBAL_KEY)
  })

  it('reads host note content from the injected content map', async () => {
    Reflect.set(globalThis, HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY, {
      'Memoria/Mobile UI/Hidden Note.md': '# Hidden Note\n\nHydrated body.\n',
    })

    await expect(readOnlyWorkspaceRepository.readNoteContent({
      ...workspaceScenarios.default.notes[0],
      path: 'Memoria/Mobile UI/Hidden Note.md',
      rawContent: undefined,
    }, { source: 'host' })).resolves.toBe('# Hidden Note\n\nHydrated body.\n')

    Reflect.deleteProperty(globalThis, HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY)
  })

  it('persists host writes into the injected content map and write log', async () => {
    const noteContents: Record<string, string> = {
      'Notes/Old.md': '# Old\n',
      'views/old.yml': 'name: Old\n',
    }
    const writes: unknown[] = []
    Reflect.set(globalThis, HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY, noteContents)
    Reflect.set(globalThis, HOST_WORKSPACE_WRITES_GLOBAL_KEY, writes)

    await readOnlyWorkspaceRepository.persistWrites([{
      content: '# Updated\n',
      kind: 'saveNote',
      path: 'updated.md',
    }, {
      kind: 'moveNote',
      path: 'Notes/Old.md',
      toPath: 'Notes/Moved.md',
    }, {
      kind: 'createFolder',
      path: 'Notes/Drafts',
    }, {
      kind: 'renameFolder',
      path: 'Notes',
      toPath: 'Research',
    }, {
      kind: 'deleteFolder',
      path: 'Research/Drafts',
    }, {
      kind: 'deleteNote',
      path: 'Research/Old.md',
    }, {
      kind: 'deleteView',
      path: 'views/old.yml',
    }], { source: 'host' })

    expect(noteContents).toEqual({
      'Research/Moved.md': '# Old\n',
      'updated.md': '# Updated\n',
    })
    expect(writes).toEqual([
      { content: '# Updated\n', kind: 'saveNote', path: 'updated.md' },
      { kind: 'moveNote', path: 'Notes/Old.md', toPath: 'Notes/Moved.md' },
      { kind: 'createFolder', path: 'Notes/Drafts' },
      { kind: 'renameFolder', path: 'Notes', toPath: 'Research' },
      { kind: 'deleteFolder', path: 'Research/Drafts' },
      { kind: 'deleteNote', path: 'Research/Old.md' },
      { kind: 'deleteView', path: 'views/old.yml' },
    ])

    Reflect.deleteProperty(globalThis, HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY)
    Reflect.deleteProperty(globalThis, HOST_WORKSPACE_WRITES_GLOBAL_KEY)
  })

  it('rejects host writes when the injected failure flag is set', async () => {
    const noteContents: Record<string, string> = {}
    Reflect.set(globalThis, HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY, noteContents)
    Reflect.set(globalThis, HOST_WORKSPACE_WRITE_FAILURE_GLOBAL_KEY, 'Host write failed in QA')

    await expect(readOnlyWorkspaceRepository.persistWrites([{
      content: '# Blocked\n',
      kind: 'createNote',
      path: 'blocked.md',
    }], { source: 'host' })).rejects.toThrow('Host write failed in QA')
    expect(noteContents).toEqual({})

    Reflect.deleteProperty(globalThis, HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY)
    Reflect.deleteProperty(globalThis, HOST_WORKSPACE_WRITE_FAILURE_GLOBAL_KEY)
  })
})

describe('readOnlyWorkspaceRepository native reads', () => {
  it('re-reads cached native note content from disk before returning it', async () => {
    const recover = vi.spyOn(expoWorkspaceFileSystem, 'recoverPendingWrites').mockReturnValue(false)
    const read = vi.spyOn(expoWorkspaceFileSystem, 'readTextFileAsync').mockResolvedValue('# Disk version')

    try {
      await expect(readOnlyWorkspaceRepository.readNoteContent({
        ...workspaceScenarios.default.notes[0],
        path: 'Notes/cached.md',
        rawContent: '# Cached version',
      }, { source: 'native', vaultRootUri: 'file:///fixture-vault' })).resolves.toBe('# Disk version')
      expect(read).toHaveBeenCalledExactlyOnceWith('file:///fixture-vault', 'Notes/cached.md')
      expect(recover).toHaveBeenCalledExactlyOnceWith('file:///fixture-vault')
    } finally {
      vi.restoreAllMocks()
    }
  })
})
