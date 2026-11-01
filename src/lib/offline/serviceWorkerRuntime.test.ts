import { describe, expect, it, vi } from 'vitest'
import {
  accountCacheName,
  accountKeyFor,
  CACHE_LOADED_URLS_MESSAGE,
  CLEAR_OFFLINE_DATA_MESSAGE,
  shellCacheName,
} from './offlineCachePolicy'
import { installOfflineServiceWorker, reportedShellUrls, type OfflineServiceWorkerScope } from './serviceWorkerRuntime'
import { FakeCache, FakeCacheStorage } from './fakeCacheStorage.testUtils'

const ORIGIN = 'https://memoria.test'
const VERSION = 'build-1'
const NOTE_URL = `${ORIGIN}/v1/files/notes/a.md`

type Listener = (event: unknown) => void
type FetchHandler = (request: Request) => Promise<Response>

const networkDown: FetchHandler = async () => {
  throw new TypeError('Failed to fetch')
}

function requestOf(input: Request | string): Request {
  return typeof input === 'string' ? new Request(input) : input
}

function createWorker(precacheUrls: string[] = []) {
  const caches = new FakeCacheStorage()
  const listeners = new Map<string, Listener>()
  let network: FetchHandler = async (request) => new Response(`network:${new URL(request.url).pathname}`)
  const fetch = vi.fn((input: Request | string) => network(requestOf(input)))
  const scope = {
    caches: caches.asCacheStorage(),
    crypto: globalThis.crypto,
    location: { origin: ORIGIN },
    clients: { claim: vi.fn(async () => {}) },
    fetch,
    skipWaiting: vi.fn(async () => {}),
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
  } as unknown as OfflineServiceWorkerScope
  installOfflineServiceWorker(scope, { version: VERSION, precacheUrls })

  async function lifecycle(type: 'install' | 'activate' | 'message', data?: unknown): Promise<void> {
    const waits: Promise<unknown>[] = []
    listeners.get(type)?.({ data, waitUntil: (promise: Promise<unknown>) => waits.push(promise) })
    await Promise.all(waits)
  }

  async function request(input: Request): Promise<Response | null> {
    const waits: Promise<unknown>[] = []
    let responded: Promise<Response> | null = null
    listeners.get('fetch')?.({
      request: input,
      respondWith: (response: Promise<Response>) => { responded = response },
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    })
    const response = responded ? await responded : null
    await Promise.all(waits)
    return response
  }

  return {
    caches,
    fetch,
    scope,
    lifecycle,
    request,
    setNetwork: (handler: FetchHandler) => { network = handler },
  }
}

function asAccount(url: string, token: string): Request {
  return new Request(url, { headers: { authorization: `Bearer ${token}` } })
}

function navigation(url: string): Request {
  return { method: 'GET', url, mode: 'navigate', headers: new Headers() } as Request
}

async function accountCacheFor(worker: ReturnType<typeof createWorker>, request: Request) {
  const key = await accountKeyFor(globalThis.crypto.subtle, request)
  return worker.caches.stores.get(accountCacheName(key ?? ''))
}

describe('install and activate', () => {
  it('precaches the shell without cookies and takes over', async () => {
    const worker = createWorker(['/assets/main.js'])
    await worker.lifecycle('install')

    const shell = worker.caches.stores.get(shellCacheName(VERSION))
    expect([...(shell?.entries.keys() ?? [])]).toEqual([`${ORIGIN}/`, `${ORIGIN}/assets/main.js`])
    expect(worker.fetch.mock.calls.every(([input]) => requestOf(input).credentials === 'omit')).toBe(true)
    expect(worker.scope.skipWaiting).toHaveBeenCalled()
  })

  it('keeps installing when a precached file is missing', async () => {
    const worker = createWorker(['/assets/gone.js'])
    worker.setNetwork(async (request) => request.url.endsWith('gone.js') ? new Response('', { status: 404 }) : new Response('shell'))
    await worker.lifecycle('install')
    expect([...(worker.caches.stores.get(shellCacheName(VERSION))?.entries.keys() ?? [])]).toEqual([`${ORIGIN}/`])
  })

  it('drops the shell of older builds, but no account data', async () => {
    const worker = createWorker()
    await worker.caches.open(shellCacheName('build-0'))
    await worker.caches.open(accountCacheName('alice'))
    await worker.lifecycle('activate')
    expect(await worker.caches.keys()).toEqual([accountCacheName('alice')])
    expect(worker.scope.clients.claim).toHaveBeenCalled()
  })
})

