import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket as NodeWebSocket } from 'ws'
import * as Y from 'yjs'
import { CollabProvider, type SocketLike } from '../../../packages/collab-client/src/collabProvider.ts'
import { type CollabTicketResponse, type ListResponse, PROTOCOL_VERSION, type VaultResponse } from '../../../packages/protocol/src/index.ts'
import { closeVaultServer, createVaultServer } from '../src/server.ts'
import { LocalDiskStore } from '../src/store.ts'
import type { Vault } from '../src/vault.ts'
import { codec, settle } from './collabHelpers.ts'
import { createFixture, type Fixture } from './helpers.ts'

const TOKEN = 'test-token-0123456789'
const NOTE = 'projects/alpha.md'

let fixture: Fixture
let vault: Vault
let store: GatedStore
let server: Server
let origin: string
let providers: CollabProvider[]

interface Call {
  path: string
  init: RequestInit
}

/** Every request goes to the server this test started on loopback, with the test token. */
function call({ path, init }: Call): Promise<Response> {
  const authorized = { ...init, headers: { authorization: `Bearer ${TOKEN}` } }
  return fetch(new URL(path, origin), authorized)
}

/** The disk store, able to hold the collaboration snapshots back: a document then stays opening. */
class GatedStore extends LocalDiskStore {
  private gate: Promise<void> = Promise.resolve()

  /** Holds every snapshot read until the returned function is called. */
  hold(): () => void {
    let release = () => {}
    this.gate = new Promise((resolve) => {
      release = resolve
    })
    return release
  }

  override async get(key: string): Promise<Uint8Array | null> {
    if (key.startsWith('collab/')) await this.gate
    return super.get(key)
  }
}

function api(path: string, init: RequestInit = {}): Promise<Response> {
  return call({ path, init })
}

async function docIdOf(path: string): Promise<string> {
  const { files } = (await (await api('/v1/files')).json()) as ListResponse
  return files.find((file) => file.path === path)?.docId ?? ''
}

async function ticket(body: object): Promise<Response> {
  return api('/v1/collab/tickets', { method: 'POST', body: JSON.stringify(body) })
}

function socketUrl(path: string, query = ''): string {
  return `${origin.replace('http', 'ws')}${path}${query}`
}

/** Resolves with the HTTP status a websocket upgrade was refused with, or 101 when it opened. */
function upgradeStatus(url: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve) => {
    const socket = new NodeWebSocket(url, { headers })
    socket.on('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0))
    socket.on('open', () => {
      socket.close()
      resolve(101)
    })
    socket.on('error', () => {})
  })
}

/** A browser-style client: no headers, a fresh ticket for every connection. */
async function joinNote(path: string, access: 'read' | 'write' = 'write'): Promise<CollabProvider> {
  const docId = await docIdOf(path)
  const provider = new CollabProvider({
    doc: new Y.Doc(),
    openSocket: async () => {
      const issued = (await (await ticket({ docId, access })).json()) as CollabTicketResponse
      return new NodeWebSocket(socketUrl(issued.path, `?ticket=${issued.ticket}`)) as unknown as SocketLike
    },
  })
  providers.push(provider)
  await provider.whenSynced()
  return provider
}

function heading(doc: Y.Doc): Y.XmlText {
  return doc.getXmlFragment('blocks').createTreeWalker((node) => node instanceof Y.XmlText).next().value as Y.XmlText
}

async function converged(a: CollabProvider, b: CollabProvider): Promise<void> {
  for (let round = 0; round < 200 && codec.read(a.doc) !== codec.read(b.doc); round++) await settle(1)
}

