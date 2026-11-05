import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import type { SidebarSelection, VaultEntry, ViewFile } from '../types'
import type { DeepLinkVault } from '../utils/deepLinks'
import { INBOX_SELECTION } from '../utils/organizationWorkflow'
import {
  findRouteEntry,
  parseWebRoute,
  routeMatchesVault,
  routeVaultSlug,
  webRouteForState,
  webRouteSearch,
  webRoutesEqual,
  type WebRoute,
} from '../utils/webRoute'
import { useLatestRef } from './editorTabSwapLifecycle'
import { BACK_TO_NOTE_LIST_STATE_KEY, type NoteListPane } from './usePhoneNoteStack'

export interface WebRoutingOptions {
  activeNotePath: string | null
  enabled: boolean
  entries: VaultEntry[]
  /** The route the page was opened with; its view is selected once the vault is ready. */
  initialRoute: WebRoute | null
  /** Phone layout (TOL-193): while the list is shown the URL names no note, and back shows it. */
  noteListPane?: NoteListPane
  openNote: (entry: VaultEntry) => Promise<void>
  /** The open note was restored (or there was none): from here the URL follows the app. */
  ready: boolean
  selection: SidebarSelection
  setSelection: (selection: SidebarSelection) => void
  vaultPath: string
  vaults: readonly DeepLinkVault[]
  views: readonly ViewFile[]
}

type LatestRouting = Omit<WebRoutingOptions, 'enabled' | 'initialRoute' | 'ready'>

function currentUrlFor(route: WebRoute): string {
  const { hash, pathname, search } = window.location
  return `${pathname}${webRouteSearch(route, search)}${hash}`
}

/** A pushed entry remembers whether the one before it named no note, for the phone's back control. */
function pushedState(synced: WebRoute): unknown {
  const state: unknown = window.history.state
  const base = typeof state === 'object' && state !== null ? state : {}
  return { ...base, [BACK_TO_NOTE_LIST_STATE_KEY]: synced.note === null }
}

/** The first sync replaces the entry the page was opened with; later ones are new history. */
function syncUrl(syncedRef: MutableRefObject<WebRoute | null>, route: WebRoute): void {
  const synced = syncedRef.current
  if (synced && webRoutesEqual(synced, route)) return
  syncedRef.current = route
  if (synced) window.history.pushState(pushedState(synced), '', currentUrlFor(route))
  else window.history.replaceState(window.history.state, '', currentUrlFor(route))
}

function routeEntry(route: WebRoute, latest: LatestRouting, vaultSlug: string | null): VaultEntry | undefined {
  if (!route.note || !routeMatchesVault(route, vaultSlug)) return undefined
  return findRouteEntry(latest.entries, { notePath: route.note, vaultPath: latest.vaultPath })
}

function routeView(route: WebRoute, latest: LatestRouting, vaultSlug: string | null): ViewFile | undefined {
  if (!route.view || !routeMatchesVault(route, vaultSlug)) return undefined
  return latest.views.find((view) => view.filename === route.view)
}

function isSelectedView(selection: SidebarSelection, view: ViewFile): boolean {
  return selection.kind === 'view' && selection.filename === view.filename
}

function selectView(view: ViewFile, latest: LatestRouting): void {
  latest.setSelection({ kind: 'view', filename: view.filename, rootPath: view.rootPath })
}

/** Selects the view of the opening URL; true while that selection still has to render. */
function applyInitialView(pendingRef: MutableRefObject<WebRoute | null>, latest: LatestRouting): boolean {
  const route = pendingRef.current
  pendingRef.current = null
  if (!route) return false
  const view = routeView(route, latest, routeVaultSlug(latest))
  if (!view || isSelectedView(latest.selection, view)) return false
  selectView(view, latest)
  return true
}

function selectPoppedView(view: ViewFile | undefined, latest: LatestRouting): void {
  if (view) selectView(view, latest)
  else if (latest.selection.kind === 'view') latest.setSelection(INBOX_SELECTION)
}

interface PopRefs {
  latestRef: MutableRefObject<LatestRouting>
  poppingRef: MutableRefObject<boolean>
  syncedRef: MutableRefObject<WebRoute | null>
}

/** Back/forward: open what the URL names; the URL already says it, so nothing is pushed. */
function applyPoppedRoute({ latestRef, poppingRef, syncedRef }: PopRefs): void {
  const latest = latestRef.current
  const route = parseWebRoute(window.location.search)
  const current = webRouteForState(latest)
  const entry = routeEntry(route, latest, current.vault)
  const view = routeView(route, latest, current.vault)
  // A phone shows the list for a route without a note; wider layouts keep the open note.
  const keptNote = latest.noteListPane ? null : current.note
  syncedRef.current = { vault: current.vault, note: entry ? route.note : keptNote, view: view?.filename ?? null }
  latest.noteListPane?.show(!entry)
  selectPoppedView(view, latest)
  if (!entry) return
  poppingRef.current = true
  void latest.openNote(entry).finally(() => { poppingRef.current = false })
}

/**
 * Web-only URL routing (TOL-175): the URL names the open vault, note and saved view, a
 * navigation pushes a history entry, and back/forward walk those entries. Nothing here runs
 * before the first paint; the opening URL's note is restored through useLastActiveNote.
 */
export function useWebRouting({ enabled, initialRoute, ready, ...latest }: WebRoutingOptions): void {
  const latestRef = useLatestRef<LatestRouting>(latest)
  const syncedRef = useRef<WebRoute | null>(null)
  const pendingViewRef = useRef<WebRoute | null>(initialRoute)
  const poppingRef = useRef(false)
  const { selection, vaultPath, vaults } = latest
  const activeNotePath = latest.noteListPane?.shown ? null : latest.activeNotePath
  const route = useMemo(
    () => webRouteForState({ activeNotePath, selection, vaultPath, vaults }),
    [activeNotePath, selection, vaultPath, vaults],
  )

  useEffect(() => {
    if (!enabled || !ready || poppingRef.current) return
    if (applyInitialView(pendingViewRef, latestRef.current)) return
    syncUrl(syncedRef, route)
  }, [enabled, latestRef, ready, route])

  useEffect(() => {
    if (!enabled) return
    const handlePopState = () => { applyPoppedRoute({ latestRef, poppingRef, syncedRef }) }
    window.addEventListener('popstate', handlePopState)
    return () => { window.removeEventListener('popstate', handlePopState) }
  }, [enabled, latestRef])
}
