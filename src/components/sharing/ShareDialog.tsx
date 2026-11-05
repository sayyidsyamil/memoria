import { useEffect } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useSharing } from '../../hooks/useSharing'
import { translate, type AppLocale } from '../../lib/i18n'
import { refreshSharing } from '../../lib/sharing/sharingStore'
import { SharePeopleList } from './SharePeopleList'
import { sharesFor } from './shareView'
import { ShareInviteForm } from './ShareInviteForm'
import { useShareInvite } from './useShareInvite'

interface ShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  vaultId: string
  /** The note the dialog was opened on; null shares the vault. */
  notePath: string | null
  locale: AppLocale
}

function ShareDialogBody({ vaultId, notePath, locale }: Omit<ShareDialogProps, 'open' | 'onOpenChange'>) {
  const sharing = useSharing()
  const form = useShareInvite({ vaultId, notePath, locale })
  const listedFor = form.scope === 'note' ? notePath : null
  return (
    <>
      <ShareInviteForm form={form} canShareNote={notePath !== null} locale={locale} />
      <SharePeopleList vaultId={vaultId} shares={sharesFor(sharing.outgoing, listedFor)} locale={locale} />
    </>
  )
}

/** Invite people to a note or the vault, change their role, or take it away (TOL-237). */
export function ShareDialog({ open, onOpenChange, vaultId, notePath, locale }: ShareDialogProps) {
  useEffect(() => {
    if (open) void refreshSharing()
  }, [open])
  const description = notePath ? 'sharing.dialog.descriptionNote' : 'sharing.dialog.descriptionVault'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md" data-testid="share-dialog">
        <DialogHeader>
          <DialogTitle>{translate(locale, 'sharing.dialog.title')}</DialogTitle>
          <DialogDescription>{translate(locale, description)}</DialogDescription>
        </DialogHeader>
        {open && <ShareDialogBody vaultId={vaultId} notePath={notePath} locale={locale} />}
      </DialogContent>
    </Dialog>
  )
}
