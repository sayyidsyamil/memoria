import {
  accountCacheName,
  CLEAR_OFFLINE_DATA_MESSAGE,
  accountKeyFor,
  CACHE_LOADED_URLS_MESSAGE,
  deleteMemoriaCaches,
  isStaleShellCacheName,
  MAX_CACHED_ACCOUNT_RESPONSES,
  routeOfflineRequest,
  shellCacheName,
  trimCache,
} from './offlineCachePolicy'

/**
 * The Memoria web service worker (TOL-198), written against a minimal scope interface so it
 * runs unchanged in the browser and in unit tests. Hand-written on purpose: no Workbox.
 *
 * - Shell: navigations are network-first with the cached shell as the offline fallback;
 *   other same-origin files are cache-first (built assets are content-hashed).
 * - Vault data: the entries list and note files are network-first and fall back, offline,
 *   to the cache of the account that sent the request. Nothing else under `/v1` or `/api`
 *   is cached, and no write is ever intercepted, so nothing can be queued here.
 */

const SHELL_FALLBACK_URL = '/'
const MAX_REPORTED_URLS = 500
/**
 * Servers answer with `Vary: Origin`, and a module script sends `Origin` while the precache
 * did not, so a strict match would miss every file. Shell files are content-addressed and
 * account caches are already one per credential, so the stored copy is the right one.
 */
const MATCH_OPTIONS: CacheQueryOptions = { ignoreVary: true }

interface WaitUntilEvent {
  waitUntil(promise: Promise<unknown>): void
}

interface OfflineFetchEvent extends WaitUntilEvent {
  readonly request: Request
  respondWith(response: Promise<Response>): void
}

interface OfflineMessageEvent extends WaitUntilEvent {
  readonly data: unknown
}

export interface OfflineServiceWorkerScope {
  readonly caches: CacheStorage
  readonly crypto: Crypto
  readonly location: { readonly origin: string }
  readonly clients: { claim(): Promise<void> }
  fetch(request: Request | string): Promise<Response>
  skipWaiting(): Promise<void>
  addEventListener(type: 'install' | 'activate', listener: (event: WaitUntilEvent) => void): void
  addEventListener(type: 'fetch', listener: (event: OfflineFetchEvent) => void): void
  addEventListener(type: 'message', listener: (event: OfflineMessageEvent) => void): void
}

export interface OfflineServiceWorkerOptions {
  /** Changes with every build, so a deploy replaces the cached shell. */
  version: string
  /** Same-origin URLs the first paint needs, cached on install. */
  precacheUrls: readonly string[]
}

function isCacheableShellResponse(response: Response): boolean {
  return response.ok && (response.type === 'basic' || response.type === 'default')
}

/** One cached copy per page, whatever its query: `/?note=a`, `/index.html` and `/` share the shell. */
function navigationCacheKey(request: Request): string {
  const { pathname } = new URL(request.url)
  return pathname === '/index.html' ? SHELL_FALLBACK_URL : pathname
}

/** The versioned shell cache, opened once per worker instead of once per request. */
interface ShellStore {
  open(): Promise<Cache>
  forget(): void
}

function createShellStore(scope: OfflineServiceWorkerScope, version: string): ShellStore {
  let opened: Promise<Cache> | null = null
  return {
    open: () => {
      opened ??= scope.caches.open(shellCacheName(version))
      return opened
    },
    forget: () => {
      opened = null
    },
  }
}

async function cacheShellUrls(scope: OfflineServiceWorkerScope, shell: ShellStore, urls: readonly string[]): Promise<void> {
  const cache = await shell.open()
  await Promise.all(urls.map(async (url) => {
    try {
      if (await cache.match(url, MATCH_OPTIONS)) return
      // The shell is the public bundle: fetched without cookies, so nothing personal lands here.
      const request = new Request(new URL(url, scope.location.origin), { credentials: 'omit' })
      const response = await scope.fetch(request)
      if (isCacheableShellResponse(response)) await cache.put(url, response)
    } catch {
      // A missing file must not fail the install; it is cached on first use instead.
    }
  }))
}

/** Keeps only same-origin shell files: never an API response, never another origin. */
export function reportedShellUrls(urls: unknown, scopeOrigin: string): string[] {
  if (!Array.isArray(urls)) return []
  return urls
    .filter((url): url is string => typeof url === 'string')
    .slice(0, MAX_REPORTED_URLS)
    .filter((url) => {
      try {
        return routeOfflineRequest(new Request(url), scopeOrigin) === 'shell-asset'
      } catch {
        return false
      }
    })
}

async function dropStaleShells(scope: OfflineServiceWorkerScope, version: string): Promise<void> {
  const names = await scope.caches.keys()
  await Promise.all(names.filter((name) => isStaleShellCacheName(name, version)).map((name) => scope.caches.delete(name)))
}

