import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket as NodeWebSocket } from 'ws'
import { ChangeEmitter } from '../../../apps/server/src/changeEmitter.ts'
import { closeVaultServer, createVaultServer } from '../../../apps/server/src/server.ts'
import { LocalDiskStore } from '../../../apps/server/src/store.ts'
import type { Vault } from '../../../apps/server/src/vault.ts'
import { createFixture, type Fixture } from '../../../apps/server/test/helpers.ts'
import type { VaultBackend, VaultCollabDoc } from '../../../src/lib/vaultBackend/types'
import type { SocketLike } from '../src/collabProvider.ts'
import { createFolder, deleteFolder, folderTree, listFolders, renameFolder } from '../src/remoteFolders.ts'
import { createRemoteVaultBackend, type RemoteBindings } from '../src/remoteVaultBackend.ts'

/** TOL-227 and TOL-233: the folder tree, folder renames, creates and deletes on the Memoria remote. */

const TOKEN = 'test-token-0123456789'

let fixture: Fixture
let vault: Vault
let server: Server
let backend: VaultBackend<RemoteBindings>
let opened: VaultCollabDoc<RemoteBindings>[]

beforeEach(async () => {
  fixture = await createFixture()
  vault = await fixture.openVault()
  server = await createVaultServer({
    vault,
    store: new LocalDiskStore(join(fixture.root, 'server', 'state')),
    token: TOKEN,
    maxBodyBytes: 1024 * 1024,
    changes: new ChangeEmitter(),
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  backend = createRemoteVaultBackend({
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
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

const noRequest = () => Promise.reject(new Error('no request expected'))

describe('the folder tree of a remote vault', () => {
  it('lists the folders of the tracked files', async () => {
    await backend.files.write('projects/deep/beta.md', '# Beta\n', { baseRevision: null })

    expect(await backend.chrome.listFolders()).toEqual([
      { name: 'attachments', path: 'attachments', children: [] },
      { name: 'projects', path: 'projects', children: [{ name: 'deep', path: 'projects/deep', children: [] }] },
    ])
  })

  it('hides dot folders and type/ like the desktop, and sorts by name', () => {
    expect(folderTree(['b/x.md', 'A/y.md', '.obsidian/c.json', 'type/Person.md', 'a2/.hidden/z.md', 'root.md'])).toEqual([
      { name: 'A', path: 'A', children: [] },
      { name: 'a2', path: 'a2', children: [] },
      { name: 'b', path: 'b', children: [] },
    ])
  })

  it('refuses a malformed file list', async () => {
    const answer = (body: unknown) => () => Promise.resolve(Response.json(body))

    await expect(listFolders(answer({}))).rejects.toMatchObject({ status: 502 })
    await expect(listFolders(answer({ files: [{ path: 7 }] }))).rejects.toMatchObject({ status: 502 })
  })
})

describe('renaming a folder on the web', () => {
  it('moves its notes in one commit, rewrites the links and moves their open documents', async () => {
    await backend.files.write('index.md', '# Index\n\n[[projects/alpha]]\n', { baseRevision: null })
    const alpha = await open('projects/alpha.md')

    const result = await backend.files.renameFolder({ folderPath: 'projects', newName: ' work ' })

    expect(result).toEqual({ oldPath: 'projects', newPath: 'work', updatedFiles: 1 })
    expect(alpha.path).toBe('work/alpha.md')
    expect(await fixture.desktop.read('index.md')).toBe('# Index\n\n[[work/alpha]]\n')
    expect((await fixture.desktop.log())[0]).toBe('Rename folder projects to work')
  })

  it('answers a taken name with the desktop message', async () => {
    await expect(backend.files.renameFolder({ folderPath: 'projects', newName: 'attachments' })).rejects.toThrow(
      "Folder 'attachments' already exists",
    )
  })

  it.each(['quarterly:plan', 'LPT1', 'con.txt', 'trailing.', '', 'a/b'])('refuses %j before any request', async (newName) => {
    await expect(renameFolder(noRequest, { folderPath: 'projects', newName })).rejects.toThrow('Invalid folder name')
  })

  it('sends nothing when the name does not change, and keeps nested folders in their parent', async () => {
    await expect(renameFolder(noRequest, { folderPath: 'a/b', newName: 'b' })).resolves.toEqual({
      oldPath: 'a/b',
      newPath: 'a/b',
      updatedFiles: 0,
    })
    const sent: unknown[] = []
    const answer = async (_path: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)))
      return Response.json({ path: 'a/c' })
    }
    await expect(renameFolder(answer, { folderPath: 'a/b', newName: 'c' })).resolves.toEqual({
      oldPath: 'a/b',
      newPath: 'a/c',
      updatedFiles: 0,
    })
    expect(sent).toEqual([{ from: 'a/b', to: 'a/c', rewriteLinks: true }])
  })
})

describe('creating and deleting a folder on the web', () => {
  it('creates an empty folder in one commit that the folder tree shows', async () => {
    await backend.files.createFolder({ parentPath: 'projects', name: 'Drafts' })

    expect((await fixture.desktop.log())[0]).toBe('Create folder projects/Drafts')
    expect(await fixture.desktop.read('projects/Drafts/.keep')).toBe('')
    expect(await backend.chrome.listFolders()).toContainEqual({
      name: 'projects',
      path: 'projects',
      children: [{ name: 'Drafts', path: 'projects/Drafts', children: [] }],
    })
  })

  it('creates a folder at the vault root without a parent', async () => {
    await backend.files.createFolder({ parentPath: null, name: 'Ideas' })

    expect((await fixture.desktop.log())[0]).toBe('Create folder Ideas')
  })

  it('answers a taken name with the desktop message', async () => {
    await expect(backend.files.createFolder({ parentPath: null, name: 'projects' })).rejects.toThrow(
      "Folder 'projects' already exists",
    )
  })

  it.each(['quarterly:plan', 'LPT1', 'con.txt', 'trailing.', '', 'a/b'])('refuses %j before any request', async (name) => {
    await expect(createFolder(noRequest, { parentPath: null, name })).rejects.toThrow('Invalid folder name')
  })

  it('deletes a folder with its notes in one commit and closes their documents', async () => {
    await backend.files.write('projects/deep/beta.md', '# Beta\n', { baseRevision: null })
    await backend.files.write('projects-old/kept.md', '# Kept\n', { baseRevision: null })
    const alpha = await open('projects/alpha.md')
    const closed = new Promise<void>((resolve) => alpha.provider.onStatus((status) => {
      if (status !== 'synced') resolve()
    }))

    await expect(backend.files.deleteFolder('projects')).resolves.toBe('projects')

    await closed
    expect((await fixture.desktop.log())[0]).toBe('Delete folder projects')
    expect((await vault.list()).files.map((file) => file.path)).toEqual(['attachments/pixel.bin', 'projects-old/kept.md', 'welcome.md'])
  })

  it('answers a missing folder with the desktop message', async () => {
    await expect(backend.files.deleteFolder('nowhere')).rejects.toThrow('Folder does not exist: nowhere')
  })

  it('refuses a path that is not a vault path before any request', async () => {
    await expect(deleteFolder(noRequest, '../escape')).rejects.toMatchObject({ status: 400 })
  })
})
