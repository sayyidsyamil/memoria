import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocket as NodeWebSocket } from 'ws'
import { COLLAB_CLOSE, type ErrorBody, type ListResponse } from '../../../packages/protocol/src/index.ts'
import { ChangeEmitter } from '../src/changeEmitter.ts'
import { ConnectionCounter } from '../src/collab/connectionLimits.ts'
import { RateLimiter, retryAfterSeconds } from '../src/rateLimit.ts'
import { closeVaultServer, createVaultServer, type ServerOptions } from '../src/server.ts'
import { LocalDiskStore } from '../src/store.ts'
import type { Vault } from '../src/vault.ts'
import { createFixture, type Fixture } from './helpers.ts'

const TOKEN = 'test-token-0123456789'
const BEARER = { authorization: `Bearer ${TOKEN}` }
const GENEROUS = { perSecond: 1_000, burst: 1_000 }
/** One request per 100 s: no test runs long enough to see a bucket refill. */
const SLOW = 0.01

let fixture: Fixture
let vault: Vault
let server: Server | null
let origin: string
let sockets: NodeWebSocket[]

type Limits = Pick<ServerOptions, 'rateLimit' | 'collab'>

async function start({ rateLimit = GENEROUS, collab = {} }: Limits = {}): Promise<void> {
  server = await createVaultServer({
    vault,
    store: new LocalDiskStore(join(fixture.root, 'server', 'state')),
    token: TOKEN,
    maxBodyBytes: 1024 * 1024,
    rateLimit,
    collab: collab && { policy: { idleMs: 30, maxWaitMs: 5_000 }, lingerMs: 10, ...collab },
    changes: new ChangeEmitter(),
  })
  const listening = server
  await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(listening.address() as AddressInfo).port}`
}

interface Call {
  path: string
  headers?: Record<string, string>
}

/** Every request goes to the server this test started on loopback. */
function call({ path, headers = BEARER }: Call): Promise<Response> {
  return fetch(new URL(path, origin), { headers })
}

function api(path: string): Promise<Response> {
  return call({ path })
}

/** A request without the token. */
function anonymous(path: string): Promise<Response> {
  return call({ path, headers: {} })
}

async function docIdOf(path: string): Promise<string> {
  const { files } = (await (await api('/v1/files')).json()) as ListResponse
  return files.find((file) => file.path === path)?.docId ?? ''
}

interface Upgrade {
  status: number
  retryAfter?: string
  socket: NodeWebSocket
}

interface UpgradeOptions {
  autoPong?: boolean
  headers?: Record<string, string>
}

/** Opens a websocket, with the bearer token by default: 101 and the open socket, or the status it was refused with. */
function upgrade(docId: string, options: UpgradeOptions = {}): Promise<Upgrade> {
  const socket = new NodeWebSocket(`${origin.replace('http', 'ws')}/v1/collab/docs/${docId}`, { headers: BEARER, ...options })
  sockets.push(socket)
  socket.on('error', () => {})
  return new Promise((resolve) => {
    socket.on('unexpected-response', (_request, response) => {
      resolve({ status: response.statusCode ?? 0, retryAfter: response.headers['retry-after'], socket })
    })
    socket.on('open', () => resolve({ status: 101, socket }))
  })
}

function closeCode(socket: NodeWebSocket): Promise<number> {
  return new Promise((resolve) => socket.on('close', resolve))
}

beforeEach(async () => {
  fixture = await createFixture()
  vault = await fixture.openVault()
  server = null
  sockets = []
})

afterEach(async () => {
  for (const socket of sockets) socket.terminate()
  if (server) await closeVaultServer(server)
  await vault.idle()
  await fixture.cleanup()
})

describe('RateLimiter', () => {
  it('allows a burst, then one request per refill', () => {
    let now = 0
    const limiter = new RateLimiter({ perSecond: 2, burst: 3 }, () => now)

    expect([limiter.take('a'), limiter.take('a'), limiter.take('a')]).toEqual([0, 0, 0])
    expect(limiter.take('a')).toBe(500)
    now = 500
    expect(limiter.take('a')).toBe(0)
    expect(limiter.take('a')).toBe(500)
  })

  it('keeps one bucket per account and never fills one above its burst', () => {
    let now = 0
    const limiter = new RateLimiter({ perSecond: 1, burst: 1 }, () => now)

    expect(limiter.take('a')).toBe(0)
    expect(limiter.take('b')).toBe(0)
    now = 60_000
    expect([limiter.take('a'), limiter.take('a')]).toEqual([0, 1_000])
  })

  it('rounds Retry-After up to whole seconds, at least one', () => {
    expect([retryAfterSeconds(1), retryAfterSeconds(1_000), retryAfterSeconds(1_001)]).toEqual([1, 1, 2])
  })
})

describe('ConnectionCounter', () => {
  it('limits the sockets of an account and of a document, and frees a place once', () => {
    const counter = new ConnectionCounter({ perAccount: 2, perDoc: 1, idleTimeoutMs: 1_000 })
    const first = counter.admit('account', 'doc-1')

    expect(counter.admit('account', 'doc-1')).toBeNull()
    expect(counter.admit('account', 'doc-2')).not.toBeNull()
    expect(counter.admit('account', 'doc-3')).toBeNull()
    first?.()
    first?.()
    expect(counter.admit('account', 'doc-1')).not.toBeNull()
    expect(counter.admit('account', 'doc-3')).toBeNull()
  })
})

describe('the request rate limit', () => {
  // HTTP/git scheduling must not refill the bucket under test. Freeze only the
  // rate-limit clock, not the real timers used by sockets and server shutdown.
  beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(Date.now()) })
  afterEach(() => { vi.restoreAllMocks() })

  it('answers 429 rate_limited with Retry-After once the account has used its burst', async () => {
    await start({ rateLimit: { perSecond: SLOW, burst: 2 } })

    expect([(await api('/v1/vault')).status, (await api('/v1/vault')).status]).toEqual([200, 200])
    const limited = await api('/v1/vault')
    const body = (await limited.json()) as ErrorBody

    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('100')
    expect(body.error).toMatchObject({ code: 'rate_limited', details: { retryAfterSeconds: 100 } })
  })

  it('charges callers without the token to their own bucket and never limits /healthz', async () => {
    await start({ rateLimit: { perSecond: SLOW, burst: 1 } })

    expect((await anonymous('/v1/vault')).status).toBe(401)
    expect((await anonymous('/v1/vault')).status).toBe(429)
    expect((await api('/v1/vault')).status).toBe(200)
    expect((await anonymous('/healthz')).status).toBe(200)
    expect((await anonymous('/healthz')).status).toBe(200)
  })

  it('charges websocket upgrades to the account', async () => {
    await start({ rateLimit: { perSecond: SLOW, burst: 2 } })
    const docId = await docIdOf('welcome.md')

    expect((await upgrade(docId)).status).toBe(101)
    expect(await upgrade(docId)).toMatchObject({ status: 429, retryAfter: '100' })
  })

  it('charges refused websocket upgrades without the token to their own bucket', async () => {
    await start({ rateLimit: { perSecond: SLOW, burst: 2 } })
    const docId = await docIdOf('welcome.md')

    expect((await upgrade(docId, { headers: {} })).status).toBe(401)
    expect((await upgrade('unknown-doc', { headers: {} })).status).toBe(404)
    expect(await upgrade(docId, { headers: {} })).toMatchObject({ status: 429, retryAfter: '100' })
    expect((await upgrade(docId)).status).toBe(101)
  })

  it('charges a refused websocket upgrade with the token to the account', async () => {
    await start({ rateLimit: { perSecond: SLOW, burst: 2 } })

    expect((await upgrade('unknown-doc')).status).toBe(404)
    expect(await upgrade(await docIdOf('welcome.md'))).toMatchObject({ status: 429, retryAfter: '100' })
  })
})

describe('the websocket limits', () => {
  it('refuses a websocket beyond the limit of one document, until one closes', async () => {
    await start({ collab: { limits: { perDoc: 1 } } })
    const docId = await docIdOf('welcome.md')
    const first = await upgrade(docId)

    expect(first.status).toBe(101)
    expect(await upgrade(docId)).toMatchObject({ status: 429, retryAfter: undefined })
    first.socket.close()
    await closeCode(first.socket)
    await expect.poll(async () => (await upgrade(docId)).status).toBe(101)
  })

  it('refuses a websocket beyond the limit of the account, over every document', async () => {
    await start({ collab: { limits: { perAccount: 2 } } })
    const [welcome, alpha] = [await docIdOf('welcome.md'), await docIdOf('projects/alpha.md')]

    expect((await upgrade(welcome)).status).toBe(101)
    expect((await upgrade(alpha)).status).toBe(101)
    expect((await upgrade(alpha)).status).toBe(429)
  })

  it('closes a websocket with 4408 that answers no ping, and keeps one that does', async () => {
    await start({ collab: { limits: { idleTimeoutMs: 150 } } })
    const docId = await docIdOf('welcome.md')
    const silent = (await upgrade(docId, { autoPong: false })).socket
    const alive = (await upgrade(docId)).socket
    let aliveClosed = false
    alive.on('close', () => {
      aliveClosed = true
    })

    expect(await closeCode(silent)).toBe(COLLAB_CLOSE.idle)
    await new Promise((resolve) => setTimeout(resolve, 450))
    expect(aliveClosed).toBe(false)
  })

  it('closes a websocket with 1009 that sends more than the configured message limit', async () => {
    await start({ collab: { maxMessageBytes: 1024 } })
    const { socket } = await upgrade(await docIdOf('welcome.md'))
    const closed = closeCode(socket)

    socket.send(new Uint8Array(1025))

    expect(await closed).toBe(1009)
  })
})
