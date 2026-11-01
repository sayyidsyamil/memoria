import {
  installOfflineServiceWorker,
  type OfflineServiceWorkerScope,
} from '../../../src/lib/offline/serviceWorkerRuntime'

// Entry of `service-worker.js`, bundled by serviceWorkerPlugin.ts for the web build only.
declare const __MEMORIA_SW_VERSION__: string
declare const __MEMORIA_SW_PRECACHE__: readonly string[]

installOfflineServiceWorker(self as unknown as OfflineServiceWorkerScope, {
  version: __MEMORIA_SW_VERSION__,
  precacheUrls: __MEMORIA_SW_PRECACHE__,
})
