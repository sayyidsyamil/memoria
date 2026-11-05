import { clearCache as clearEntriesSnapshot } from '../../../packages/collab-client/src/entriesCache'
import { resolveBrowserBackendKind, resolvePlatformCapabilities } from '../platformCapabilities'
import { assertSharedVaultWritable } from '../sharing/vaultAccess'
import { CACHE_LOADED_URLS_MESSAGE, CLEAR_OFFLINE_DATA_MESSAGE, deleteMemoriaCaches } from './offlineCachePolicy'

/**
 * Page side of offline read on the web (TOL-198): when the service worker registers, the
 * read-only gate while the network is gone, and wiping offline data when the account leaves.
 * Everything here is inert on desktop: the `offlineRead` capability is only set for the
 * remote (web) backend, and registration also requires the web build.
 */

export const OFFLINE_SERVICE_WORKER_URL = '/service-worker.js'
/** Dispatch on `window` when the user signs out: every offline copy of the vault is deleted. */
export const ACCOUNT_SIGNED_OUT_EVENT = 'memoria:account-signed-out'
/** Dispatch on `window` when the account is deleted (TOL-199): nothing may stay behind. */
export const ACCOUNT_DELETED_EVENT = 'memoria:account-deleted'
const REGISTRATION_DELAY_MS = 2000

export class OfflineReadOnlyError extends Error {
  constructor(action: string) {
    super(`You are offline, so ${action} is blocked until you reconnect`)
    this.name = 'OfflineReadOnlyError'
  }
}

/** True on the web build talking to a Memoria server; false on desktop and on demo data. */
export function hasOfflineRead(): boolean {
  return resolvePlatformCapabilities(resolveBrowserBackendKind()).offlineRead
}

/** The vault is read-only: web, and the browser reports no network. */
export function isOfflineReadOnly(): boolean {
  return hasOfflineRead() && typeof navigator !== 'undefined' && navigator.onLine === false
}

/**
 * Refuses a vault write while offline instead of keeping it somewhere to send later, and in a
 * vault shared with the user to view only (TOL-237).
 */
export function assertVaultWritable(action: string): void {
  if (isOfflineReadOnly()) throw new OfflineReadOnlyError(action)
  assertSharedVaultWritable(action)
}

export interface OfflineRegistrationEnvironment {
  /** Only the web build emits the service worker file. */
  isWebBuild: boolean
  isTauri: boolean
  window: Window
}

export function shouldRegisterOfflineServiceWorker({ isWebBuild, isTauri, window: win }: OfflineRegistrationEnvironment): boolean {
  if (!isWebBuild || isTauri || !hasOfflineRead()) return false
  return win.isSecureContext && 'serviceWorker' in win.navigator
}

function afterStartup(win: Window, task: () => void): void {
  // The list paints first: registration and the shell precache wait for load, then idle time.
  const schedule = () => {
    if (typeof win.requestIdleCallback === 'function') win.requestIdleCallback(task, { timeout: REGISTRATION_DELAY_MS })
    else win.setTimeout(task, REGISTRATION_DELAY_MS)
  }
  if (win.document.readyState === 'complete') schedule()
  else win.addEventListener('load', schedule, { once: true })
}

function loadedSameOriginUrls(win: Window): string[] {
  const origin = win.location.origin
  const urls = win.performance.getEntriesByType('resource').map((entry) => entry.name)
  return urls.filter((url) => url.startsWith(`${origin}/`))
}

async function registerOfflineServiceWorker(win: Window): Promise<void> {
  const { serviceWorker } = win.navigator
  await serviceWorker.register(OFFLINE_SERVICE_WORKER_URL, { scope: '/' })
  const registration = await serviceWorker.ready
  // Files this page loaded before the worker existed, so the next offline start has them.
  registration.active?.postMessage({ type: CACHE_LOADED_URLS_MESSAGE, urls: loadedSameOriginUrls(win) })
}

/** Registers the service worker once startup is done. Returns whether it was scheduled. */
export function scheduleOfflineServiceWorkerRegistration(env: OfflineRegistrationEnvironment): boolean {
  if (!shouldRegisterOfflineServiceWorker(env)) return false
  afterStartup(env.window, () => {
    registerOfflineServiceWorker(env.window).catch((error: unknown) => {
      console.warn('[offline] Service worker registration failed:', error)
    })
  })
  return true
}

/** Deletes the cached shell, every account's cached notes and entries, and the entries snapshot. */
export async function clearOfflineData(win: Window = window): Promise<void> {
  win.navigator.serviceWorker?.controller?.postMessage({ type: CLEAR_OFFLINE_DATA_MESSAGE })
  const pending: Promise<void>[] = [clearEntriesSnapshot()]
  if (win.caches) pending.push(deleteMemoriaCaches(win.caches))
  await Promise.all(pending)
}

/** Clears offline data whenever the account signs out or is deleted. Returns the unsubscribe. */
export function clearOfflineDataOnAccountExit(win: Window = window): () => void {
  const clear = () => {
    clearOfflineData(win).catch((error: unknown) => {
      console.warn('[offline] Clearing offline data failed:', error)
    })
  }
  win.addEventListener(ACCOUNT_SIGNED_OUT_EVENT, clear)
  win.addEventListener(ACCOUNT_DELETED_EVENT, clear)
  return () => {
    win.removeEventListener(ACCOUNT_SIGNED_OUT_EVENT, clear)
    win.removeEventListener(ACCOUNT_DELETED_EVENT, clear)
  }
}
