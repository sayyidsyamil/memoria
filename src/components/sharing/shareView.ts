import type { TranslationKey } from '../../lib/i18n'
import { sharedVaultHref } from '../../lib/sharing/sharedVaultLocation'
import { type IncomingShare, type OutgoingShare, personLabel, type ShareErrorCode } from '../../lib/sharing/sharesApi'
import { trackSharedWithMeOpened } from '../../lib/sharing/sharingAnalytics'
import type { SharedRole } from '../../lib/sharing/vaultAccess'

/** What the sharing UI shows and does (TOL-237), apart from its components. */

const SHARE_ERROR_KEYS = new Map<ShareErrorCode, TranslationKey>([
  ['user_not_found', 'sharing.error.userNotFound'],
  ['invalid_request', 'sharing.error.invalidRequest'],
  ['share_limit', 'sharing.error.shareLimit'],
  ['rate_limited', 'sharing.error.rateLimited'],
  ['unavailable', 'sharing.error.unavailable'],
])

/** What the user reads when a share request fails. */
export function shareErrorKey(code: ShareErrorCode): TranslationKey {
  return SHARE_ERROR_KEYS.get(code) ?? 'sharing.error.failed'
}

/** A role as the sharing UI names it. */
export function roleKey(role: SharedRole): TranslationKey {
  return role === 'editor' ? 'sharing.role.editor' : 'sharing.role.viewer'
}

export const SHARED_ROLES: readonly SharedRole[] = ['editor', 'viewer']

/** A share's scope for the sharing analytics. */
export function scopeKind(scope: string | null): 'note' | 'vault' {
  return scope && scope !== '*' ? 'note' : 'vault'
}

/** A note path as people read it: its file name without `.md`. */
export function noteName(path: string): string {
  const file = path.split('/').pop() ?? path
  return file.replace(/\.md$/iu, '')
}

/** The shares a dialog shows: for a note, its own and the whole vault's; for the vault, all of them. */
export function sharesFor(shares: readonly OutgoingShare[], notePath: string | null): OutgoingShare[] {
  const visible = notePath ? shares.filter((share) => share.scope === '*' || share.scope === notePath) : [...shares]
  return visible.sort((a, b) => personLabel(a.grantee).localeCompare(personLabel(b.grantee)))
}

/** A full navigation: the shell starts over on the shared vault, with its own backend and cache. */
export function openIncomingShare(share: IncomingShare): void {
  trackSharedWithMeOpened(scopeKind(share.scope), share.role)
  window.location.assign(sharedVaultHref(share.vaultId, share.scope === '*' ? null : share.scope))
}
