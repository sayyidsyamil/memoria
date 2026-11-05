import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { translate, type AppLocale } from '../../lib/i18n'

interface AccessRevokedDialogProps {
  open: boolean
  onShowSharedWithMe: () => void
  locale: AppLocale
}

const keepOpen = (event: Event) => event.preventDefault()

/**
 * The owner took the share away while it was open (TOL-237). The page stops reconnecting and
 * says so; it cannot be dismissed into a vault it no longer shows.
 */
export function AccessRevokedDialog({ open, onShowSharedWithMe, locale }: AccessRevokedDialogProps) {
  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={keepOpen}
        onPointerDownOutside={keepOpen}
        onInteractOutside={keepOpen}
        className="sm:max-w-sm"
        data-testid="access-revoked-dialog"
      >
        <DialogHeader>
          <DialogTitle>{translate(locale, 'sharing.revoked.title')}</DialogTitle>
          <DialogDescription>{translate(locale, 'sharing.revoked.description')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onShowSharedWithMe} data-testid="access-revoked-shared-with-me">
            {translate(locale, 'sharing.sharedWithMe.title')}
          </Button>
          <Button type="button" onClick={() => window.location.assign('/')} data-testid="access-revoked-home">
            {translate(locale, 'sharing.sharedWithMe.myVault')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
