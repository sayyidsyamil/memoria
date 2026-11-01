/**
 * Cache naming and request routing for the Memoria web service worker (TOL-198).
 *
 * Shell assets live in one versioned cache shared by every visitor of the origin: they are
 * the public static bundle. Vault data (`/v1/entries`, `/v1/files/*`) lives in one cache per
 * signed-in account, named after a hash of the server origin and the bearer credential, so a
 * response cached for one account can never be served to another.
 */

export const OFFLINE_CACHE_PREFIX = 'memoria-web-'
/** Posted to the service worker to delete every cache it keeps. */
export const CLEAR_OFFLINE_DATA_MESSAGE = 'memoria:clear-offline-data'
/** Posted by the page with the same-origin files it loaded before the worker took over. */
export const CACHE_LOADED_URLS_MESSAGE = 'memoria:cache-loaded-urls'
const SHELL_CACHE_PREFIX = `${OFFLINE_CACHE_PREFIX}shell-`
const ACCOUNT_CACHE_PREFIX = `${OFFLINE_CACHE_PREFIX}account-`
const ENTRIES_PATH = '/v1/entries'
const FILES_PATH_PREFIX = '/v1/files/'
const API_PATH_PREFIXES = ['/v1/', '/api/']
const ACCOUNT_KEY_HEX_LENGTH = 32
const BUILT_ASSETS_PATH_PREFIX = '/assets/'
const ROOT_FILE_PATTERN = /^\/[\w.-]+\.\w+$/

/** Most recently opened notes kept per account, plus the entries list. */
export const MAX_CACHED_ACCOUNT_RESPONSES = 200

export type OfflineRequestRoute = 'navigation' | 'shell-asset' | 'account-data' | 'bypass'

export function shellCacheName(version: string): string {
  return `${SHELL_CACHE_PREFIX}${version}`
}

export function accountCacheName(accountKey: string): string {
  return `${ACCOUNT_CACHE_PREFIX}${accountKey}`
}

export function isMemoriaCacheName(name: string): boolean {
  return name.startsWith(OFFLINE_CACHE_PREFIX)
}

export function isStaleShellCacheName(name: string, currentVersion: string): boolean {
  return name.startsWith(SHELL_CACHE_PREFIX) && name !== shellCacheName(currentVersion)
}

function isApiUrl({ pathname }: URL): boolean {
  return API_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function isOfflineReadablePath(url: URL): boolean {
  if (url.search) return false
  return url.pathname === ENTRIES_PATH || url.pathname.startsWith(FILES_PATH_PREFIX)
}

/** Files of the static bundle: hashed build output, and root files like the manifest and icons. */
function isShellFileUrl({ pathname }: URL): boolean {
  return pathname.startsWith(BUILT_ASSETS_PATH_PREFIX) || ROOT_FILE_PATTERN.test(pathname)
}

function routeApiRequest(request: Request, url: URL): OfflineRequestRoute {
  if (!request.headers.has('authorization')) return 'bypass'
  return isOfflineReadablePath(url) ? 'account-data' : 'bypass'
}

/** Decides how the service worker answers a request; `bypass` means it does not touch it. */
export function routeOfflineRequest(request: Request, scopeOrigin: string): OfflineRequestRoute {
  if (request.method !== 'GET') return 'bypass'
  const url = new URL(request.url)
  if (isApiUrl(url)) return routeApiRequest(request, url)
  if (url.origin !== scopeOrigin) return 'bypass'
  if (request.mode === 'navigate') return 'navigation'
  return isShellFileUrl(url) ? 'shell-asset' : 'bypass'
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** A stable, non-reversible key for the account behind a request's bearer credential. */
export async function accountKeyFor(subtle: SubtleCrypto, request: Request): Promise<string | null> {
  const authorization = request.headers.get('authorization')
  if (!authorization) return null
  const identity = new TextEncoder().encode(`${new URL(request.url).origin}\n${authorization}`)
  const digest = await subtle.digest('SHA-256', identity)
  return toHex(digest).slice(0, ACCOUNT_KEY_HEX_LENGTH)
}

/** Drops the oldest entries so the cache keeps at most `limit` responses. */
export async function trimCache(cache: Cache, limit: number): Promise<void> {
  const keys = await cache.keys()
  const excess = keys.slice(0, Math.max(0, keys.length - limit))
  await Promise.all(excess.map((key) => cache.delete(key)))
}

/** Deletes every cache this app created: the shell and all account caches. */
export async function deleteMemoriaCaches(cacheStorage: CacheStorage): Promise<void> {
  const names = await cacheStorage.keys()
  await Promise.all(names.filter(isMemoriaCacheName).map((name) => cacheStorage.delete(name)))
}
