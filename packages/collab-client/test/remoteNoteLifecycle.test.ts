import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket as NodeWebSocket } from 'ws'
import { closeVaultServer, createVaultServer } from '../../../apps/server/src/server.ts'
import { LocalDiskStore } from '../../../apps/server/src/store.ts'
import type { Vault } from '../../../apps/server/src/vault.ts'
import { codec } from '../../../apps/server/test/collabHelpers.ts'
import { createFixture, type Fixture } from '../../../apps/server/test/helpers.ts'
import type { VaultBackend, VaultCollabDoc } from '../../../src/lib/vaultBackend/types'
import type { SocketLike } from '../src/collabProvider.ts'
import { renameCandidate, renameNote } from '../src/remoteNoteLifecycle.ts'
import { createRemoteVaultBackend, type RemoteBindings } from '../src/remoteVaultBackend.ts'

/**
 * TOL-202: notes created, renamed and deleted on the web reach the desktop through git, and
 * the desktop's reach the web. The fixture's desktop clone stands in for the desktop app.
 */

const TOKEN = 'test-token-0123456789'
const NEW_NOTE = '---\ntype: Note\n---\n\n# \n'

let fixture: Fixture
let vault: Vault
let server: Server
let base: string
let backend: VaultBackend<RemoteBindings>
let opened: VaultCollabDoc<RemoteBindings>[]

beforeEach(async () => {
  fixture = await createFixture()
  vault = await fixture.openVault({ now: () => new Date('2026-10-23T21:30:00Z') })
  server = await createVaultServer({
    vault,
    store: new LocalDiskStore(join(fixture.root, 'server', 'state')),
    token: TOKEN,
    maxBodyBytes: 1024 * 1024,
    changes: new (await import('../../../apps/server/src/changeEmitter.ts')).ChangeEmitter(),
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  backend = createRemoteVaultBackend({
    baseUrl: base,
    token: TOKEN,
    createSocket: (url) => new NodeWebSocket(url) as unknown as SocketLike,
  })
  opened = []
})

afterEach(async () => {
  for (const doc of opened) doc.close()
  await closeVaultServer(server)
  await vault.idle()
  await fixture.cleanup()
})

async function open(path: string): Promise<VaultCollabDoc<RemoteBindings>> {
  const doc = await (backend.collab as NonNullable<typeof backend.collab>).openDoc(path)
  opened.push(doc)
  await doc.synced
  return doc
}

async function desktopHas(path: string): Promise<boolean> {
  return fixture.desktop.read(path).then(
    () => true,
    () => false,
  )
}

/** What the web client does to pick up pushes from the desktop. */
async function syncServer(): Promise<void> {
  const response = await fetch(`${base}/v1/sync`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } })
  expect(response.status).toBe(200)
}

async function listedPaths(): Promise<string[]> {
  return (await backend.files.reload()).map((entry) => entry.path)
}

