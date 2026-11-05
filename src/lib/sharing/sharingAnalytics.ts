import { trackEvent } from '../telemetry'
import type { ShareErrorCode } from './sharesApi'
import type { SharedRole } from './vaultAccess'

/** Product analytics of sharing (TOL-237). No addresses, logins, ids or note paths. */

export type ShareScopeKind = 'note' | 'vault'
export type InviteeKind = 'email' | 'github'

export function trackShareInvited(scope: ShareScopeKind, role: SharedRole, invitee: InviteeKind): void {
  trackEvent('share_invite_sent', { scope, role, invitee })
}

export function trackShareInviteFailed(scope: ShareScopeKind, reason: ShareErrorCode): void {
  trackEvent('share_invite_failed', { scope, reason })
}

export function trackShareRoleChanged(scope: ShareScopeKind, role: SharedRole): void {
  trackEvent('share_role_changed', { scope, role })
}

export function trackShareRevoked(scope: ShareScopeKind): void {
  trackEvent('share_revoked', { scope })
}

export function trackSharedWithMeOpened(scope: ShareScopeKind, role: SharedRole): void {
  trackEvent('shared_with_me_opened', { scope, role })
}
