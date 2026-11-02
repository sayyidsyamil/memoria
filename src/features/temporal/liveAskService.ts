import { invoke } from '@tauri-apps/api/core'

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
