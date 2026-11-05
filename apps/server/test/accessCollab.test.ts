import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket as NodeWebSocket } from 'ws'
import * as Y from 'yjs'
import { CollabProvider, type SocketLike } from '../../../packages/collab-client/src/collabProvider.ts'
import { COLLAB_CLOSE, type CollabTicketResponse, type ListResponse } from '../../../packages/protocol/src/index.ts'
import { ChangeEmitter } from '../src/changeEmitter.ts'
import { closeVaultServer, createVaultServer } from '../src/server.ts'
import { LocalDiskStore } from '../src/store.ts'
import type { Vault } from '../src/vault.ts'
import { accessTicket, bearer, NOTE, NOTE_EDITOR, OTHER_NOTE, TOKEN, VAULT_VIEWER } from './accessHelpers.ts'
import { codec, settle } from './collabHelpers.ts'
import { createFixture, type Fixture } from './helpers.ts'

// TOL-18 (B5-2): the collaboration channel enforces access tickets, and revoking closes open sockets.

let fixture: Fixture
let vault: Vault
let server: Server
let origin: string
let providers: CollabProvider[]
let sockets: NodeWebSocket[]

beforeEach(async () => {
  fixture = await createFixture()
  vault = await fixture.openVault({ fetchIntervalMs: 0 })
  providers = []
  sockets = []
  server = await createVaultServer({
    vault,
    store: new LocalDiskStore(join(fixture.root, 'server', 'state')),
    token: TOKEN,
    maxBodyBytes: 1024 * 1024,
    collab: { policy: { idleMs: 30, maxWaitMs: 5_000 }, lingerMs: 10 },
    changes: new ChangeEmitter(),
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  for (const provider of providers) provider.destroy()
  for (const socket of sockets) socket.terminate()
  await closeVaultServer(server)
  await vault.idle()
  await settle(20)
  await fixture.cleanup()
})

interface Call {
  path: string
  init: RequestInit
}

/** Every request goes to the server this test started on loopback. */
function call({ path, init }: Call): Promise<Response> {
  return fetch(new URL(path, origin), init)
}

function as(credential: string, path: string, init: RequestInit = {}): Promise<Response> {
  return call({ path, init: { ...init, headers: bearer(credential) } })
}

async function docIdOf(path: string): Promise<string> {
  const { files } = (await (await as(TOKEN, '/v1/files')).json()) as ListResponse
  return files.find((file) => file.path === path)?.docId ?? ''
}

async function ticket(credential: string, path: string, access: 'read' | 'write'): Promise<Response> {
  return as(credential, '/v1/collab/tickets', { method: 'POST', body: JSON.stringify({ docId: await docIdOf(path), access }) })
}

async function socketUrl(credential: string, path: string, access: 'read' | 'write'): Promise<string> {
  const issued = (await (await ticket(credential, path, access)).json()) as CollabTicketResponse
  return `${origin.replace('http', 'ws')}${issued.path}?ticket=${issued.ticket}`
}

/** A browser-style client of `path` on a collab ticket asked for with `credential`. */
async function joinOn(credential: string, path: string, access: 'read' | 'write'): Promise<CollabProvider> {
  const provider = new CollabProvider({
    doc: new Y.Doc(),
    openSocket: async () => new NodeWebSocket(await socketUrl(credential, path, access)) as unknown as SocketLike,
  })
  providers.push(provider)
  await provider.whenSynced()
  return provider
}

/** A client that sends its credential as a header on the upgrade, as a non-browser client can. */
async function joinWithHeader(credential: string, path: string): Promise<CollabProvider> {
  const url = `${origin.replace('http', 'ws')}/v1/collab/docs/${await docIdOf(path)}`
  const provider = new CollabProvider({
    doc: new Y.Doc(),
    openSocket: async () => new NodeWebSocket(url, { headers: bearer(credential) }) as unknown as SocketLike,
  })
  providers.push(provider)
  await provider.whenSynced()
  return provider
}

function upgradeStatus(url: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve) => {
    const socket = new NodeWebSocket(url, { headers })
    sockets.push(socket)
    socket.on('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0))
    socket.on('open', () => resolve(101))
    socket.on('error', () => {})
  })
}

/** Opens a raw socket and resolves once it is open; `closed` resolves with the close code. */
async function openRaw(url: string): Promise<{ closed: Promise<number> }> {
  const socket = new NodeWebSocket(url)
  sockets.push(socket)
  const closed = new Promise<number>((resolve) => socket.on('close', (code) => resolve(code)))
  await new Promise((resolve) => socket.on('open', resolve))
  return { closed }
}

function heading(doc: Y.Doc): Y.XmlText {
  return doc.getXmlFragment('blocks').createTreeWalker((node) => node instanceof Y.XmlText).next().value as Y.XmlText
}

function revoke(subject: string, grants: object[] = []): Promise<Response> {
  return as(TOKEN, '/v1/access/revocations', { method: 'POST', body: JSON.stringify({ subject, grants }) })
}

/** What the server's document holds, seen by a fresh owner client. */
async function serverText(path: string): Promise<string> {
  const owner = await joinOn(TOKEN, path, 'read')
  await settle(10)
  return codec.read(owner.doc)
}

describe('a viewer on the websocket', () => {
  it('is refused a write ticket', async () => {
    const response = await ticket(VAULT_VIEWER(), NOTE, 'write')

    expect(response.status).toBe(403)
  })

  it('reads the document, but its changes are dropped', async () => {
    const viewer = await joinOn(VAULT_VIEWER(), NOTE, 'read')
    expect(codec.read(viewer.doc)).toContain('# Alpha')

    heading(viewer.doc).insert(0, 'Viewer ')
    await settle(20)

    expect(await serverText(NOTE)).not.toContain('Viewer')
    expect(await fixture.desktop.read(NOTE)).not.toContain('Viewer')
  })

  it('is admitted read-only when it sends its ticket as a header', async () => {
    const viewer = await joinWithHeader(VAULT_VIEWER(), NOTE)

    heading(viewer.doc).insert(0, 'Header ')
    await settle(20)

    expect(await serverText(NOTE)).not.toContain('Header')
  })
})

describe('an editor of one note on the websocket', () => {
  it('edits its note and the edit is committed', async () => {
    const editor = await joinOn(NOTE_EDITOR(), NOTE, 'write')

    heading(editor.doc).insert(0, 'Shared ')

    await expect.poll(() => fixture.desktop.read(NOTE), { timeout: 5_000 }).toContain('# Shared Alpha')
  })

  it('cannot open another note, with a ticket or with a header', async () => {
    const url = `${origin.replace('http', 'ws')}/v1/collab/docs/${await docIdOf(OTHER_NOTE)}`

    expect((await ticket(NOTE_EDITOR(), OTHER_NOTE, 'read')).status).toBe(404)
    expect(await upgradeStatus(url, bearer(NOTE_EDITOR()))).toBe(404)
  })

  it('cannot open a socket with a ticket of another signer', async () => {
    const url = `${origin.replace('http', 'ws')}/v1/collab/docs/${await docIdOf(NOTE)}`
    const forged = `${NOTE_EDITOR().slice(0, -8)}AAAAAAAA`

    expect(await upgradeStatus(url, bearer(forged))).toBe(401)
  })
})

describe('revoking with sockets open', () => {
  it('closes the subject’s socket with 4403 at once', async () => {
    const { closed } = await openRaw(await socketUrl(NOTE_EDITOR(), NOTE, 'write'))

    const response = await revoke('note-editor-1')

    expect(await response.json()).toEqual({ closed: 1 })
    expect(await closed).toBe(COLLAB_CLOSE.revoked)
  })

  it('downgrading an editor to viewer closes its write socket and keeps its read socket', async () => {
    const writer = await openRaw(await socketUrl(NOTE_EDITOR(), NOTE, 'write'))
    const reader = await openRaw(await socketUrl(NOTE_EDITOR(), NOTE, 'read'))
    let readerClosed = false
    void reader.closed.then(() => {
      readerClosed = true
    })

    const response = await revoke('note-editor-1', [{ scope: NOTE, role: 'viewer' }])

    expect(await response.json()).toEqual({ closed: 1 })
    expect(await writer.closed).toBe(COLLAB_CLOSE.revoked)
    await settle(10)
    expect(readerClosed).toBe(false)
  })

  it('leaves other subjects and the owner connected', async () => {
    const other = await openRaw(await socketUrl(accessTicket('other-1', [{ scope: '*', role: 'editor' }]), NOTE, 'write'))
    const owner = await openRaw(await socketUrl(TOKEN, NOTE, 'write'))
    const closed: number[] = []
    void other.closed.then((code) => closed.push(code))
    void owner.closed.then((code) => closed.push(code))

    expect(await (await revoke('note-editor-1')).json()).toEqual({ closed: 0 })
    await settle(10)
    expect(closed).toEqual([])
  })

  it('refuses a collab ticket issued before the revocation', async () => {
    const url = await socketUrl(NOTE_EDITOR(), NOTE, 'write')

    await revoke('note-editor-1')

    expect(await upgradeStatus(url)).toBe(401)
  })
})
