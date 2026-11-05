/**
 * Where a vault someone shared with the user is opened (TOL-237): the shell at
 * `/vaults/<vaultId>/`, which talks to `/vaults/<vaultId>/v1`. The hosted front end mints the
 * user's access ticket for every request under that prefix. The page at `/` is the user's own
 * vault, as before.
 */

const SHARED_VAULT_PATH = /^\/vaults\/([A-Za-z0-9_-]{1,64})(?:\/|$)/u

/** The id of the shared vault the page at `pathname` shows, or null for the user's own. */
export function sharedVaultIdFromPath(pathname: string): string | null {
  return SHARED_VAULT_PATH.exec(pathname)?.[1] ?? null
}

/** The prefix the page's vault is served under: `/vaults/<id>` for a shared vault, `''` for the own one. */
export function vaultBasePath(pathname: string): string {
  const vaultId = sharedVaultIdFromPath(pathname)
  return vaultId ? `/vaults/${vaultId}` : ''
}

/** The shell's URL for a shared vault, opened on `notePath` when the share is one note. */
export function sharedVaultHref(vaultId: string, notePath: string | null): string {
  const query = notePath ? `?${new URLSearchParams({ note: notePath })}` : ''
  return `/vaults/${encodeURIComponent(vaultId)}/${query}`
}

function currentPathname(): string {
  return typeof window === 'undefined' ? '/' : window.location.pathname
}

/** The shared vault this page shows, or null for the user's own vault. */
export function currentSharedVaultId(): string | null {
  return sharedVaultIdFromPath(currentPathname())
}

/** The prefix of this page's vault; see `vaultBasePath`. */
export function currentVaultBasePath(): string {
  return vaultBasePath(currentPathname())
}
