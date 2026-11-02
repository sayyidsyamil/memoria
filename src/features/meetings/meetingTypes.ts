/** Public meeting DTOs. No component or transport imports. */
export interface TranscriptTurn {
  start: number; end: number; speaker: string; text: string
  /** Original decoder interval is a replay anchor, not aligned retained-word timing. */
  contextTrimmed?: boolean; rawWindowText?: string; rawWindowStart?: number; rawWindowEnd?: number
  timingStatus?: 'unresolved-context-trim' | 'unresolved-live-text'
}
export interface SpeakerProfile { id: string; name: string }
export interface TranscriptDraft {
  gaps?: { start: number; end: number; reason: string }[]
  segments: TranscriptTurn[]; duration: number; warnings: string[]; text: string
  profiles?: SpeakerProfile[]
  speakerMatches?: Record<string, SpeakerProfile>
  audioAccounting?: { receivedChunks: number; receivedSamples: number; processedSamples: number; sampleRate: number }
  captionAudio?: { acceptedSamples: number; processedSamples: number; queuedSamples: number; refusedSamples: number; unacknowledgedSamples: number; sampleRate: number }
  liveChecks?: { checkedTurns: number; uncheckedTurns: number; warnings: string[] }
}
export interface MeetingMark { id?: string; at: number; label: string }
export type MeetingStatus = 'needs-review' | 'transcript-reviewed'
export type OutcomesStatus = 'approved' | 'needs-review' | 'not-built'
export interface MeetingRecord {
  id: string; title: string; status: MeetingStatus; pagePath: string; audioPath?: string
  sourcePath?: string; transcriptPath?: string | null; created?: string; updatedAt?: string
  outcomesStatus?: OutcomesStatus; draft?: TranscriptDraft | null
  turns?: TranscriptTurn[]; names?: Record<string, string>; profileIds?: Record<string, string>
  marks?: MeetingMark[]
}
/** Save is an explicit upsert: capture creates a record, review updates it. */
export type SaveMeetingInput = Pick<MeetingRecord, 'id' | 'status'> & Partial<Omit<MeetingRecord, 'id' | 'status' | 'pagePath' | 'updatedAt' | 'outcomesStatus'>>
export interface DeleteMeetingResult { deleted: boolean; id: string }
export type MeetingErrorCode = 'INVALID_REQUEST' | 'MEETING_NOT_FOUND' | 'MEETING_EXTERNALLY_MODIFIED' | 'WORKSPACE_UNAVAILABLE' | 'RUNTIME_UNAVAILABLE' | 'PERSISTENCE_FAILED' | 'INVALID_RESPONSE'
export interface MeetingApiError { code: MeetingErrorCode; message: string }
