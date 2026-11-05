import type { HtmlTagDescriptor, Plugin, Rollup } from 'vite'

// TOL-206: the entry imports the app shell (src/App.tsx) dynamically, so the browser only asks
// for it once the entry has run, and the cached note list waits for that round trip and its
// compilation. This web-only rule lists the shell's chunk and its static imports as module
// preloads in index.html: they download and compile while the entry runs. The desktop build
// never loads this file.

const APP_SHELL_MODULE = '/src/App.tsx'
const SHELL_PAGE = 'index.html'

type BundleChunk = Pick<Rollup.OutputChunk, 'type' | 'fileName' | 'moduleIds' | 'imports'>
type BundleEntry = BundleChunk | { type: 'asset'; fileName: string }

function isChunk(entry: BundleEntry): entry is BundleChunk {
  return entry.type === 'chunk'
}

// Matched by module rather than facade: with manual chunks the shell's chunk has no facade.
function shellChunk(chunks: BundleChunk[], moduleId: string): BundleChunk | undefined {
  return chunks.find((chunk) => chunk.moduleIds.some((id) => id.endsWith(moduleId)))
}

/** The app shell's chunk and every chunk it imports statically, in load order. */
export function appShellFiles(bundle: Record<string, BundleEntry>, moduleId = APP_SHELL_MODULE): string[] {
  const chunks = Object.values(bundle).filter(isChunk)
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
  const files: string[] = []
  const visit = (chunk: BundleChunk | undefined) => {
    if (!chunk || files.includes(chunk.fileName)) return
    files.push(chunk.fileName)
    for (const file of chunk.imports) visit(byFile.get(file))
  }
  visit(shellChunk(chunks, moduleId))
  return files
}

export function appShellPreloadTags(files: readonly string[], base = '/'): HtmlTagDescriptor[] {
  return files.map((file) => ({
    tag: 'link',
    attrs: { rel: 'modulepreload', crossorigin: true, href: `${base}${file}` },
    injectTo: 'head',
  }))
}

export function appShellPreload(): Plugin {
  return {
    name: 'memoria-app-shell-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        if (!context.bundle || !context.filename.endsWith(SHELL_PAGE)) return html
        // Files the page already loads or preloads (the entry's own graph) are left out.
        const files = appShellFiles(context.bundle).filter((file) => !html.includes(file))
        return { html, tags: appShellPreloadTags(files) }
      },
    },
  }
}
