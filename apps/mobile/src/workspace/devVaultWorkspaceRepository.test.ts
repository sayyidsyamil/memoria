import { afterEach, describe, expect, it, vi } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { createDevVaultWorkspaceRepository, fetchDevVaultWorkspaceState } from './devVaultWorkspaceRepository'

describe('dev vault workspace repository', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('hydrates summary notes from bridge-provided note contents', async () => {
    const snapshot = workspaceScenarioForId('default')
    const note = { ...snapshot.notes[0], rawContent: undefined }
    const repository = createDevVaultWorkspaceRepository({
      noteContents: { [note.path ?? note.id]: '# Real vault note\n' },
      snapshot,
    })

    await expect(repository.readNoteContent(note, { source: 'dev' })).resolves.toBe('# Real vault note\n')
    expect(repository.readSnapshot({ source: 'dev' })).toEqual({
      ...snapshot,
      sync: { kind: 'readOnly' },
    })
  })

  it('rejects writes because the development vault bridge is read-only', async () => {
    const repository = createDevVaultWorkspaceRepository({
      noteContents: {},
      snapshot: workspaceScenarioForId('default'),
    })

    await expect(repository.persistWrites([], { source: 'dev' })).rejects.toThrow('read-only')
  })

  it('loads the workspace index without eagerly transferring every note body', async () => {
    const snapshot = workspaceScenarioForId('default')
    const fetch = vi.fn().mockResolvedValue(okJsonResponse({ snapshot }))
    vi.stubGlobal('fetch', fetch)

    await expect(fetchDevVaultWorkspaceState('http://127.0.0.1:8765')).resolves.toMatchObject({
      contentBaseUrl: 'http://127.0.0.1:8765',
      noteContents: {},
      snapshot,
    })
    expect(fetchRequestUrl(fetch)).toBe('http://127.0.0.1:8765/snapshot')
  })

  it('hydrates and caches a selected note through the bridge content endpoint', async () => {
    const snapshot = workspaceScenarioForId('default')
    const note = { ...snapshot.notes[0], path: 'Singers guide.md', rawContent: undefined }
    const fetch = vi.fn().mockResolvedValue(okJsonResponse({ content: '# Loaded on demand\n' }))
    vi.stubGlobal('fetch', fetch)
    const repository = createDevVaultWorkspaceRepository({
      contentBaseUrl: 'http://127.0.0.1:8765',
      noteContents: {},
      snapshot,
    })

    await expect(repository.readNoteContent(note, { source: 'dev' })).resolves.toBe('# Loaded on demand\n')
    await expect(repository.readNoteContent(note, { source: 'dev' })).resolves.toBe('# Loaded on demand\n')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetchRequestUrl(fetch)).toBe('http://127.0.0.1:8765/content?path=Singers+guide.md')
  })

  it('rejects public bridge URLs before issuing a request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    await expect(fetchDevVaultWorkspaceState('https://example.com')).rejects.toThrow('private network')
    expect(fetch).not.toHaveBeenCalled()
  })
})

function fetchRequestUrl(fetch: ReturnType<typeof vi.fn>): string {
  const request = fetch.mock.calls[0]?.[0]
  return request instanceof Request ? request.url : String(request)
}

function okJsonResponse(payload: unknown) {
  return {
    json: async () => payload,
    ok: true,
    status: 200,
  }
}
