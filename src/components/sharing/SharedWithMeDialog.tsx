import { useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useSharing } from '../../hooks/useSharing'
import { translate, type AppLocale } from '../../lib/i18n'
import { currentSharedVaultId } from '../../lib/sharing/sharedVaultLocation'
import { type IncomingShare, personLabel } from '../../lib/sharing/sharesApi'
import { refreshSharing } from '../../lib/sharing/sharingStore'
import { noteName, openIncomingShare, roleKey } from './shareView'

interface SharedWithMeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Opens the share dialog for the user's own vault; absent when they have none to share. */
  onShareVault?: () => void
  locale: AppLocale
}

function shareTitle(share: IncomingShare, locale: AppLocale): string {
  return share.scope === '*' ? translate(locale, 'sharing.people.scopeVault') : noteName(share.scope)
}

function IncomingShareRow({ share, locale }: { share: IncomingShare; locale: AppLocale }) {
  const title = shareTitle(share, locale)
  return (
    <li className="flex min-w-0 items-center gap-2" data-testid="shared-with-me-item">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-foreground">{title}</span>
        <span className="truncate text-xs text-muted-foreground">
          {translate(locale, 'sharing.sharedWithMe.from', { name: personLabel(share.owner) })}
        </span>
      </div>
      <Badge variant="secondary">{translate(locale, roleKey(share.role))}</Badge>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => openIncomingShare(share)}
        aria-label={translate(locale, 'sharing.sharedWithMe.openLabel', { name: title })}
        data-testid="shared-with-me-open"
      >
        {translate(locale, 'sharing.sharedWithMe.open')}
      </Button>
    </li>
  )
}

function IncomingShares({ locale }: { locale: AppLocale }) {
  const { incoming } = useSharing()
  if (incoming.length === 0) {
    return <p className="m-0 text-sm text-muted-foreground" data-testid="shared-with-me-empty">{translate(locale, 'sharing.sharedWithMe.empty')}</p>
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0" data-testid="shared-with-me-list">
      {incoming.map((share) => <IncomingShareRow key={share.id} share={share} locale={locale} />)}
    </ul>
  )
}

function SharedWithMeFooter({ onShareVault, locale }: Pick<SharedWithMeDialogProps, 'onShareVault' | 'locale'>) {
  const inSharedVault = currentSharedVaultId() !== null
  if (!inSharedVault && !onShareVault) return null
  return (
    <DialogFooter>
      {inSharedVault
        ? <Button type="button" variant="outline" onClick={() => window.location.assign('/')} data-testid="shared-with-me-home">{translate(locale, 'sharing.sharedWithMe.myVault')}</Button>
        : <Button type="button" variant="outline" onClick={onShareVault} data-testid="shared-with-me-share-vault">{translate(locale, 'sharing.sharedWithMe.shareVault')}</Button>}
    </DialogFooter>
  )
}

/** What other people shared with the user, to open in the shell (TOL-237). */
export function SharedWithMeDialog({ open, onOpenChange, onShareVault, locale }: SharedWithMeDialogProps) {
  useEffect(() => {
    if (open) void refreshSharing()
  }, [open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md" data-testid="shared-with-me-dialog">
        <DialogHeader>
          <DialogTitle>{translate(locale, 'sharing.sharedWithMe.title')}</DialogTitle>
          <DialogDescription>{translate(locale, 'sharing.sharedWithMe.description')}</DialogDescription>
        </DialogHeader>
        <IncomingShares locale={locale} />
        <SharedWithMeFooter onShareVault={onShareVault} locale={locale} />
      </DialogContent>
    </Dialog>
  )
}
