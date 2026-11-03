import type { ManualCorrectionCitation } from '../lib/citations'
import { reviewerName } from '../features/temporal/temporalBoard'
import { TemporalDate } from '../features/temporal/TemporalEvidence'
import { Button } from './ui/button'

/** Manual provenance stays outside blockquotes and never offers transcript/audio playback. */
export function ManualCorrectionEvidence({ evidence, onOpenContext }: {
  evidence: ManualCorrectionCitation
  onOpenContext?: (path: string, title: string) => void
}) {
  return <>
    <p>{evidence.statement}</p>
    <p>Corrected by {reviewerName(evidence.correction.reviewer)}: {evidence.correction.reason}</p>
    <p>Correction recorded <TemporalDate value={evidence.recordedAt} time />.</p>
    <p>Original claim date <TemporalDate value={evidence.decidedAt} time />. Applies from <TemporalDate value={evidence.claimFrom} time />{evidence.claimTo && <> until <TemporalDate value={evidence.claimTo} time /></>}.</p>
    {evidence.originalContext.length > 0 && <footer>
      <span>Original context only; not evidence for the corrected value.</span>
      {evidence.originalContext.map(source => onOpenContext
        ? <Button key={source.sourcePath} type="button" variant="ghost" size="sm" onClick={() => onOpenContext(source.sourcePath, source.sourceTitle)}>Open original context: {source.sourceTitle}</Button>
        : <span key={source.sourcePath}>{source.sourceTitle}</span>)}
    </footer>}
  </>
}