/** Cache-first: the shell opens instantly, and a new build arrives with the next worker. */
async function respondWithNavigation(scope: OfflineServiceWorkerScope, shell: ShellStore, request: Request): Promise<Response> {
  const cache = await shell.open()
  const cached = await cache.match(navigationCacheKey(request), MATCH_OPTIONS)
  if (cached) return cached
  try {
    return await scope.fetch(request)
  } catch (error) {
    const fallback = await cache.match(SHELL_FALLBACK_URL, MATCH_OPTIONS)
    if (fallback) return fallback
    throw error
  }
}

/** Cache-first: built files are content-hashed, so a cached copy never goes stale. */
async function respondWithShellAsset(scope: OfflineServiceWorkerScope, shell: ShellStore, event: OfflineFetchEvent): Promise<Response> {
  const cache = await shell.open()
  const cached = await cache.match(event.request, MATCH_OPTIONS)
  if (cached) return cached
  const response = await scope.fetch(event.request)
  if (isCacheableShellResponse(response)) event.waitUntil(cache.put(event.request, response.clone()))
  return response
}

async function storeAccountResponse(scope: OfflineServiceWorkerScope, cacheName: string, url: string, response: Response): Promise<void> {
  const cache = await scope.caches.open(cacheName)
  // Re-inserting moves the note to the most recent end, so trimming drops the oldest ones.
  // The key is the bare URL: the bearer credential is never written to the cache.
  await cache.delete(url)
  await cache.put(url, response)
  await trimCache(cache, MAX_CACHED_ACCOUNT_RESPONSES)
}

async function readAccountResponse(scope: OfflineServiceWorkerScope, cacheName: string, url: string): Promise<Response | undefined> {
  if (!(await scope.caches.has(cacheName))) return undefined
  const cache = await scope.caches.open(cacheName)
  return cache.match(url, MATCH_OPTIONS)
}

function isRevokedAccountResponse(response: Response): boolean {
  return response.status === 401 || response.status === 403
}

async function respondWithAccountData(scope: OfflineServiceWorkerScope, event: OfflineFetchEvent): Promise<Response> {
  const { request } = event
  const accountKey = await accountKeyFor(scope.crypto.subtle, request)
  if (!accountKey) return scope.fetch(request)
  const cacheName = accountCacheName(accountKey)
  try {
    const response = await scope.fetch(request)
    if (response.ok) event.waitUntil(storeAccountResponse(scope, cacheName, request.url, response.clone()))
    else if (isRevokedAccountResponse(response)) event.waitUntil(scope.caches.delete(cacheName))
    return response
  } catch (error) {
    const cached = await readAccountResponse(scope, cacheName, request.url)
    if (cached) return cached
    throw error
  }
}

function respondTo(scope: OfflineServiceWorkerScope, shell: ShellStore, event: OfflineFetchEvent): Promise<Response> | null {
  switch (routeOfflineRequest(event.request, scope.location.origin)) {
    case 'navigation': return respondWithNavigation(scope, shell, event.request)
    case 'shell-asset': return respondWithShellAsset(scope, shell, event)
    case 'account-data': return respondWithAccountData(scope, event)
    default: return null
  }
}

function messageType(data: unknown): unknown {
  return typeof data === 'object' && data !== null ? Reflect.get(data, 'type') : undefined
}

function handleMessage(scope: OfflineServiceWorkerScope, shell: ShellStore, event: OfflineMessageEvent): void {
  const type = messageType(event.data)
  if (type === CLEAR_OFFLINE_DATA_MESSAGE) {
    shell.forget()
    event.waitUntil(deleteMemoriaCaches(scope.caches))
  }
  if (type === CACHE_LOADED_URLS_MESSAGE) {
    const urls = reportedShellUrls(Reflect.get(event.data as object, 'urls'), scope.location.origin)
    event.waitUntil(cacheShellUrls(scope, shell, urls))
  }
}

export function installOfflineServiceWorker(scope: OfflineServiceWorkerScope, options: OfflineServiceWorkerOptions): void {
  const shell = createShellStore(scope, options.version)
  scope.addEventListener('install', (event) => {
    const urls = [SHELL_FALLBACK_URL, ...options.precacheUrls]
    event.waitUntil(cacheShellUrls(scope, shell, urls).then(() => scope.skipWaiting()))
  })
  scope.addEventListener('activate', (event) => {
    event.waitUntil(dropStaleShells(scope, options.version).then(() => scope.clients.claim()))
  })
  scope.addEventListener('fetch', (event) => {
    const response = respondTo(scope, shell, event)
    if (response) event.respondWith(response)
  })
  scope.addEventListener('message', (event) => handleMessage(scope, shell, event))
}
