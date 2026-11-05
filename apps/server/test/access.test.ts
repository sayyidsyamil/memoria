import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  EntriesDeltaResponse,
  EntriesResponse,
  ListResponse,
  SearchResponse,
  VaultResponse,
} from '../../../packages/protocol/src/index.ts'
import { Access } from '../src/access.ts'
import { Revocations } from '../src/accessRevocations.ts'
import { accessTicketKey, readAccessTicket, signAccessTicket } from '../src/accessTickets.ts'
import { ChangeEmitter } from '../src/changeEmitter.ts'
import { blobEtag } from '../src/paths.ts'
import { closeVaultServer, createVaultServer } from '../src/server.ts'
import { LocalDiskStore } from '../src/store.ts'
import type { Vault } from '../src/vault.ts'
import {
  accessTicket,
  bearer,
  NOTE,
  NOTE_EDITOR,
  NOTE_VIEWER,
  OTHER_NOTE,
  OWNER_TICKET,
  TOKEN,
  VAULT_EDITOR,
  VAULT_VIEWER,
} from './accessHelpers.ts'
import { createFixture, type Fixture, SEED_NOTES, text } from './helpers.ts'

// TOL-18 (B5-2): access tickets give a subject viewer, editor or owner on the vault or on one note.

let fixture: Fixture
let vault: Vault
let server: Server
let base: string

