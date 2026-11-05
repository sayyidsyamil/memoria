import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { AppLocale } from '../lib/i18n'
import { takeFeedbackDialogOpener } from '../lib/feedbackDialogOpener'
import { APP_COMMAND_EVENT_NAME, APP_COMMAND_IDS } from '../hooks/appCommandDispatcher'

interface FeedbackDialogProps {
  open: boolean
  onClose: () => void
  buildNumber?: string
  locale?: AppLocale
  releaseChannel?: string | null
}

/** Retains the existing command/menu entry without upstream promotional content. */
export function FeedbackDialog({ open, onClose, buildNumber }: FeedbackDialogProps) {
  const close = () => {
    const opener = takeFeedbackDialogOpener()
    onClose()
    // Let the modal and command-palette focus scopes finish closing first.
    setTimeout(() => {
      if (opener.reopenCommandPalette) {
        window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT_NAME, { detail: APP_COMMAND_IDS.viewCommandPalette }))
      } else if (opener.element?.isConnected) {
        opener.element.focus()
      }
    }, 100)
  }
  return (
    <Dialog open={open} onOpenChange={value => { if (!value) close() }}>
      <DialogContent className="sm:max-w-[420px]" data-testid="feedback-dialog">
        <DialogHeader>
          <DialogTitle>Memoria</DialogTitle>
          <DialogDescription>Agentic Memory for Meeting Intelligence</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground">
          {buildNumber && <p>{buildNumber}</p>}
          <p>FYP2 · Sayyid Syamil · Universiti Malaya</p>
          <p>
            Based on Tolaria by Luca Rossi / Refactoring and contributors.
            Distributed under AGPL-3.0-or-later.
          </p>
          <a className="underline underline-offset-4" href="https://github.com/refactoringhq/tolaria" target="_blank" rel="noreferrer">
            Tolaria · upstream source
          </a>
        </div>
      </DialogContent>
    </Dialog>
  )
}
