import { invoke } from '@tauri-apps/api/core'

// Mirrors MemoryAsk's existing engine response; the live action adds no durable writes.
export interface LiveAskCitation {
  id: string; quote: string; sourceTitle: string; sourcePath: string; page: number
}
export interface LiveAskResult {
  sections: { heading: string; items: { text: string; citations: string[] }[] }[]
  citations: LiveAskCitation[]
  warnings: string[]
  message?: string
  needsReview?: { sourcePath: string; sourceTitle: string }[]
}

export function askLiveMeeting(vaultPath: string, question: string, sessionText: string, jobId: string): Promise<LiveAskResult> {
  // Keep the most recent context, without retaining a second full transcript in UI state.
  return invoke('live_ask', { vaultPath, question: question.trim(), sessionText: sessionText.slice(-5000), jobId })
}
