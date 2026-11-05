import { invoke } from '@tauri-apps/api/core'
import { clockText } from '../../lib/hud'
import { speakerLabel, speakerOrder } from '../../lib/speakers'
import type { MemoryCitation } from '../../lib/citations'

// Mirrors MemoryAsk's existing engine response; the live action adds no durable writes.
export type LiveAskCitation = MemoryCitation
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

/** Brings the model's cached transcript up to date while a question is being typed, so the answer starts sooner. */
export function warmLiveMeeting(vaultPath: string, sessionText: string): Promise<unknown> {
  return invoke('live_ask', { vaultPath, question: '\u0000warm', sessionText: sessionText.slice(-120000), jobId: crypto.randomUUID() })
}
