import { isTauri } from '../../mock-tauri'
import { remoteVaultConfig } from '../vaultBackend/remoteConfig'
import {
  type IncomingShare,
  listIncomingShares,
  listOutgoingShares,
  type OutgoingShare,
  ShareApiError,
} from './sharesApi'

/**
 * The page's view of the share records (TOL-237): whether this deployment offers sharing,
 * the user's own vault and its shares, and what others shared with them. Read once after
 * startup and again when a sharing surface opens, so the dialogs open on what is known.
 */
export interface SharingState {
  /** `unknown` until the first answer; `unavailable` without the hosted share API. */
  status: 'unknown' | 'available' | 'unavailable'
  vaultId: string | null
  outgoing: OutgoingShare[]
  incoming: IncomingShare[]
}

const INITIAL: SharingState = { status: 'unknown', vaultId: null, outgoing: [], incoming: [] }
const UNAVAILABLE: SharingState = { ...INITIAL, status: 'unavailable' }
/** After the first paint and the note list: sharing is never on the startup path. */
const STARTUP_DELAY_MS = 1_500

let state: SharingState = INITIAL
let loading: Promise<void> | null = null
let scheduled = false
let revision = 0
const listeners = new Set<() => void>()

export function getSharing(): SharingState {
  return state
}

export function subscribeSharing(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publish(next: SharingState): void {
  state = next
  for (const listener of listeners) listener()
}

/** Only the web build talking to a server can have the hosted share API next to it. */
function mayOfferSharing(): boolean {
  return !isTauri() && remoteVaultConfig() !== null
}

async function load(): Promise<void> {
  const requestedRevision = revision
  try {
    const [outgoing, incoming] = await Promise.all([listOutgoingShares(), listIncomingShares()])
    // A dialog refresh started before an invite/revoke must not undo the local
    // result when its older snapshot arrives after the mutation succeeds.
    if (requestedRevision !== revision) return
    publish({ status: 'available', vaultId: outgoing.vaultId, outgoing: outgoing.shares, incoming })
  } catch (error) {
    if (requestedRevision === revision && error instanceof ShareApiError && error.code === 'unavailable') publish(UNAVAILABLE)
  }
}

/** Reads the share records again; one read at a time. A failed read keeps what was known. */
export function refreshSharing(): Promise<void> {
  if (!mayOfferSharing()) return Promise.resolve()
  loading ??= load().finally(() => {
    loading = null
  })
  return loading
}

/** The first read, once, a moment after startup. */
export function scheduleSharingLoad(): void {
  if (scheduled || !mayOfferSharing()) return
  scheduled = true
  setTimeout(() => void refreshSharing(), STARTUP_DELAY_MS)
}

/** A share was created or changed in this page: shown at once, before the next read. */
export function rememberOutgoingShare(share: OutgoingShare): void {
  revision += 1
  const others = state.outgoing.filter((existing) => existing.id !== share.id)
  publish({ ...state, outgoing: [...others, share] })
}

/** A share was revoked in this page. */
export function forgetOutgoingShare(id: string): void {
  revision += 1
  publish({ ...state, outgoing: state.outgoing.filter((share) => share.id !== id) })
}

/** Tests only. */
export function resetSharingForTests(next: SharingState = INITIAL): void {
  revision += 1
  state = next
  loading = null
  scheduled = false
  listeners.clear()
}
