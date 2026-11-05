import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { build as esbuild } from 'esbuild'
import type { Plugin, Rollup } from 'vite'

// TOL-198: emits `service-worker.js` into the web bundle only. The desktop build never sees
// this plugin, so it ships no service worker. The worker is bundled on its own as a classic
// script (no imports at runtime) and receives the build version and the files the first
// paint needs, so a deploy replaces the cached shell and an offline start has what it needs.

const SERVICE_WORKER_ENTRY = fileURLToPath(new URL('./src/serviceWorker.ts', import.meta.url))
export const SERVICE_WORKER_FILE = 'service-worker.js'
const SHELL_HTML = 'index.html'

type OutputBundle = Rollup.OutputBundle
type OutputChunk = Rollup.OutputChunk

interface ChunkMetadata {
  importedCss?: Set<string>
}

function chunkMetadata(chunk: OutputChunk): ChunkMetadata {
  return (chunk as OutputChunk & { viteMetadata?: ChunkMetadata }).viteMetadata ?? {}
}

function chunksByFile(bundle: OutputBundle): Map<string, OutputChunk> {
  const chunks = new Map<string, OutputChunk>()
  for (const output of Object.values(bundle)) {
    if (output.type === 'chunk') chunks.set(output.fileName, output)
  }
  return chunks
}

function collectStaticGraph(start: OutputChunk, chunks: Map<string, OutputChunk>, files: Set<string>): void {
  if (files.has(start.fileName)) return
  files.add(start.fileName)
  const metadata = chunkMetadata(start)
  for (const css of metadata.importedCss ?? []) files.add(css)
  for (const imported of start.imports) {
    const chunk = chunks.get(imported)
    if (chunk) collectStaticGraph(chunk, chunks, files)
  }
}

function isShellEntry(chunk: OutputChunk): boolean {
  return chunk.isEntry && (chunk.facadeModuleId ?? '').endsWith(SHELL_HTML)
}

/**
 * The scripts and styles of the shell entry, everything it imports, and the app chunk it loads
 * right after. Fonts and images are left to the page, which reports the ones it actually used.
 */
export function shellPrecacheFiles(bundle: OutputBundle): string[] {
  const chunks = chunksByFile(bundle)
  const files = new Set<string>()
  for (const entry of [...chunks.values()].filter(isShellEntry)) {
    const roots = [entry, ...entry.dynamicImports.map((file) => chunks.get(file))]
    for (const root of roots) if (root) collectStaticGraph(root, chunks, files)
  }
  return [...files].sort().map((file) => `/${file}`)
}

export function buildVersion(bundle: OutputBundle): string {
  const fileNames = Object.keys(bundle).sort().join('\n')
  return createHash('sha256').update(fileNames).digest('hex').slice(0, 16)
}

async function bundleServiceWorker(version: string, precacheUrls: string[]): Promise<string> {
  const result = await esbuild({
    entryPoints: [SERVICE_WORKER_ENTRY],
    bundle: true,
    format: 'iife',
    minify: true,
    target: 'safari15',
    write: false,
    define: {
      __MEMORIA_SW_VERSION__: JSON.stringify(version),
      __MEMORIA_SW_PRECACHE__: JSON.stringify(precacheUrls),
    },
  })
  return result.outputFiles[0].text
}

export function memoriaServiceWorker(): Plugin {
  return {
    name: 'memoria-web-service-worker',
    apply: 'build',
    async generateBundle(_options, bundle) {
      const source = await bundleServiceWorker(buildVersion(bundle), shellPrecacheFiles(bundle))
      this.emitFile({ type: 'asset', fileName: SERVICE_WORKER_FILE, source })
    },
  }
}
