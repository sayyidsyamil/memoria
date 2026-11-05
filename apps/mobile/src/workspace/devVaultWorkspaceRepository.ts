import type { MobileNote, MobileWorkspaceSnapshot } from './mobileWorkspaceModel'
import type { ReadOnlyWorkspaceRepository } from './readOnlyWorkspaceRepository'
import { fetchPrivateDevVault, privateDevVaultBaseUrl } from './devVaultBridgeUrl'

export type DevVaultWorkspaceState = {
  contentBaseUrl?: string | null
  noteContents: Record<string, string>
  snapshot: MobileWorkspaceSnapshot
}

type DevVaultWorkspacePayload = {
  noteContents?: unknown
  snapshot?: unknown
}

export async function fetchDevVaultWorkspaceState(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<DevVaultWorkspaceState> {
  const contentBaseUrl = privateDevVaultBaseUrl(baseUrl)
  const response = await fetchPrivateDevVault(contentBaseUrl, 'snapshot', { signal })
  if (!response.ok) {
    throw new Error(`Local vault bridge returned ${response.status}`)
  }

  const payload: unknown = await response.json()
  return { ...parseDevVaultWorkspaceState(payload), contentBaseUrl }
}

export function createDevVaultWorkspaceRepository(state: DevVaultWorkspaceState): ReadOnlyWorkspaceRepository {
  return {
    persistWrites: async () => {
      throw new Error('Development vault bridge is read-only')
    },
    readNoteContent: async (note) => readDevVaultNoteContent(state, note),
    readSnapshot: () => ({ ...state.snapshot, sync: { kind: 'readOnly' } }),
  }
}

function parseDevVaultWorkspaceState(payload: unknown): DevVaultWorkspaceState {
  if (!isRecord(payload)) throw new Error('Local vault bridge returned invalid JSON')

  const { noteContents = {}, snapshot } = payload as DevVaultWorkspacePayload
  if (!isMobileWorkspaceSnapshot(snapshot)) {
    throw new Error('Local vault bridge returned an invalid workspace snapshot')
  }

  return {
    noteContents: isStringRecord(noteContents) ? noteContents : {},
    snapshot,
  }
}

function devVaultNoteContent(noteContents: Record<string, string>, note: MobileNote): string | null {
  if (note.path && noteContents[note.path] !== undefined) return noteContents[note.path]
  return noteContents[note.id] ?? null
}

async function readDevVaultNoteContent(state: DevVaultWorkspaceState, note: MobileNote): Promise<string | null> {
  if (note.rawContent !== undefined) return note.rawContent
  const cachedContent = devVaultNoteContent(state.noteContents, note)
  if (cachedContent !== null) return cachedContent

  const notePath = note.path ?? note.id
  if (!state.contentBaseUrl || !notePath) return null
  const content = await fetchDevVaultNoteContent(state.contentBaseUrl, notePath)
  if (content !== null) state.noteContents[notePath] = content
  return content
}

async function fetchDevVaultNoteContent(baseUrl: string, notePath: string): Promise<string | null> {
  const response = await fetchPrivateDevVault(baseUrl, 'content', { query: { path: notePath } })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Local vault bridge returned ${response.status}`)

  const payload: unknown = await response.json()
  return devVaultContentPayload(payload)
}

function devVaultContentPayload(payload: unknown): string | null {
  if (!isRecord(payload)) return null
  return typeof payload.content === 'string' ? payload.content : null
}

function isMobileWorkspaceSnapshot(value: unknown): value is MobileWorkspaceSnapshot {
  if (!isRecord(value)) return false

  return (
    Array.isArray(value.notes) &&
    Array.isArray(value.sidebarSections) &&
    isRecord(value.sync) &&
    typeof value.noteListSubtitle === 'string' &&
    Array.isArray(value.editorBlocks) &&
    Array.isArray(value.editorBullets)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false
  return Object.values(value).every((item) => typeof item === 'string')
}