beforeEach(async () => {
  fixture = await createFixture()
  const changes = new ChangeEmitter()
  vault = await fixture.openVault({ fetchIntervalMs: 0, onVaultEvent: (event) => changes.emit(event) })
  server = await createVaultServer({
    vault,
    store: new LocalDiskStore(join(fixture.root, 'server', 'state')),
    token: TOKEN,
    maxBodyBytes: 1024 * 1024,
    collab: { lingerMs: 10 },
    changes,
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  await closeVaultServer(server)
  await vault.idle()
  await fixture.cleanup()
})

interface Call {
  path: string
  init: RequestInit
}

/** The only host these tests may call: the server they started on loopback. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1'])

function call({ path, init }: Call): Promise<Response> {
  const url = new URL(path, base)
  if (LOOPBACK_HOSTS.has(url.hostname)) {
    return fetch(url, init)
  }
  throw new Error(`the access tests only call the local test server, not ${url.host}`)
}

function as(credential: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = { ...bearer(credential), ...(init.headers as Record<string, string>) }
  return call({ path, init: { ...init, headers } })
}

function json(body: object): RequestInit {
  return { method: 'POST', body: JSON.stringify(body) }
}

async function docIdOf(path: string): Promise<string> {
  const { files } = (await (await as(TOKEN, '/v1/files')).json()) as ListResponse
  return files.find((file) => file.path === path)?.docId ?? ''
}

async function head(): Promise<string> {
  return ((await (await as(TOKEN, '/v1/files')).json()) as ListResponse).head
}

const WELCOME_ETAG = blobEtag(text(SEED_NOTES[OTHER_NOTE]))
const ALPHA_ETAG = blobEtag(text(SEED_NOTES[NOTE]))

/** Every route that changes the vault or what others may do, with a request that would succeed for the owner. */
const WRITES: Array<[string, string, () => Promise<RequestInit>]> = [
  ['PUT a note', `/v1/files/${NOTE}`, async () => ({ method: 'PUT', body: '# Changed\n', headers: { 'if-match': `"${ALPHA_ETAG}"` } })],
  ['PUT a new file', '/v1/files/new.md', async () => ({ method: 'PUT', body: '# New\n', headers: { 'if-none-match': '*' } })],
  ['DELETE a file', `/v1/files/${NOTE}`, async () => ({ method: 'DELETE', headers: { 'if-match': `"${ALPHA_ETAG}"` } })],
  ['rename a file', '/v1/rename', async () => json({ from: NOTE, to: 'projects/beta.md' })],
  ['rename a folder', '/v1/folders/rename', async () => json({ from: 'projects', to: 'archive' })],
  ['create a folder', '/v1/folders', async () => json({ path: 'ideas' })],
  ['delete a folder', '/v1/folders/delete', async () => json({ path: 'projects' })],
  ['import an attachment', '/v1/attachments/imports', async () => json({ url: 'https://images.example/cat.png' })],
  ['sync', '/v1/sync', async () => ({ method: 'POST' })],
  ['ask for a write collab ticket', '/v1/collab/tickets', async () => json({ docId: await docIdOf(NOTE), access: 'write' })],
  ['revoke access', '/v1/access/revocations', async () => json({ subject: 'someone' })],
]

describe('a viewer of the vault', () => {
  it('reads every file, the index and the search', async () => {
    const viewer = VAULT_VIEWER()
    const files = (await (await as(viewer, '/v1/files')).json()) as ListResponse
    const entries = (await (await as(viewer, '/v1/entries')).json()) as EntriesResponse

    expect(files.files.map((file) => file.path).sort()).toEqual(Object.keys(SEED_NOTES).sort())
    expect(entries.entries.map((entry) => entry.path)).toContain(OTHER_NOTE)
    expect((await as(viewer, `/v1/files/${NOTE}`)).status).toBe(200)
    expect((await as(viewer, '/v1/search?q=Heron')).status).toBe(200)
  })

  it('learns what it may do from GET /v1/vault', async () => {
    const meta = (await (await as(VAULT_VIEWER(), '/v1/vault')).json()) as VaultResponse

    expect(meta.access).toEqual({ subject: 'viewer-1', grants: [{ scope: '*', role: 'viewer' }] })
    expect(meta.capabilities).toContain('access.tickets')
  })

  it.each(WRITES)('is refused when it tries to %s, and nothing is committed', async (_name, path, init) => {
    const before = await head()

    const response = await as(VAULT_VIEWER(), path, await init())

    expect(response.status).toBe(403)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('forbidden')
    expect(await head()).toBe(before)
  })

  it('may ask for a read collab ticket', async () => {
    const response = await as(VAULT_VIEWER(), '/v1/collab/tickets', json({ docId: await docIdOf(NOTE), access: 'read' }))

    expect(response.status).toBe(201)
  })
})

describe('an editor of one note', () => {
  it('writes that note', async () => {
    const response = await as(NOTE_EDITOR(), `/v1/files/${NOTE}`, {
      method: 'PUT',
      body: '# Alpha edited\n',
      headers: { 'if-match': `"${ALPHA_ETAG}"` },
    })

    expect(response.status).toBe(200)
    expect(await fixture.desktop.read(NOTE)).toBe('# Alpha edited\n')
  })

  it('sees nothing else of the vault: other files are not listed, read, indexed or found', async () => {
    const editor = NOTE_EDITOR()
    const files = (await (await as(editor, '/v1/files')).json()) as ListResponse
    const entries = (await (await as(editor, '/v1/entries')).json()) as EntriesResponse
    const found = (await (await as(editor, '/v1/search?q=throwaway')).json()) as SearchResponse

    expect(files.files.map((file) => file.path)).toEqual([NOTE])
    expect(entries.entries.map((entry) => entry.path)).toEqual([NOTE])
    expect(found.results).toEqual([])
    expect((await as(editor, `/v1/files/${OTHER_NOTE}`)).status).toBe(404)
  })

  it('cannot write outside its note', async () => {
    const response = await as(NOTE_EDITOR(), `/v1/files/${OTHER_NOTE}`, {
      method: 'PUT',
      body: 'overwritten',
      headers: { 'if-match': `"${WELCOME_ETAG}"` },
    })

    expect(response.status).toBe(404)
    expect(await fixture.desktop.read(OTHER_NOTE)).toBe(SEED_NOTES[OTHER_NOTE])
    expect((await as(NOTE_EDITOR(), '/v1/files/new.md', { method: 'PUT', body: '# New\n', headers: { 'if-none-match': '*' } })).status).toBe(404)
  })

  it.each(WRITES.filter(([name]) => !['PUT a note', 'PUT a new file', 'sync', 'ask for a write collab ticket'].includes(name)))(
    'cannot %s: adding, moving and deleting files needs the vault',
    async (_name, path, init) => {
      const before = await head()

      expect((await as(NOTE_EDITOR(), path, await init())).status).toBe(403)
      expect(await head()).toBe(before)
    },
  )

  it('may sync and ask for a write ticket on its note, not on another', async () => {
    const editor = NOTE_EDITOR()

    expect((await as(editor, '/v1/sync', { method: 'POST' })).status).toBe(200)
    expect((await as(editor, '/v1/collab/tickets', json({ docId: await docIdOf(NOTE), access: 'write' }))).status).toBe(201)
    expect((await as(editor, '/v1/collab/tickets', json({ docId: await docIdOf(OTHER_NOTE) }))).status).toBe(404)
  })

  it('gets an index entity tag of its own, so a cached owner view is never reused', async () => {
    const owner = await as(TOKEN, '/v1/entries')
    const editor = await as(NOTE_EDITOR(), '/v1/entries', { headers: { 'if-none-match': owner.headers.get('etag') ?? '' } })

    expect(editor.status).toBe(200)
    expect(editor.headers.get('etag')).not.toBe(owner.headers.get('etag'))
    const again = await as(NOTE_EDITOR(), '/v1/entries', { headers: { 'if-none-match': editor.headers.get('etag') ?? '' } })
    expect(again.status).toBe(304)
  })

  it('gets index deltas of its note only', async () => {
    const start = await head()
    await as(TOKEN, `/v1/files/${OTHER_NOTE}`, { method: 'PUT', body: '# Welcome again\n', headers: { 'if-match': `"${WELCOME_ETAG}"` } })
    await as(TOKEN, `/v1/files/${NOTE}`, { method: 'PUT', body: '# Alpha again\n', headers: { 'if-match': `"${ALPHA_ETAG}"` } })

    const delta = (await (await as(NOTE_VIEWER(), `/v1/entries?since=${start}`)).json()) as EntriesDeltaResponse

    expect(delta.changed.map((entry) => entry.path)).toEqual([NOTE])
  })
})

describe('an editor of the vault', () => {
  it('adds, moves and deletes files', async () => {
    const editor = VAULT_EDITOR()

    expect((await as(editor, '/v1/rename', json({ from: NOTE, to: 'projects/beta.md' }))).status).toBe(200)
    expect((await as(editor, '/v1/folders', json({ path: 'ideas' }))).status).toBe(201)
    expect((await as(editor, `/v1/files/${OTHER_NOTE}`, { method: 'DELETE', headers: { 'if-match': `"${WELCOME_ETAG}"` } })).status).toBe(200)
  })

  it('cannot revoke anyone', async () => {
    expect((await as(VAULT_EDITOR(), '/v1/access/revocations', json({ subject: 'viewer-1' }))).status).toBe(403)
  })
})

describe('the owner', () => {
  it('keeps full access with the bearer token, and GET /v1/vault says so', async () => {
    const meta = (await (await as(TOKEN, '/v1/vault')).json()) as VaultResponse

    expect(meta.access).toEqual({ subject: null, grants: [{ scope: '*', role: 'owner' }] })
    for (const [, path, init] of WRITES.filter(([name]) => name === 'create a folder' || name === 'revoke access')) {
      expect((await as(TOKEN, path, await init())).status).toBeLessThan(300)
    }
  })

  it('may also act with an owner ticket', async () => {
    expect((await as(OWNER_TICKET(), '/v1/access/revocations', json({ subject: 'viewer-1' }))).status).toBe(200)
    expect((await as(OWNER_TICKET(), '/v1/folders', json({ path: 'ideas' }))).status).toBe(201)
  })
})

describe('tickets that are not accepted', () => {
  const now = Date.now()
  const viewer = [{ scope: '*', role: 'viewer' as const }]
  const key = accessTicketKey(TOKEN)

  it.each([
    ['signed with another token', signAccessTicket({ v: 1, sub: 'x', grants: viewer, iat: now, exp: now + 60_000 }, accessTicketKey('another-token-0123456789'))],
    ['expired', accessTicket('x', viewer, { iat: now - 120_000, exp: now - 60_000 })],
    ['living longer than ten minutes', accessTicket('x', viewer, { iat: now, exp: now + 11 * 60_000 })],
    ['issued in the future', accessTicket('x', viewer, { iat: now + 5 * 60_000, exp: now + 6 * 60_000 })],
    ['of another version', signAccessTicket({ v: 2, sub: 'x', grants: viewer, iat: now, exp: now + 60_000 } as never, key)],
    ['giving owner on a note', accessTicket('x', [{ scope: NOTE, role: 'owner' }])],
    ['giving an unknown role', accessTicket('x', [{ scope: '*', role: 'admin' as never }])],
    ['scoped to an invalid path', accessTicket('x', [{ scope: '../secret.md', role: 'viewer' }])],
    ['without grants', accessTicket('x', [])],
    ['without a subject', accessTicket('', viewer)],
    ['tampered with', VAULT_VIEWER().replace(/^ta1\.[^.]{4}/, 'ta1.AAAA')],
    ['not JSON', `ta1.bm90IGpzb24.${Buffer.alloc(32).toString('base64url')}`],
  ])('refuses a ticket %s with 401', async (_name, ticket) => {
    const response = await as(ticket, '/v1/files')

    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe('Bearer')
  })

  it('refuses the signature of a valid ticket on other grants', () => {
    const [prefix, , signature] = VAULT_VIEWER().split('.')
    const forged = `${prefix}.${Buffer.from(JSON.stringify({ v: 1, sub: 'x', grants: [{ scope: '*', role: 'owner' }], iat: now, exp: now + 60_000 })).toString('base64url')}.${signature}`

    expect(readAccessTicket(forged, key, now)).toBeNull()
  })
})

describe('revoking', () => {
  it('refuses the tickets issued before the revocation and accepts newer ones', async () => {
    const old = accessTicket('viewer-1', [{ scope: '*', role: 'viewer' }], { iat: Date.now() - 1_000 })
    expect((await as(old, '/v1/files')).status).toBe(200)

    const revoked = await as(TOKEN, '/v1/access/revocations', json({ subject: 'viewer-1', before: Date.now() - 500 }))

    expect(await revoked.json()).toEqual({ closed: 0 })
    expect((await as(old, '/v1/files')).status).toBe(401)
    expect((await as(VAULT_VIEWER(), '/v1/files')).status).toBe(200)
  })

  it('refuses a request without a subject or with malformed grants', async () => {
    expect((await as(TOKEN, '/v1/access/revocations', json({}))).status).toBe(400)
    expect((await as(TOKEN, '/v1/access/revocations', json({ subject: 'x', grants: [{ scope: '*', role: 'god' }] }))).status).toBe(400)
    expect((await as(TOKEN, '/v1/access/revocations', json({ subject: 'x', before: 'yesterday' }))).status).toBe(400)
  })

  it('closes the change feed of the subject and filters it to readable paths until then', async () => {
    const controller = new AbortController()
    const feed = await as(NOTE_VIEWER(), '/v1/changes', { signal: controller.signal })
    const reader = (feed.body as ReadableStream<Uint8Array>).getReader()
    const received: string[] = []
    const reading = (async () => {
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) received.push(Buffer.from(chunk.value).toString())
    })()

    await as(TOKEN, `/v1/files/${OTHER_NOTE}`, { method: 'PUT', body: '# Hidden\n', headers: { 'if-match': `"${WELCOME_ETAG}"` } })
    await as(TOKEN, `/v1/files/${NOTE}`, { method: 'PUT', body: '# Seen\n', headers: { 'if-match': `"${ALPHA_ETAG}"` } })
    await expect.poll(() => received.join('')).toContain(NOTE)
    const revoked = await as(TOKEN, '/v1/access/revocations', json({ subject: 'note-viewer-1' }))
    await reading

    expect(await revoked.json()).toEqual({ closed: 1 })
    expect(received.join('')).not.toContain(OTHER_NOTE)
    controller.abort()
  })

  it('keeps open connections that the remaining grants still cover', () => {
    const revocations = new Revocations()
    const access = new Access('s', [{ scope: NOTE, role: 'viewer' }], 1)
    const closed: string[] = []
    revocations.track('s', { allowedBy: (remaining) => access.coveredBy(remaining), close: () => closed.push('note') })
    revocations.track('s', { allowedBy: (remaining) => remaining.canWrite(NOTE), close: () => closed.push('write') })

    const count = revocations.revoke('s', { remaining: new Access('s', [{ scope: '*', role: 'viewer' }], 0), before: 1 })

    expect([count, closed]).toEqual([1, ['write']])
    expect(revocations.refuses(access)).toBe(true)
    expect(revocations.refuses(new Access('s', [], 2))).toBe(false)
  })
})
