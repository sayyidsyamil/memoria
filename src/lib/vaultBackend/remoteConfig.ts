import { currentVaultBasePath } from '../sharing/sharedVaultLocation'

/** The Memoria remote the web build talks to: where its `/v1` is, and the bearer credential. */
export interface RemoteVaultConfig {
  baseUrl: string
  token: string
}

type RemoteWindow = { MEMORIA_REMOTE_URL?: string; MEMORIA_REMOTE_TOKEN?: string }

/** The remote configured on window (`MEMORIA_REMOTE_URL`, `MEMORIA_REMOTE_TOKEN`), or null. */
export function remoteVaultConfig(): RemoteVaultConfig | null {
  if (typeof window === 'undefined') return null
  const { MEMORIA_REMOTE_URL: baseUrl, MEMORIA_REMOTE_TOKEN: token } = window as RemoteWindow
  return baseUrl && token ? { baseUrl, token } : null
}

/**
 * A page showing a vault shared with the user (TOL-237, `/vaults/<id>/`) talks to that vault's
 * prefix on the same server. Called once at boot, before anything reads the remote config, so
 * every backend, attachment client and access check of the page goes to the shared vault.
 */
export function applySharedVaultBase(win: RemoteWindow = window as RemoteWindow): void {
  const base = currentVaultBasePath()
  const serverUrl = win.MEMORIA_REMOTE_URL
  if (!base || !serverUrl || serverUrl.endsWith(base)) return
  win.MEMORIA_REMOTE_URL = `${serverUrl}${base}`
}