async function start(collab?: false): Promise<void> {
  store = new GatedStore(join(fixture.root, 'server', 'state'))
  server = await createVaultServer({
    vault,
    store,
    token: TOKEN,
    maxBodyBytes: 1024 * 1024,
    collab: collab ?? { policy: { idleMs: 30, maxWaitMs: 5_000 }, lingerMs: 10 },
    changes: new (await import('../src/changeEmitter.ts')).ChangeEmitter(),
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

beforeEach(async () => {
  fixture = await createFixture()
  vault = await fixture.openVault()
  providers = []
  await start()
})

afterEach(async () => {
  for (const provider of providers) provider.destroy()
  await closeVaultServer(server)
  await vault.idle()
  await settle(20)
  await fixture.cleanup()
})

describe('the collaboration channel over websockets', () => {
  it('is advertised with protocol 1.2 and the collaboration capabilities', async () => {
    const meta = (await (await api('/v1/vault')).json()) as VaultResponse

    expect(meta.protocolVersion).toBe(PROTOCOL_VERSION)
    expect(meta.capabilities).toEqual(expect.arrayContaining(['collab.yjs', 'collab.awareness', 'collab.tickets']))
    expect(meta.collab.available).toBe(true)
  })

  it('makes two clients converge and see each other', async () => {
    const ada = await joinNote(NOTE)
    const luca = await joinNote(NOTE)
    ada.awareness.setLocalStateField('user', { name: 'Ada', color: '#d33' })

    heading(ada.doc).insert(0, 'A-')
    heading(luca.doc).insert(heading(luca.doc).length, '-L')
    await converged(ada, luca)

    expect(codec.read(luca.doc)).toContain('# A-Alpha-L')
    expect(codec.read(ada.doc)).toBe(codec.read(luca.doc))
    expect(luca.awareness.getStates().get(ada.doc.clientID)).toEqual({ user: { name: 'Ada', color: '#d33' } })
  })

  it('commits the edit to the vault after the typing stops', async () => {
    const ada = await joinNote(NOTE)

    heading(ada.doc).insert(0, 'Saved ')
    await expect.poll(() => fixture.desktop.read(NOTE), { timeout: 5_000 }).toContain('# Saved Alpha')
  })

  it('writes what is pending when the server stops', async () => {
    const ada = await joinNote(NOTE)
    heading(ada.doc).insert(0, 'Last words ')
    await settle()
    ada.destroy()

    await closeVaultServer(server)

    expect(await fixture.desktop.read(NOTE)).toContain('# Last words Alpha')
  })

  it('accepts the bearer token on the upgrade request itself', async () => {
    const docId = await docIdOf(NOTE)

    expect(await upgradeStatus(socketUrl(`/v1/collab/docs/${docId}`), { authorization: `Bearer ${TOKEN}` })).toBe(101)
  })

  it.each([
    ['no credentials', '', {}],
    ['a wrong bearer token', '', { authorization: 'Bearer wrong-token-0123456789' }],
    ['an unknown ticket', '?ticket=nope', {}],
  ])('refuses an upgrade with %s', async (_name, query, headers) => {
    const docId = await docIdOf(NOTE)

    expect(await upgradeStatus(socketUrl(`/v1/collab/docs/${docId}`, query), headers)).toBe(401)
  })

  it('refuses an upgrade for a document or a route that does not exist', async () => {
    const headers = { authorization: `Bearer ${TOKEN}` }

    expect(await upgradeStatus(socketUrl('/v1/collab/docs/7f0c1f6e-0000-4000-8000-000000000000'), headers)).toBe(404)
    expect(await upgradeStatus(socketUrl('/v1/files/welcome.md'), headers)).toBe(404)
  })

  it('lets a ticket open one websocket, for its own document only', async () => {
    const [alpha, welcome] = [await docIdOf(NOTE), await docIdOf('welcome.md')]
    const once = (await (await ticket({ docId: alpha })).json()) as CollabTicketResponse
    const other = (await (await ticket({ docId: alpha })).json()) as CollabTicketResponse

    expect(await upgradeStatus(socketUrl(once.path, `?ticket=${once.ticket}`))).toBe(101)
    expect(await upgradeStatus(socketUrl(once.path, `?ticket=${once.ticket}`))).toBe(401)
    expect(await upgradeStatus(socketUrl(`/v1/collab/docs/${welcome}`, `?ticket=${other.ticket}`))).toBe(401)
  })

  it('gives a read-only ticket a view that cannot edit', async () => {
    const viewer = await joinNote(NOTE, 'read')
    const editor = await joinNote(NOTE)

    heading(viewer.doc).insert(0, 'defaced ')
    heading(editor.doc).insert(0, 'edited ')
    await expect.poll(() => codec.read(viewer.doc)).toContain('edited')

    expect(codec.read(editor.doc)).not.toContain('defaced')
  })

  it('closes a websocket that sends bytes that are no message', async () => {
    const docId = await docIdOf(NOTE)
    const socket = new NodeWebSocket(socketUrl(`/v1/collab/docs/${docId}`), { headers: { authorization: `Bearer ${TOKEN}` } })
    const closed = new Promise<number>((resolve) => socket.on('close', resolve))

    socket.on('open', () => socket.send(new Uint8Array([1, 250])))

    expect(await closed).toBe(4400)
  })

  it('closes a websocket that sends more than the server accepts in one message', async () => {
    const docId = await docIdOf(NOTE)
    const socket = new NodeWebSocket(socketUrl(`/v1/collab/docs/${docId}`), { headers: { authorization: `Bearer ${TOKEN}` } })
    const closed = new Promise<number>((resolve) => socket.on('close', resolve))
    socket.on('error', () => {})

    socket.on('open', () => socket.send(new Uint8Array(1024 * 1024 + 1)))

    expect(await closed).toBe(1009)
  })

  it('closes a websocket that floods the server before its document has opened', async () => {
    const docId = await docIdOf(NOTE)
    const socket = new NodeWebSocket(socketUrl(`/v1/collab/docs/${docId}`), { headers: { authorization: `Bearer ${TOKEN}` } })
    const closed = new Promise<number>((resolve) => socket.on('close', resolve))
    socket.on('error', () => {})
    const releaseDocument = store.hold()

    socket.on('open', () => {
      for (let sent = 0; sent < 3; sent++) socket.send(new Uint8Array(512 * 1024))
    })
    const code = await closed
    releaseDocument()

    expect(code).toBe(1009)
  })

  it('frees the room of a client that disconnects before the document has opened', async () => {
    const docId = await docIdOf(NOTE)
    const socket = new NodeWebSocket(socketUrl(`/v1/collab/docs/${docId}`), { headers: { authorization: `Bearer ${TOKEN}` } })
    socket.on('error', () => {})
    socket.terminate()
    await settle()

    expect(codec.read((await joinNote(NOTE)).doc)).toContain('# Alpha')
  })
})

describe('POST /v1/collab/tickets', () => {
  it('issues a ticket that names the websocket path and when it expires', async () => {
    const docId = await docIdOf(NOTE)
    const response = await ticket({ docId, access: 'read' })
    const issued = (await response.json()) as CollabTicketResponse

    expect(response.status).toBe(201)
    expect(issued).toMatchObject({ path: `/v1/collab/docs/${docId}`, access: 'read' })
    expect(Date.parse(issued.expiresAt)).toBeGreaterThan(Date.now())
  })

  it.each([
    ['an unknown document', { docId: 'nope' }, 404],
    ['no document', {}, 404],
    ['an access that is neither read nor write', { docId: 'x', access: 'admin' }, 404],
  ])('refuses %s', async (_name, body, status) => {
    expect((await ticket(body)).status).toBe(status)
  })

  it('refuses an access that is neither read nor write for a real document', async () => {
    expect((await ticket({ docId: await docIdOf(NOTE), access: 'admin' })).status).toBe(400)
  })
})

describe('the collaboration route without a websocket', () => {
  it('answers 426 and says to upgrade', async () => {
    const response = await api(`/v1/collab/docs/${await docIdOf(NOTE)}`)

    expect(response.status).toBe(426)
    expect(response.headers.get('upgrade')).toBe('websocket')
  })

  it('answers 501 for documents and tickets on a server that does not serve the channel', async () => {
    await closeVaultServer(server)
    await start(false)

    expect((await api('/v1/collab/docs/anything')).status).toBe(501)
    expect((await ticket({ docId: 'x' })).status).toBe(501)
    expect(await upgradeStatus(socketUrl('/v1/collab/docs/anything'))).not.toBe(101)
  })
})