describe('notes created and deleted on the web', () => {
  it('reach the desktop through git', async () => {
    const created = await backend.files.write('untitled-note-1792790000.md', NEW_NOTE, { baseRevision: null })

    expect(created.status).toBe('written')
    expect(await fixture.desktop.read('untitled-note-1792790000.md')).toBe(NEW_NOTE)

    expect(await backend.files.delete(['untitled-note-1792790000.md'])).toEqual(['untitled-note-1792790000.md'])
    expect(await desktopHas('untitled-note-1792790000.md')).toBe(false)
    expect(await fixture.desktop.log()).toHaveLength(3)
  })

  it('show the notes the desktop creates and deletes', async () => {
    await fixture.desktop.commit('from-desktop.md', '# From the desktop\n')
    await syncServer()
    expect(await listedPaths()).toContain('from-desktop.md')

    await fixture.desktop.commit('from-desktop.md', null)
    await syncServer()
    expect(await listedPaths()).not.toContain('from-desktop.md')
  })

  it('keep a note created at a path the desktop took first as a conflict copy', async () => {
    await fixture.desktop.commit('inbox/plan.md', '# Desktop plan\n')

    const result = await backend.files.write('inbox/plan.md', '# Web plan\n', { baseRevision: null })

    expect(result).toMatchObject({
      status: 'conflict',
      copyPath: 'inbox/plan (conflict 2026-10-23 2130).md',
      current: { path: 'inbox/plan.md', content: '# Desktop plan\n' },
    })
    expect(await fixture.desktop.read('inbox/plan.md')).toBe('# Desktop plan\n')
    expect(await fixture.desktop.read('inbox/plan (conflict 2026-10-23 2130).md')).toBe('# Web plan\n')
  })

  it('are refused before any request when the path is not a vault path', async () => {
    await expect(backend.files.write('../outside.md', '# No\n', { baseRevision: null })).rejects.toMatchObject({ status: 400 })
    expect(await backend.files.delete(['/etc/passwd', 'a/./b.md'])).toEqual([])
    await expect(open('../outside.md')).rejects.toMatchObject({ status: 400 })
    expect(await fixture.desktop.log()).toHaveLength(1)
  })

  it('open as a live document as soon as they are created', async () => {
    const creating = backend.files.write('fresh.md', '# Fresh\n', { baseRevision: null })
    const doc = await open('fresh.md')

    expect((await creating).status).toBe('written')
    expect(codec.read(doc.doc)).toContain('# Fresh')
  })
})

describe('renaming a note on the web', () => {
  it('moves the file to the title slug, and the open document follows it', async () => {
    await backend.files.write('untitled-note-1792790001.md', '# Big Idea\n', { baseRevision: null })
    const doc = await open('untitled-note-1792790001.md')

    const result = await backend.files.rename({ path: 'untitled-note-1792790001.md', newTitle: 'Big Idea' })

    expect(result).toEqual({ newPath: 'big-idea.md', updatedFiles: 0, failedUpdates: 0 })
    expect(doc.path).toBe('big-idea.md')
    expect(await fixture.desktop.read('big-idea.md')).toBe('# Big Idea\n')
    expect(await desktopHas('untitled-note-1792790001.md')).toBe(false)
  })

  it('takes the next free name when the slug is taken, and keeps a name that already fits', async () => {
    await fixture.desktop.commit('notes/big-idea.md', '# Big Idea\n')
    await syncServer()
    await backend.files.write('notes/untitled-note-1792790002.md', '# Big Idea\n', { baseRevision: null })

    const second = await backend.files.rename({ path: 'notes/untitled-note-1792790002.md', newTitle: 'Big Idea' })
    const again = await backend.files.rename({ path: second.newPath, newFilenameStem: 'big-idea-2' })

    expect(second.newPath).toBe('notes/big-idea-2.md')
    expect(again.newPath).toBe('notes/big-idea-2.md')
  })
})

describe('renaming a note on the web rewrites links to it (TOL-22)', () => {
  it('rewrites other notes in the rename commit, and their open documents follow', async () => {
    const linking = await open('projects/alpha.md')

    const result = await backend.files.rename({ path: 'welcome.md', newFilenameStem: 'hello' })
    await expect.poll(() => codec.read(linking.doc)).toContain('[[hello]]')

    expect(result).toEqual({ newPath: 'hello.md', updatedFiles: 1, failedUpdates: 0 })
    expect(await fixture.desktop.read('projects/alpha.md')).toBe('# Alpha\n\nLinks to [[hello]] and mentions the Heron.\n')
    expect((await fixture.desktop.log())[0]).toBe('Rename welcome.md to hello.md')
  })

  it('sets the new title as the title property, also when the file name already fits', async () => {
    await backend.files.write('ideas.md', '# Ideas\n', { baseRevision: null })

    const result = await backend.files.rename({ path: 'ideas.md', newTitle: 'Ideas', oldTitle: 'Old ideas' })

    expect(result).toEqual({ newPath: 'ideas.md', updatedFiles: 0, failedUpdates: 0 })
    expect(await fixture.desktop.read('ideas.md')).toBe('---\ntitle: Ideas\n---\n# Ideas\n')
    expect((await fixture.desktop.log())[0]).toBe('Retitle ideas.md')
  })
})

