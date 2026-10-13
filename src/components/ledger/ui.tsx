import type { ReactNode } from 'react'
import { CircleNotch, Warning } from '@phosphor-icons/react'
import { Button } from '../ui/button'
import type { LedgerEvidence } from '../../lib/ledgerApi'

export const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-12 text-center">
      <div className="text-[15px] font-semibold text-foreground">{title}</div>
      {children ? <div className="text-sm text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
      <Warning size={18} className="mt-0.5 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1 break-words">{message}</div>
      {onRetry ? <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button> : null}
    </div>
  )
}

export function WarningNotice({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-md border border-[var(--feedback-warning-border)] bg-[var(--feedback-warning-bg)] p-3 text-sm text-[var(--feedback-warning-text)]">
      <Warning size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  )
}

export function Busy({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
      <CircleNotch size={16} className="animate-spin" /> {label}
    </div>
  )
}

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: string }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

export function QuoteBlock({ evidence, meetingLabel }: { evidence: LedgerEvidence; meetingLabel: string }) {
  return (
    <figure className="m-0 rounded-md border border-border bg-muted/40 p-3">
      <blockquote className="m-0 text-sm leading-relaxed text-foreground">&ldquo;{evidence.quote}&rdquo;</blockquote>
      <figcaption className="mt-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{evidence.speaker}</span> in {meetingLabel}
        {evidence.audio_start != null ? ` at ${Math.floor(evidence.audio_start / 60)}:${String(Math.floor(evidence.audio_start % 60)).padStart(2, '0')}` : ''}
      </figcaption>
    </figure>
  )
}
