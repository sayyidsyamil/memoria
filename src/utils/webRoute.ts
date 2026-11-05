import type { SidebarSelection, VaultEntry } from '../types'
import { isSafeVaultRelativePath, relativePathForVaultItem, vaultDeepLinkSlug, type DeepLinkVault } from './deepLinks'
import { normalizeVaultRelativePath, notePathsMatch } from './notePathIdentity'

/**
 * Where the web build is (TOL-175): the vault, the open note and the saved view a URL names,
 * as `/?vault=<slug>&note=<vault-relative path>&view=<file>`. A query, not a path, so every
 * route shares the one cached shell of the service worker.
 */
export interface WebRoute {
  vault: string | null
  note: string | null
  view: string | null
}

/** The open vault and the vaults it is named among. */
export interface RouteVault {
  vaultPath: string
  vaults: readonly DeepLinkVault[]
}

interface RouteNoteInput {
  notePath: string
  vaultPath: string
}

interface RouteStateInput extends RouteVault {
  activeNotePath: string | null
  selection: SidebarSelection
}

const ROUTE_KEYS = ['vault', 'note', 'view'] as const

function routeParam(params: URLSearchParams, key: (typeof ROUTE_KEYS)[number]): string | null {
  return params.get(key)?.trim() || null
}

function safeRelativePath(path: string | null): string | null {
  return path && isSafeVaultRelativePath({ path }) ? normalizeVaultRelativePath(path) : null
}

export function parseWebRoute(search: string): WebRoute {
  const params = new URLSearchParams(search)
  return {
    vault: routeParam(params, 'vault'),
    note: safeRelativePath(routeParam(params, 'note')),
    view: safeRelativePath(routeParam(params, 'view')),
  }
}

function routeParams({ vault, note, view }: WebRoute): Array<[(typeof ROUTE_KEYS)[number], string | null]> {
  return [['vault', vault], ['note', note], ['view', view]]
}

/** Keeps any query the route does not own, then the route in a fixed order; slashes are legal in a query. */
export function webRouteSearch(route: WebRoute, currentSearch: string): string {
  const params = new URLSearchParams(currentSearch)
  for (const key of ROUTE_KEYS) params.delete(key)
  for (const [key, value] of routeParams(route)) {
    if (value) params.append(key, value)
  }
  const search = params.toString().replaceAll('%2F', '/')
  return search ? `?${search}` : ''
}

export function webRoutesEqual(left: WebRoute, right: WebRoute): boolean {
  return left.vault === right.vault && left.note === right.note && left.view === right.view
}

/** Remote entries are already vault-relative; local ones are absolute under the vault. */
export function routeNotePath({ notePath, vaultPath }: RouteNoteInput): string | null {
  const relative = vaultPath ? relativePathForVaultItem({ itemPath: notePath, vaultPath }) : null
  if (relative) return relative
  return notePath.startsWith('/') ? null : safeRelativePath(notePath)
}

/** The entry whose route path is `notePath`. */
export function findRouteEntry(entries: readonly VaultEntry[], { notePath, vaultPath }: RouteNoteInput): VaultEntry | undefined {
  return entries.find((entry) => routeNotePath({ notePath: entry.path, vaultPath }) === notePath)
}

export function routeVaultSlug({ vaultPath, vaults }: RouteVault): string | null {
  const vault = vaults.find((candidate) => notePathsMatch(candidate.path, vaultPath))
  return vault ? vaultDeepLinkSlug(vault, vaults) : null
}

/** A route names a note of the open vault, or of no vault in particular. */
export function routeMatchesVault(route: WebRoute, vaultSlug: string | null): boolean {
  return route.vault === null || route.vault === vaultSlug
}

export function webRouteForState({ activeNotePath, selection, vaultPath, vaults }: RouteStateInput): WebRoute {
  return {
    vault: routeVaultSlug({ vaultPath, vaults }),
    note: activeNotePath ? routeNotePath({ notePath: activeNotePath, vaultPath }) : null,
    view: selection.kind === 'view' ? selection.filename : null,
  }
}