describe('shell', () => {
  it('opens the cached shell for any page, and fetches it only without one', async () => {
    const worker = createWorker()
    expect(await (await worker.request(navigation(`${ORIGIN}/`)))?.text()).toBe('network:/')

    await worker.lifecycle('install')
    worker.setNetwork(networkDown)
    expect(await (await worker.request(navigation(`${ORIGIN}/index.html`)))?.text()).toBe('network:/')
    expect(await (await worker.request(navigation(`${ORIGIN}/other`)))?.text()).toBe('network:/')
  })

  it('fails a page offline when no shell was ever cached', async () => {
    const worker = createWorker()
    worker.setNetwork(networkDown)
    await expect(worker.request(navigation(`${ORIGIN}/`))).rejects.toThrow('Failed to fetch')
  })

  it('caches built files on first use and serves them from then on', async () => {
    const worker = createWorker()
    const asset = new Request(`${ORIGIN}/assets/app.js`)
    expect(await (await worker.request(asset))?.text()).toBe('network:/assets/app.js')
    worker.setNetwork(networkDown)
    expect(await (await worker.request(new Request(asset.url)))?.text()).toBe('network:/assets/app.js')
  })

  it('serves a precached file to a module script, whose request carries Origin', async () => {
    const worker = createWorker(['/assets/main.js'])
    worker.setNetwork(async () => new Response('main', { headers: { vary: 'Origin' } }))
    await worker.lifecycle('install')
    worker.setNetwork(networkDown)
    const moduleScript = new Request(`${ORIGIN}/assets/main.js`, { headers: { origin: ORIGIN } })
    expect(await (await worker.request(moduleScript))?.text()).toBe('main')
  })

  it('would miss that file with a strict match, which is why the worker ignores Vary', async () => {
    const cache = new FakeCache()
    const url = `${ORIGIN}/assets/main.js`
    await cache.put(new Request(url), new Response('main', { headers: { vary: 'Origin' } }))
    const moduleScript = new Request(url, { headers: { origin: ORIGIN } })
    expect(await cache.match(moduleScript)).toBeUndefined()
    expect(await cache.match(new Request(url))).toBeDefined()
    expect(await cache.match(moduleScript, { ignoreVary: true })).toBeDefined()
  })

  it('caches the files the page loaded before the worker started, and nothing else', async () => {
    const worker = createWorker()
    await worker.lifecycle('message', {
      type: CACHE_LOADED_URLS_MESSAGE,
      urls: [`${ORIGIN}/assets/early.js`, `${ORIGIN}/v1/entries`, 'https://cdn.test/assets/x.js', 42],
    })
    const shell = worker.caches.stores.get(shellCacheName(VERSION))
    expect([...(shell?.entries.keys() ?? [])]).toEqual([`${ORIGIN}/assets/early.js`])
  })

  it('does not touch writes or other API calls', async () => {
    const worker = createWorker()
    const write = new Request(NOTE_URL, { method: 'PUT', body: 'x', headers: { authorization: 'Bearer alice' } })
    expect(await worker.request(write)).toBeNull()
    expect(await worker.request(asAccount(`${ORIGIN}/v1/search`, 'alice'))).toBeNull()
    expect(worker.fetch).not.toHaveBeenCalled()
  })
})

describe('account data', () => {
  it('serves the last copy offline to the account that loaded it, never to another', async () => {
    const worker = createWorker()
    await worker.request(asAccount(NOTE_URL, 'alice'))
    worker.setNetwork(networkDown)

    expect(await (await worker.request(asAccount(NOTE_URL, 'alice')))?.text()).toBe('network:/v1/files/notes/a.md')
    await expect(worker.request(asAccount(NOTE_URL, 'bob'))).rejects.toThrow('Failed to fetch')
  })

  it('fails offline for a note that was never opened', async () => {
    const worker = createWorker()
    worker.setNetwork(networkDown)
    await expect(worker.request(asAccount(`${ORIGIN}/v1/files/never.md`, 'alice'))).rejects.toThrow('Failed to fetch')
  })

  it('never stores the credential with the response', async () => {
    const worker = createWorker()
    const request = asAccount(NOTE_URL, 'alice')
    await worker.request(request)
    const cache = await accountCacheFor(worker, request)
    expect([...(cache?.entries.keys() ?? [])]).toEqual([NOTE_URL])
  })

  it('forgets an account the server no longer accepts', async () => {
    const worker = createWorker()
    const request = asAccount(NOTE_URL, 'alice')
    await worker.request(request)
    worker.setNetwork(async () => new Response('', { status: 401 }))
    expect((await worker.request(asAccount(NOTE_URL, 'alice')))?.status).toBe(401)
    expect(await accountCacheFor(worker, request)).toBeUndefined()
  })

  it('keeps an error response out of the cache', async () => {
    const worker = createWorker()
    worker.setNetwork(async () => new Response('', { status: 500 }))
    const request = asAccount(NOTE_URL, 'alice')
    await worker.request(request)
    expect(await accountCacheFor(worker, request)).toBeUndefined()
  })
})

describe('clearing', () => {
  it('deletes the shell and every account cache on request', async () => {
    const worker = createWorker()
    await worker.lifecycle('install')
    await worker.request(asAccount(NOTE_URL, 'alice'))
    await worker.request(asAccount(NOTE_URL, 'bob'))
    await worker.caches.open('another-app')

    await worker.lifecycle('message', { type: CLEAR_OFFLINE_DATA_MESSAGE })

    expect(await worker.caches.keys()).toEqual(['another-app'])
    worker.setNetwork(networkDown)
    await expect(worker.request(asAccount(NOTE_URL, 'alice'))).rejects.toThrow('Failed to fetch')
  })

  it('ignores unknown messages', async () => {
    const worker = createWorker()
    await worker.lifecycle('install')
    await worker.lifecycle('message', 'hello')
    await worker.lifecycle('message', { type: 'other' })
    expect(await worker.caches.keys()).toEqual([shellCacheName(VERSION)])
  })
})

describe('reportedShellUrls', () => {
  it('accepts only a list of same-origin shell files', () => {
    expect(reportedShellUrls('nope', ORIGIN)).toEqual([])
    expect(reportedShellUrls([`${ORIGIN}/assets/a.js`, 'not a url', `${ORIGIN}/v1/entries`], ORIGIN)).toEqual([`${ORIGIN}/assets/a.js`])
  })
})
