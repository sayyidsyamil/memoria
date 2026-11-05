import { useState } from 'react'
import { UsersThree } from '@phosphor-icons/react'
import { ActionTooltip } from '@/components/ui/action-tooltip'
import { Button } from '@/components/ui/button'
import { useSharing } from '../../hooks/useSharing'
import { useVaultAccess } from '../../hooks/useVaultAccess'
import { translate, type AppLocale, type TranslationKey } from '../../lib/i18n'
import { currentSharedVaultId } from '../../lib/sharing/sharedVaultLocation'
import { sharedRoleOf, type VaultAccessState } from '../../lib/sharing/vaultAccess'
import { AccessRevokedDialog } from './AccessRevokedDialog'
import { ShareDialog } from './ShareDialog'
import { SharedWithMeDialog } from './SharedWithMeDialog'

type OpenDialog = 'none' | 'sharedWithMe' | 'shareVault'

/** The label in a shared vault says what the user may do there; elsewhere the entry is an icon. */
function sharedVaultLabel(access: VaultAccessState): TranslationKey | null {
  if (!currentSharedVaultId()) return null
  const role = sharedRoleOf(access)
  if (!role) return 'sharing.sharedWithMe.button'
  return role === 'editor' ? 'sharing.status.editor' : 'sharing.status.viewer'
}

interface SharingEntryProps {
  stateLabel: TranslationKey | null
  onOpen: () => void
  locale: AppLocale
}

function SharingEntry({ stateLabel, onOpen, locale }: SharingEntryProps) {
  const label = translate(locale, 'sharing.sharedWithMe.button')
  return (
    <ActionTooltip copy={{ label }} side="top" align="end">
      <Button
        type="button"
        variant="ghost"
        size={stateLabel ? 'xs' : 'icon-xs'}
        className="text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground"
        onClick={onOpen}
        aria-label={label}
        data-testid="status-shared-with-me"
      >
        <UsersThree size={14} weight="regular" />
        {stateLabel && <span data-testid="status-shared-role">{translate(locale, stateLabel)}</span>}
      </Button>
    </ActionTooltip>
  )
}

interface SharingDialogsProps {
  dialog: OpenDialog
  setDialog: (dialog: OpenDialog) => void
  /** The user's own vault, when this page shows it; it can be shared from here. */
  ownVaultId: string | null
  revoked: boolean
  locale: AppLocale
}

function SharingDialogs({ dialog, setDialog, ownVaultId, revoked, locale }: SharingDialogsProps) {
  const close = (open: boolean) => {
    if (!open) setDialog('none')
  }
  return (
    <>
      <SharedWithMeDialog
        open={dialog === 'sharedWithMe'}
        onOpenChange={close}
        onShareVault={ownVaultId ? () => setDialog('shareVault') : undefined}
        locale={locale}
      />
      {ownVaultId && (
        <ShareDialog open={dialog === 'shareVault'} onOpenChange={close} vaultId={ownVaultId} notePath={null} locale={locale} />
      )}
      <AccessRevokedDialog
        open={revoked && dialog !== 'sharedWithMe'}
        onShowSharedWithMe={() => setDialog('sharedWithMe')}
        locale={locale}
      />
    </>
  )
}

/**
 * The web status bar's sharing entry (TOL-237): "Shared with me", sharing the own vault, the
 * role in a shared vault, and the notice when that share is revoked while open.
 */
export function SharingStatusButton({ locale = 'en' }: { locale?: AppLocale }) {
  const sharing = useSharing()
  const access = useVaultAccess()
  const [dialog, setDialog] = useState<OpenDialog>('none')
  const stateLabel = sharedVaultLabel(access)
  if (sharing.status !== 'available' && !stateLabel) return null
  return (
    <>
      <SharingEntry stateLabel={stateLabel} onOpen={() => setDialog('sharedWithMe')} locale={locale} />
      <SharingDialogs
        dialog={dialog}
        setDialog={setDialog}
        ownVaultId={stateLabel ? null : sharing.vaultId}
        revoked={access.kind === 'revoked'}
        locale={locale}
      />
    </>
  )
}
