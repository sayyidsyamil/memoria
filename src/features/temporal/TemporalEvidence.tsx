import { clock } from '../../lib/speakers'
import { meetingLabel, readableDate, type MeetingTitles } from './temporalFormat'
import type { TemporalEvidence } from './temporalService'

/** A date for people, with the exact value kept in the `datetime` attribute. Text that is not a date is shown as written. */
export function TemporalDate({ value, time }: { value: string; time?: boolean }) {
  const date = readableDate(value, { time })
  return date ? <time dateTime={date.dateTime}>{date.label}</time> : <>{value}</>
}

/** The meeting's title; a meeting that cannot be found keeps a short label (see meetingLabel). */
export function MeetingName({ id, titles }: { id: string | null; titles: MeetingTitles }) {
  return <span className="board-meeting">{meetingLabel(id, titles)}</span>
}

export type OpenMoment = (meetingId: string, at: number) => void

/**
 * Who said it, in which meeting and when in the recording. The time opens the meeting there when the caller can open it.
 */
export function Citation({ source, titles, onOpenMoment }: { source: TemporalEvidence; titles: MeetingTitles; onOpenMoment?: OpenMoment }) {
  const at = source.audio_start
  const time = at != null && Number.isFinite(at) ? clock(at) : null
  const meeting = typeof source.meeting === 'string' && source.meeting.trim() ? source.meeting : null
  return <span className="board-cite">
    {source.speaker || 'Speaker not recorded'} · <MeetingName id={source.meeting} titles={titles} />
    {time && <> · {meeting && onOpenMoment
      ? <button type="button" className="board-time" aria-label={`Play ${meetingLabel(meeting, titles)} from ${time}`} onClick={() => onOpenMoment(meeting, at!)}>{time}</button>
      : <span className="board-time-text">{time}</span>}</>}
  </span>
}

/**
 * The words that set a value. `line` keeps the quote to one line (the full text stays on hover and for screen readers),
 * so a board row stays compact; reviews and history show the whole quote.
 */
export function Quote({ source, titles, onOpenMoment, line = false }: { source: TemporalEvidence; titles: MeetingTitles; onOpenMoment?: OpenMoment; line?: boolean }) {
  const quote = source.quote?.trim()
  return <p className="board-evidence" data-line={line || undefined}>
    {quote ? <q className="board-quote" title={line ? quote : undefined}>{quote}</q> : <span className="board-quote">No source quote recorded.</span>}
    <Citation source={source} titles={titles} onOpenMoment={onOpenMoment} />
  </p>
}
