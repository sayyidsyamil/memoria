import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCache as clearEntriesSnapshot } from '../../../packages/collab-client/src/entriesCache'
import { accountCacheName, CACHE_LOADED_URLS_MESSAGE, CLEAR_OFFLINE_DATA_MESSAGE, shellCacheName } from './offlineCachePolicy'
import {
  ACCOUNT_DELETED_EVENT,
  ACCOUNT_SIGNED_OUT_EVENT,
  assertVaultWritable,
  clearOfflineData,
  clearOfflineDataOnAccountExit,
  hasOfflineRead,
  isOfflineReadOnly,
  OFFLINE_SERVICE_WORKER_URL,
  OfflineReadOnlyError,
  scheduleOfflineServiceWorkerRegistration,
  shouldRegisterOfflineServiceWorker,
} from './offlineMode'
import { FakeCacheStorage } from './fakeCacheStorage.testUtils'
import { resetVaultAccessForTests, ViewOnlyAccessError } from '../sharing/vaultAccess'

vi.mock('../../../packages/collab-client/src/entriesCache', () => ({ clearCache: vi.fn(async () => {}) }))

type RemoteWindow = Window & { MEMORIA_REMOTE_URL?: string; MEMORIA_REMOTE_TOKEN?: string }

function useRemoteServer(): void {
  const remote = window as RemoteWindow
  remote.MEMORIA_REMOTE_URL = 'https://server.test'
  remote.MEMORIA_REMOTE_TOKEN = 'token'
}

function setOnline(onLine: boolean): void {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(onLine)
}

interface FakeWindowOptions {
  secure?: boolean
  serviceWorker?: boolean
  readyState?: DocumentReadyState
  idle?: boolean
}

function createFakeWindow({ secure = true, serviceWorker = true, readyState = 'complete', idle = true }: FakeWindowOptions = {}) {
  const caches = new FakeCacheStorage()
  const postToActive = vi.fn()
  const postToController = vi.fn()
  const listeners = new EventTarget()
  const container = {
    register: vi.fn(async () => ({})),
    ready: Promise.resolve({ active: { postMessage: postToActive } }),
    controller: { postMessage: postToController },
  }
  const win = {
    isSecureContext: secure,
    navigator: serviceWorker ? { serviceWorker: container } : {},
    document: { readyState },
    location: { origin: 'https://memoria.test' },
    performance: {
      getEntriesByType: () => [{ name: 'https://memoria.test/assets/main.js' }, { name: 'https://cdn.test/font.woff2' }],
    },
    caches: caches.asCacheStorage(),
    requestIdleCallback: idle ? (task: () => void) => { task(); return 1 } : undefined,
    setTimeout: (task: () => void) => { task(); return 1 },
    addEventListener: listeners.addEventListener.bind(listeners),
    removeEventListener: listeners.removeEventListener.bind(listeners),
    dispatchEvent: listeners.dispatchEvent.bind(listeners),
  }
  return { win: win as unknown as Window, caches, container, postToActive, postToController }
}

