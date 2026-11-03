import { invoke } from '@tauri-apps/api/core'
import type { PreparedSource } from '../../lib/sourceImport'

export interface RecordingMetadata { title: string; created: string; mimeType: string; sourceKind: 'microphone' | 'replay' }
export interface RecoverableRecording { sessionId: string; metadata: RecordingMetadata; chunkCount: number; byteLength: number; warnings: string[] }
export interface SavedRecording extends RecoverableRecording { originalPath: string; sha256: string; interrupted: boolean }
export interface RecordingList { recordings: RecoverableRecording[]; activeRecording: boolean }

function candidate(value: unknown): value is RecoverableRecording {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<RecoverableRecording>
  return typeof item.sessionId === 'string' && typeof item.metadata?.title === 'string' && typeof item.metadata.created === 'string'
    && typeof item.metadata.mimeType === 'string' && ['microphone', 'replay'].includes(String(item.metadata.sourceKind))
    && Number.isInteger(item.chunkCount) && Number(item.chunkCount) > 0 && Number.isSafeInteger(item.byteLength) && Number(item.byteLength) > 0
    && Array.isArray(item.warnings) && item.warnings.every(warning => typeof warning === 'string')
}
export const recordingService = {
  begin(vaultPath: string, sessionId: string, metadata: RecordingMetadata) {
    return invoke('begin_meeting_recording', { vaultPath, sessionId, metadata })
  },
  async finalize(vaultPath: string, sessionId: string, expectedChunks?: number): Promise<SavedRecording> {
    const result = await invoke<unknown>('finalize_meeting_recording', { vaultPath, sessionId, expectedChunks })
    if (!candidate(result) || !('originalPath' in result) || typeof result.originalPath !== 'string'
      || !result.originalPath.startsWith(`${vaultPath.replace(/\/$/, '')}/`) || !('sha256' in result) || typeof result.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(result.sha256) || !('interrupted' in result) || typeof result.interrupted !== 'boolean' || result.sessionId !== sessionId) {
      throw new Error('The recording service did not confirm the original audio. Existing checkpoints are retained.')
    }
    return result as SavedRecording
  },
  async list(vaultPath: string): Promise<RecordingList> {
    const result = await invoke<unknown>('list_recoverable_recordings', { vaultPath })
    if (!result || typeof result !== 'object' || !('recordings' in result) || !Array.isArray(result.recordings)
      || !result.recordings.every(candidate) || !('activeRecording' in result) || typeof result.activeRecording !== 'boolean') {
      throw new Error('Recoverable recordings could not be loaded.')
    }
    return result as RecordingList
  },
  complete(vaultPath: string, sessionId: string, sourcePath: string) {
    return invoke('complete_meeting_recording', { vaultPath, sessionId, sourcePath })
  },
  /**
   * The file the meeting player loads: for a browser recording, a copy that states its length, so the player can show
   * it and seek. The app also lets the player read it, as recordings are kept in a hidden folder.
   */
  async playback(vaultPath: string, audioPath: string): Promise<string> {
    const path = await invoke<unknown>('prepare_meeting_playback', { vaultPath, audioPath })
    return typeof path === 'string' && path ? path : audioPath
  },
}

/** `callAudio`: audio playing on this Mac was heard and mixed into the recording for at least part of the meeting. */
export function recordingSource(recording: SavedRecording, callAudio = false): PreparedSource {
  const extension = recording.metadata.mimeType.includes('webm') ? 'webm' : 'm4a'
  return {
    id: recording.sessionId, title: recording.metadata.title, filename: `meeting-${recording.sessionId}.${extension}`,
    originalPath: recording.originalPath, sha256: recording.sha256, bytes: new Uint8Array(), importedAt: recording.metadata.created,
    pages: [recording.metadata.sourceKind === 'replay'
      ? 'Native recording of prerecorded test audio. No microphone was used. Review the transcript before approving knowledge.'
      : callAudio
        ? 'Original recording of the microphone and of audio played on this Mac while Call audio was on, such as the other side of a call. Review the transcript before approving knowledge.'
        : 'Original microphone recording. Review the transcript before approving knowledge.'],
  }
}
