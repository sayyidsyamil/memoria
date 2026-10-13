import type { LedgerFact } from '../../lib/ledgerApi'
import { attributeLabel, formatDateTime } from '../../lib/ledgerFormat'
import { correctionOf, needsHistoryForCorrection } from '../../lib/ledgerCorrection'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { CorrectionBanner } from './CorrectionBanner'
import { useLedger } from './ledgerContext'
import { useFactHistory } from './useFactHistory'
import { QuoteBlock } from './ui'

export function EvidenceDialog({ fact, valueText, onClose }: { fact: LedgerFact; valueText: string; onClose: () => void }) {
  const { meetingLabel } = useLedger()
  const decided = formatDateTime(fact.decided_at ?? fact.valid_from)
  const needsHistory = needsHistoryForCorrection(fact)
  const { entries, error } = useFactHistory(fact.object_id, fact.attribute, needsHistory)
  const correction = needsHistory && !entries && !error ? null : correctionOf(fact, entries)
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Evidence: {fact.label} &middot; {attributeLabel(fact.attribute)}</DialogTitle>
          <DialogDescription>Recorded value: <strong className="text-foreground">{valueText}</strong>{decided ? ` · decided ${decided}` : ''}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[55vh] gap-3 overflow-y-auto">
          {correction ? <CorrectionBanner correction={correction} /> : null}
          {fact.evidence.length === 0
            ? <p className="text-sm text-muted-foreground">No quote is stored for this value. Treat it with care and check it against the meeting.</p>
            : fact.evidence.map((e, i) => <QuoteBlock key={`${e.char_start}-${i}`} evidence={e} meetingLabel={meetingLabel(e.meeting)} />)}
        </div>
      </DialogContent>
    </Dialog>
  )
}
