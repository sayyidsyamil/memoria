import { afterEach, describe, expect, it, vi } from 'vitest'
import { runFrontmatterAndApply } from '../../hooks/frontmatterOps'
import { mockInvoke } from '../../mock-tauri'
import { MOCK_CONTENT } from '../../mock-tauri/mock-content'
import { autoRenameRemoteNote, createRemoteNote, deleteRemoteNotes } from '../remoteNotes'

type RemoteWindow = Window & { MEMORIA_REMOTE_URL?: string; MEMORIA_REMOTE_TOKEN?: string }

const NOTE = Object.keys(MOCK_CONTENT)[0]

function mockNote(): string | undefined {
  return Reflect.get(MOCK_CONTENT, NOTE) as string | undefined
}

function goOfflineOnTheWeb(): void {
  const remote = window as RemoteWindow
  remote.MEMORIA_REMOTE_URL = 'https://server.test'
  remote.MEMORIA_REMOTE_TOKEN = 'token'
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
}

function frontmatterCallbacks() {
  return { updateTab: vi.fn(), updateEntry: vi.fn(), cacheContent: vi.fn(), toast: vi.fn() }
}

afterEach(() => {
  const remote = window as RemoteWindow
  delete remote.MEMORIA_REMOTE_URL
  delete remote.MEMORIA_REMOTE_TOKEN
  vi.restoreAllMocks()
})

describe('offline on the web, nothing is kept to send later (TOL-198)', () => {
  it('refuses to save a note body', async () => {
    goOfflineOnTheWeb()
    await expect(mockInvoke('save_note_content', { path: NOTE, content: '# Changed' })).rejects.toThrow('offline')
    expect(mockNote()).not.toBe('# Changed')
  })

  it('still reads notes', async () => {
    goOfflineOnTheWeb()
    await expect(mockInvoke('get_note_content', { path: NOTE })).resolves.toBeTypeOf('string')
  })

  it('refuses a property edit before touching the note', async () => {
    goOfflineOnTheWeb()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const callbacks = frontmatterCallbacks()
    const result = await runFrontmatterAndApply({ op: 'update', path: NOTE, key: 'status', value: 'Done', callbacks })
    expect(result).toBeUndefined()
    expect(callbacks.updateTab).not.toHaveBeenCalled()
    expect(callbacks.cacheContent).not.toHaveBeenCalled()
    expect(callbacks.toast).toHaveBeenCalled()
  })

  it('saves normally on demo data while offline', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    const original = mockNote() ?? ''
    await mockInvoke('save_note_content', { path: NOTE, content: `${original}\nedited` })
    expect(mockNote()).toBe(`${original}\nedited`)
    await mockInvoke('save_note_content', { path: NOTE, content: original })
  })

  it('refuses to create, rename or delete a note on the server, without a request', async () => {
    goOfflineOnTheWeb()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(createRemoteNote('new.md', '# New\n')).rejects.toThrow('offline')
    await expect(autoRenameRemoteNote('untitled.md', 'Title')).rejects.toThrow('offline')
    await expect(deleteRemoteNotes(['a.md'])).rejects.toThrow('offline')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
