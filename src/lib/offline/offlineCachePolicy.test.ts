import { describe, expect, it } from 'vitest'
import {
  accountCacheName,
  accountKeyFor,
  deleteMemoriaCaches,
  isStaleShellCacheName,
  isMemoriaCacheName,
  routeOfflineRequest,
  shellCacheName,
  trimCache,
} from './offlineCachePolicy'
import { FakeCacheStorage } from './fakeCacheStorage.testUtils'

const ORIGIN = 'https://memoria.test'
const SERVER = 'https://server.test'

function get(url: string, init: RequestInit = {}): Request {
  return new Request(url, init)
}

function authorized(url: string, token = 'alice'): Request {
  return get(url, { headers: { authorization: `Bearer ${token}` } })
}

describe('routeOfflineRequest', () => {
  it.each([
    ['the entries list', authorized(`${SERVER}/v1/entries`)],
    ['a note file', authorized(`${SERVER}/v1/files/notes/a.md`)],
  ])('caches %s per account', (_label, request) => {
    expect(routeOfflineRequest(request, ORIGIN)).toBe('account-data')
  })

  it.each([
    ['a write', new Request(`${SERVER}/v1/files/a.md`, { method: 'PUT', headers: { authorization: 'Bearer alice' } })],
    ['a request without credentials', get(`${SERVER}/v1/entries`)],
    ['a query', authorized(`${SERVER}/v1/entries?since=abc`)],
    ['another API route', authorized(`${SERVER}/v1/search`)],
    ['the dev vault API', authorized(`${ORIGIN}/api/vault/ping`)],
    ['another origin', get('https://cdn.test/assets/app.js')],
    ['an unknown same-origin path', get(`${ORIGIN}/healthz`)],
  ])('leaves %s alone', (_label, request) => {
    expect(routeOfflineRequest(request, ORIGIN)).toBe('bypass')
  })

  it('serves built files and root files from the shell', () => {
    expect(routeOfflineRequest(get(`${ORIGIN}/assets/main-abc.js`), ORIGIN)).toBe('shell-asset')
    expect(routeOfflineRequest(get(`${ORIGIN}/manifest.json`), ORIGIN)).toBe('shell-asset')
  })

  it('treats page loads as navigations', () => {
    const navigation = { method: 'GET', url: `${ORIGIN}/?note=a`, mode: 'navigate', headers: new Headers() } as Request
    expect(routeOfflineRequest(navigation, ORIGIN)).toBe('navigation')
  })
})

describe('cache names', () => {
  it('tells the shell versions and the app caches apart', () => {
    expect(isMemoriaCacheName(shellCacheName('v1'))).toBe(true)
    expect(isMemoriaCacheName(accountCacheName('abc'))).toBe(true)
    expect(isMemoriaCacheName('someone-else')).toBe(false)
    expect(isStaleShellCacheName(shellCacheName('v1'), 'v2')).toBe(true)
    expect(isStaleShellCacheName(shellCacheName('v2'), 'v2')).toBe(false)
    expect(isStaleShellCacheName(accountCacheName('abc'), 'v2')).toBe(false)
  })
})

describe('accountKeyFor', () => {
  it('gives each credential and server its own key', async () => {
    const subtle = globalThis.crypto.subtle
    const alice = await accountKeyFor(subtle, authorized(`${SERVER}/v1/entries`, 'alice'))
    const aliceAgain = await accountKeyFor(subtle, authorized(`${SERVER}/v1/files/a.md`, 'alice'))
    const bob = await accountKeyFor(subtle, authorized(`${SERVER}/v1/entries`, 'bob'))
    const aliceElsewhere = await accountKeyFor(subtle, authorized('https://other.test/v1/entries', 'alice'))

    expect(alice).toMatch(/^[0-9a-f]{32}$/)
    expect(aliceAgain).toBe(alice)
    expect(bob).not.toBe(alice)
    expect(aliceElsewhere).not.toBe(alice)
    expect(alice).not.toContain('alice')
  })

  it('has no key without a credential', async () => {
    expect(await accountKeyFor(globalThis.crypto.subtle, get(`${SERVER}/v1/entries`))).toBeNull()
  })
})

describe('cache maintenance', () => {
  it('drops the oldest responses beyond the limit', async () => {
    const storage = new FakeCacheStorage()
    const cache = await storage.open('c')
    for (const name of ['a', 'b', 'c']) await cache.put(`${SERVER}/v1/files/${name}.md`, new Response(name))
    await trimCache(cache as unknown as Cache, 2)
    expect([...cache.entries.keys()]).toEqual([`${SERVER}/v1/files/b.md`, `${SERVER}/v1/files/c.md`])
  })

  it('deletes only the caches this app created', async () => {
    const storage = new FakeCacheStorage()
    await storage.open(shellCacheName('v1'))
    await storage.open(accountCacheName('alice'))
    await storage.open('another-app')
    await deleteMemoriaCaches(storage.asCacheStorage())
    expect(await storage.keys()).toEqual(['another-app'])
  })
})
