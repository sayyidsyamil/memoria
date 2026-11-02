import { invoke } from '@tauri-apps/api/core'
import { clockText } from '../../lib/hud'
import { speakerLabel, speakerOrder } from '../../lib/speakers'

// Mirrors MemoryAsk's existing engine response; the live action adds no durable writes.
export interface LiveAskCitation {
  id: string; quote: string; sourceTitle: string; sourcePath: string; page: number
}
export interface LiveAskResult {
  /** `live` items come from this meeting's unreviewed transcript, never from approved knowledge. */
  sections: { heading: string; items: { text: string; citations: string[]; live?: boolean }[] }[]
  citations: LiveAskCitation[]
  warnings: string[]
  message?: string
  needsReview?: { sourcePath: string; sourceTitle: string }[]
}

export function askLiveMeeting(vaultPath: string, question: string, sessionText: string, jobId: string): Promise<LiveAskResult> {
  // The whole transcript, in order: the language model keeps it cached and reads only what is new since the last
  // question. The engine drops the oldest part of a very long meeting.
  return invoke('live_ask', { vaultPath, question: question.trim(), sessionText: sessionText.slice(-120000), jobId })
}

/** The live transcript as the language model reads it: one committed turn a line, with its time and speaker. */
export function meetingTranscript(turns: { start: number; speaker: string; text: string }[]): string {
  const order = speakerOrder(turns.map(turn => turn.speaker))
  return turns.map(turn => `[${clockText(Math.floor(turn.start))}] ${speakerLabel(turn.speaker, undefined, order)}: ${turn.text}`).join('\n')
}
