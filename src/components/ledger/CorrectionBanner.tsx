import { PencilSimple } from '@phosphor-icons/react'
import { correctionBanner, type Correction } from '../../lib/ledgerCorrection'

export function CorrectionBanner({ correction }: { correction: Correction }) {
  return (
    <div role="note" className="flex items-start gap-2 rounded-md border border-border bg-muted/60 p-3 text-sm text-foreground">
      <PencilSimple size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 break-words">{correctionBanner(correction)}</div>
    </div>
  )
}
