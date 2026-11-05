import type { Plugin, Rollup } from 'vite'

// TOL-198: the icon picker loads every Phosphor icon through `import.meta.glob`, so each icon
// module is its own dynamic entry and lands in its own chunk. The few dozen icons the shell
// imports statically then cost one request each before first paint, and every one of them
// goes through the service worker. This web-only rule groups the statically imported icons
// into two chunks: icons of the entry's static graph, and icons of the lazily loaded app (also
// fetched before first paint). The desktop build never loads this file.

const PHOSPHOR_PACKAGE = '@phosphor-icons/react'
const ICON_MODULE_PATTERN = /\/@phosphor-icons\/react\/dist\/csr\/(\w+)\.es\.js$/
const ICON_EXPORT_SUFFIX = 'Icon'
export const STATIC_ICON_CHUNK = 'phosphor-static'
export const LAZY_ICON_CHUNK = 'phosphor-lazy'

interface ImportSpecifierNode {
  type: string
  imported?: { name?: string; value?: string }
}

/** The part of an ESTree program node this plugin reads. */
export interface ModuleStatementNode {
  type: string
  source?: { value?: unknown } | null
  specifiers?: readonly ImportSpecifierNode[]
}

type GetModuleInfo = (id: string) => Pick<Rollup.ModuleInfo, 'importers' | 'isEntry'> | null

/** `FolderIcon` and `Folder` both come from the `Folder` module. */
export function iconModuleName(exportName: string): string {
  const stripped = exportName.endsWith(ICON_EXPORT_SUFFIX) ? exportName.slice(0, -ICON_EXPORT_SUFFIX.length) : exportName
  return stripped || exportName
}

function isPhosphorDeclaration(node: ModuleStatementNode): boolean {
  const isImportOrReExport = node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration'
  return isImportOrReExport && node.source?.value === PHOSPHOR_PACKAGE
}

function specifierName(specifier: ImportSpecifierNode): string | null {
  if (specifier.type !== 'ImportSpecifier' && specifier.type !== 'ExportSpecifier') return null
  return specifier.imported?.name ?? specifier.imported?.value ?? null
}

/** Icon module names a module imports by name from `@phosphor-icons/react`. */
export function phosphorIconImports(body: readonly ModuleStatementNode[]): string[] {
  const names = new Set<string>()
  for (const node of body.filter(isPhosphorDeclaration)) {
    for (const specifier of node.specifiers ?? []) {
      const name = specifierName(specifier)
      if (name) names.add(iconModuleName(name))
    }
  }
  return [...names]
}

export function iconModuleNameOf(id: string): string | null {
  return ICON_MODULE_PATTERN.exec(id)?.[1] ?? null
}

/** Static importers of a module that a walk has not seen yet; marks them seen. */
function unseenImporters(info: ReturnType<GetModuleInfo>, seen: Set<string>): string[] {
  const fresh = (info?.importers ?? []).filter((importer) => !seen.has(importer))
  for (const importer of fresh) seen.add(importer)
  return fresh
}

/** Walks static importers up from `start`, breadth-first, until one passes `reaches`. */
function someAncestor(start: string, getModuleInfo: GetModuleInfo, reaches: (id: string) => boolean): boolean {
  const seen = new Set<string>([start])
  const queue = [start]
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (reaches(id)) return true
    queue.push(...unseenImporters(getModuleInfo(id), seen))
  }
  return false
}

/**
 * Whether a module is loaded with the first page: some chain of static importers reaches an
 * entry. Modules found reachable are remembered, so later walks stop there.
 */
export function createStaticReachability(getModuleInfo: GetModuleInfo): (id: string) => boolean {
  const reachable = new Set<string>()
  const reaches = (id: string) => reachable.has(id) || getModuleInfo(id)?.isEntry === true
  return (start) => {
    const found = someAncestor(start, getModuleInfo, reaches)
    if (found) reachable.add(start)
    return found
  }
}

export interface PhosphorStaticIconChunk {
  plugin: Plugin
  manualChunks: (id: string, meta: { getModuleInfo: GetModuleInfo }) => string | undefined
}

export function phosphorStaticIconChunk(): PhosphorStaticIconChunk {
  const importersByIcon = new Map<string, Set<string>>()
  let isStatic: ((id: string) => boolean) | null = null
  const plugin: Plugin = {
    name: 'memoria-web-phosphor-static-icons',
    apply: 'build',
    buildStart() {
      importersByIcon.clear()
      isStatic = null
    },
    moduleParsed(info) {
      if (info.id.includes('/node_modules/') || !info.ast) return
      for (const icon of phosphorIconImports(info.ast.body as readonly ModuleStatementNode[])) {
        const importers = importersByIcon.get(icon) ?? new Set<string>()
        importers.add(info.id)
        importersByIcon.set(icon, importers)
      }
    },
  }
  const manualChunks: PhosphorStaticIconChunk['manualChunks'] = (id, { getModuleInfo }) => {
    const icon = iconModuleNameOf(id)
    const importers = icon ? importersByIcon.get(icon) : undefined
    if (!importers) return undefined
    isStatic ??= createStaticReachability(getModuleInfo)
    return [...importers].some(isStatic) ? STATIC_ICON_CHUNK : LAZY_ICON_CHUNK
  }
  return { plugin, manualChunks }
}