describe('moving a note to a folder on the web (TOL-227)', () => {
  it('moves it under its file name, rewrites the links in the same commit, and its document follows', async () => {
    const welcome = await open('welcome.md')

    const result = await backend.files.rename({ path: 'welcome.md', folderPath: 'archive/old' })

    expect(result).toEqual({ newPath: 'archive/old/welcome.md', updatedFiles: 1, failedUpdates: 0 })
    expect(welcome.path).toBe('archive/old/welcome.md')
    expect(await fixture.desktop.read('projects/alpha.md')).toBe('# Alpha\n\nLinks to [[archive/old/welcome]] and mentions the Heron.\n')
    expect((await fixture.desktop.log())[0]).toBe('Rename welcome.md to archive/old/welcome.md')
  })

  it('moves a note to the vault root, and stays put when it is already in the folder', async () => {
    const request = () => Promise.reject(new Error('no request expected'))

    const result = await backend.files.rename({ path: 'projects/alpha.md', folderPath: '' })

    expect(result.newPath).toBe('alpha.md')
    await expect(renameNote(request, { path: 'a/b.md', folderPath: 'a' })).resolves.toEqual({ newPath: 'a/b.md', updatedFiles: 0, failedUpdates: 0 })
  })

  it('refuses a folder that already has a note of that name, with the desktop message', async () => {
    await backend.files.write('projects/welcome.md', '# Other\n', { baseRevision: null })

    await expect(backend.files.rename({ path: 'welcome.md', folderPath: 'projects' })).rejects.toThrow('A note with that name already exists')
    expect(await desktopHas('welcome.md')).toBe(true)
  })
})

describe('rename naming', () => {
  it('follows the desktop: the slug, then numbered candidates in the same folder', () => {
    expect([0, 1, 2].map((attempt) => renameCandidate({ path: 'a/b/untitled-note-1.md', stem: 'idea' }, attempt))).toEqual([
      'a/b/idea.md',
      'a/b/idea-2.md',
      'a/b/idea-3.md',
    ])
  })

  it('names a note at the vault root without a folder', () => {
    expect(renameCandidate({ path: 'untitled-note-1.md', stem: 'idea' }, 0)).toBe('idea.md')
  })

  it.each(['', '..', '../escape', 'a/b', 'a\\b', 'quarterly:plan', 'NUL', 'draft.'])('refuses the stem %j, which does not name one file everywhere', async (stem) => {
    const request = () => Promise.reject(new Error('no request expected'))

    await expect(renameNote(request, { path: 'x.md', newFilenameStem: stem })).rejects.toMatchObject({ status: 400, message: 'Invalid filename' })
  })

  it.each(['', '/abs.md', 'a/../b.md', 'a//b.md', 'a\\b.md'])('refuses to rename %j, which is not a vault path', async (path) => {
    const request = () => Promise.reject(new Error('no request expected'))

    await expect(renameNote(request, { path, newTitle: 'Idea' })).rejects.toMatchObject({ status: 400 })
  })

  it.each([{}, { path: 7 }, { path: '../outside.md' }])('refuses a malformed rename result %j', async (body) => {
    const answer = () => Promise.resolve(new Response(JSON.stringify(body)))

    await expect(renameNote(answer, { path: 'x.md', newTitle: 'Idea' })).rejects.toMatchObject({ status: expect.any(Number) })
  })

  it.each([undefined, 'Idea'])('sends nothing when the name fits and the old title is %j', async (oldTitle) => {
    const request = () => Promise.reject(new Error('no request expected'))

    await expect(renameNote(request, { path: 'idea.md', newTitle: 'Idea', oldTitle })).resolves.toEqual({
      newPath: 'idea.md',
      updatedFiles: 0,
      failedUpdates: 0,
    })
  })

  it('gives up when every candidate is taken', async () => {
    const taken = () => Promise.resolve(new Response('{}', { status: 409 }))

    await expect(renameNote(taken, { path: 'x.md', newTitle: 'Idea' })).rejects.toMatchObject({ status: 409 })
  })
})
