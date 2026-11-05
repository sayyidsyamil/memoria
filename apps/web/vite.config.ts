import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig, type Plugin, type UserConfig } from 'vite'
import desktopConfig from '../../vite.config'
import { appShellPreload } from './appShellPreload'
import { phosphorStaticIconChunk } from './phosphorIconChunk'
import {
  isApiRequestPath,
  webPreviewAllowedHosts,
  webPreviewHost,
  webPreviewPort,
  webPreviewProxy,
} from './previewOptions'
import { currentCommit, hiddenSourceMaps, webRelease, webSentryDefine } from './sentryWebBuild'
import { memoriaServiceWorker } from './serviceWorkerPlugin'

// Memoria Web: static build of the shared shell (no Tauri runtime).
//
// Additive target: `pnpm build` and the Tauri bundle keep using the root
// vite.config.ts and dist/. This config reuses the repo-root index.html and
// `src/` unchanged and emits apps/web/dist. Until the remote backend lands the
// bundle runs on the browser path in `src/mock-tauri/` (demo data), which is the
// seam a remote VaultBackend replaces. See docs/web/s1-tauri-inventory.md.

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const WEB_OUT_DIR = fileURLToPath(new URL('./dist', import.meta.url))
// Hidden source maps for the Sentry upload (TOL-232); outside WEB_OUT_DIR, so never served.
const WEB_SOURCEMAP_DIR = fileURLToPath(new URL('./sourcemaps', import.meta.url))
const WEB_RELEASE = webRelease(process.env, currentCommit(REPO_ROOT))
// The shell, plus the collaborative note page of spike S4 (TOL-8), which only this build has.
const WEB_PAGES = {
  main: fileURLToPath(new URL('../../index.html', import.meta.url)),
  collab: fileURLToPath(new URL('./collab.html', import.meta.url)),
}

/**
 * Without this, the preview server's SPA fallback answers `/api/vault/ping`
 * with index.html and mock-tauri would treat the dev vault API as available.
 */
function staticWebApiGuard(): Plugin {
  return {
    name: 'memoria-web-no-api',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!isApiRequestPath(req.url)) return next()
        res.statusCode = 404
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'No API in the static web build' }))
      })
    },
  }
}

// The desktop dev build bakes the local demo-vault-v2 path in through `define`;
// a served web bundle must not carry a build-machine path, so it is dropped.
function sharedShellConfig(): UserConfig {
  const shared: UserConfig = { ...(desktopConfig as UserConfig) }
  delete shared.define
  return shared
}

// One chunk for the icons the shell imports statically (TOL-198), instead of one request each.
const staticIcons = phosphorStaticIconChunk()

export default defineConfig(mergeConfig(sharedShellConfig(), {
  root: REPO_ROOT,
  plugins: [
    staticWebApiGuard(),
    staticIcons.plugin,
    memoriaServiceWorker(),
    appShellPreload(),
    hiddenSourceMaps({ dir: WEB_SOURCEMAP_DIR, release: WEB_RELEASE }),
  ],
  define: {
    // Read by src/main.tsx: only this build ships service-worker.js (TOL-198).
    'import.meta.env.VITE_MEMORIA_WEB_BUILD': JSON.stringify('true'),
    // The web build's own Sentry DSN and release (TOL-232), never the desktop ones.
    ...webSentryDefine(process.env, WEB_RELEASE),
  },
  build: {
    rollupOptions: { input: WEB_PAGES, output: { manualChunks: staticIcons.manualChunks } },
    outDir: WEB_OUT_DIR,
    emptyOutDir: true,
    // Mobile Safari is the acceptance target; the desktop config follows TAURI_* env.
    target: 'safari15',
    minify: 'esbuild',
    sourcemap: 'hidden',
  },
  preview: {
    host: webPreviewHost(process.env),
    port: webPreviewPort(process.env),
    strictPort: true,
    allowedHosts: webPreviewAllowedHosts(process.env),
    proxy: webPreviewProxy(process.env),
  },
} satisfies UserConfig))
