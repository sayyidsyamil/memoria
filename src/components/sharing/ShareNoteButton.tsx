import { useState } from 'react'
import { ShareNetwork } from '@phosphor-icons/react'
import { ActionTooltip } from '@/components/ui/action-tooltip'
import { Button } from '@/components/ui/button'
import { useSharing } from '../../hooks/useSharing'
import { translate, type AppLocale } from '../../lib/i18n'
import { currentSharedVaultId } from '../../lib/sharing/sharedVaultLocation'
import { ShareDialog } from './ShareDialog'

interface ShareNoteButtonProps {
  notePath: string
  locale?: AppLocale
}

/**
 * The note bar's Share button (TOL-237): only where the hosted share API answers, in the
 * user's own vault. A vault shared with the user is not theirs to share on.
 */
export function ShareNoteButton({ notePath, locale = 'en' }: ShareNoteButtonProps) {
  const sharing = useSharing()
  const [open, setOpen] = useState(false)
  const vaultId = sharing.status === 'available' ? sharing.vaultId : null
  if (!vaultId || currentSharedVaultId()) return null
  const label = translate(locale, 'sharing.share.button')
  return (
    <>
      <ActionTooltip copy={{ label }} side="bottom" align="end">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground [&_svg:not([class*=size-])]:size-4"
          onClick={() => setOpen(true)}
          aria-label={label}
          data-testid="share-note-button"
        >
          <ShareNetwork />
        </Button>
      </ActionTooltip>
      <ShareDialog open={open} onOpenChange={setOpen} vaultId={vaultId} notePath={notePath} locale={locale} />
    </>
  )
}