/** Lets pending promise chains run: a timer fires only after every queued microtask. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  vi.mocked(clearEntriesSnapshot).mockClear()
})

afterEach(() => {
  const remote = window as RemoteWindow
  delete remote.MEMORIA_REMOTE_URL
  delete remote.MEMORIA_REMOTE_TOKEN
  vi.restoreAllMocks()
})

describe('offline read-only gate', () => {
  it('stays off on desktop and on demo data, even offline', () => {
    setOnline(false)
    expect(hasOfflineRead()).toBe(false)
    expect(isOfflineReadOnly()).toBe(false)
    expect(() => assertVaultWritable('saving')).not.toThrow()
  })

  it('blocks vault writes on the web while offline', () => {
    useRemoteServer()
    setOnline(false)
    expect(isOfflineReadOnly()).toBe(true)
    expect(() => assertVaultWritable('saving changes')).toThrow(OfflineReadOnlyError)
  })

  it('lets writes through on the web while online', () => {
    useRemoteServer()
    setOnline(true)
    expect(hasOfflineRead()).toBe(true)
    expect(() => assertVaultWritable('saving changes')).not.toThrow()
  })

  it('blocks vault writes in a vault shared with the user to view (TOL-237)', () => {
    useRemoteServer()
    setOnline(true)
    resetVaultAccessForTests({ kind: 'shared', access: { subject: 'u_1', grants: [{ scope: '*', role: 'viewer' }] } })
    expect(() => assertVaultWritable('creating a note')).toThrow(ViewOnlyAccessError)

    resetVaultAccessForTests({ kind: 'shared', access: { subject: 'u_1', grants: [{ scope: 'a.md', role: 'editor' }] } })
    expect(() => assertVaultWritable('editing properties')).not.toThrow()
    resetVaultAccessForTests()
  })
})

describe('service worker registration', () => {
  it.each([
    ['outside the web build', { isWebBuild: false, isTauri: false }, {}],
    ['in Tauri', { isWebBuild: true, isTauri: true }, {}],
    ['without a secure context', { isWebBuild: true, isTauri: false }, { secure: false }],
    ['without service workers', { isWebBuild: true, isTauri: false }, { serviceWorker: false }],
  ])('is skipped %s', (_label, env, windowOptions) => {
    useRemoteServer()
    const { win } = createFakeWindow(windowOptions)
    expect(shouldRegisterOfflineServiceWorker({ ...env, window: win })).toBe(false)
  })

  it('is skipped on demo data, like the desktop browser harness', () => {
    const { win, container } = createFakeWindow()
    expect(scheduleOfflineServiceWorkerRegistration({ isWebBuild: true, isTauri: false, window: win })).toBe(false)
    expect(container.register).not.toHaveBeenCalled()
  })

  it('registers once the page is idle and hands over the files it already loaded', async () => {
    useRemoteServer()
    const { win, container, postToActive } = createFakeWindow()
    expect(scheduleOfflineServiceWorkerRegistration({ isWebBuild: true, isTauri: false, window: win })).toBe(true)
    await settle()
    expect(container.register).toHaveBeenCalledWith(OFFLINE_SERVICE_WORKER_URL, { scope: '/' })
    expect(postToActive).toHaveBeenCalledWith({ type: CACHE_LOADED_URLS_MESSAGE, urls: ['https://memoria.test/assets/main.js'] })
  })

  it('waits for the load event before registering', async () => {
    useRemoteServer()
    const { win, container } = createFakeWindow({ readyState: 'loading', idle: false })
    scheduleOfflineServiceWorkerRegistration({ isWebBuild: true, isTauri: false, window: win })
    await settle()
    expect(container.register).not.toHaveBeenCalled()
    win.dispatchEvent(new Event('load'))
    await settle()
    expect(container.register).toHaveBeenCalled()
  })

  it('reports a failed registration without throwing', async () => {
    useRemoteServer()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { win, container } = createFakeWindow()
    container.register.mockRejectedValueOnce(new Error('denied'))
    scheduleOfflineServiceWorkerRegistration({ isWebBuild: true, isTauri: false, window: win })
    await settle()
    expect(warn).toHaveBeenCalledWith('[offline] Service worker registration failed:', expect.any(Error))
  })
})

describe('clearing offline data', () => {
  async function seededWindow() {
    const fake = createFakeWindow()
    await fake.caches.open(shellCacheName('v1'))
    await fake.caches.open(accountCacheName('alice'))
    await fake.caches.open(accountCacheName('bob'))
    await fake.caches.open('another-app')
    return fake
  }

  it('deletes every cached account, the shell and the entries snapshot', async () => {
    const { win, caches, postToController } = await seededWindow()
    await clearOfflineData(win)
    expect(await caches.keys()).toEqual(['another-app'])
    expect(postToController).toHaveBeenCalledWith({ type: CLEAR_OFFLINE_DATA_MESSAGE })
    expect(clearEntriesSnapshot).toHaveBeenCalled()
  })

  it.each([ACCOUNT_SIGNED_OUT_EVENT, ACCOUNT_DELETED_EVENT])('runs on %s', async (eventName) => {
    const { win, caches } = await seededWindow()
    clearOfflineDataOnAccountExit(win)
    win.dispatchEvent(new Event(eventName))
    await settle()
    expect(await caches.keys()).toEqual(['another-app'])
    expect(clearEntriesSnapshot).toHaveBeenCalled()
  })

  it('stops listening once unsubscribed', async () => {
    const { win, caches } = await seededWindow()
    clearOfflineDataOnAccountExit(win)()
    win.dispatchEvent(new Event(ACCOUNT_SIGNED_OUT_EVENT))
    await settle()
    expect(await caches.keys()).toHaveLength(4)
  })

  it('reports a failed clear without throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(clearEntriesSnapshot).mockRejectedValueOnce(new Error('blocked'))
    const { win } = await seededWindow()
    clearOfflineDataOnAccountExit(win)
    win.dispatchEvent(new Event(ACCOUNT_DELETED_EVENT))
    await settle()
    expect(warn).toHaveBeenCalledWith('[offline] Clearing offline data failed:', expect.any(Error))
  })
})
