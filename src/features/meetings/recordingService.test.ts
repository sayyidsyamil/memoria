import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { recordingService, recordingSource, type SavedRecording } from './recordingService'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
beforeEach(() => vi.clearAllMocks())
const saved: SavedRecording = {
  sessionId: 'session', metadata: { title: 'Fictional test', created: '2026-11-02T00:00:00Z', mimeType: 'audio/mp4', sourceKind: 'replay' },
  originalPath: '/vault/.memoria-recordings/session/original.m4a', sha256: 'a'.repeat(64), byteLength: 3, chunkCount: 1, warnings: [], interrupted: false,
}
it('finalizes exactly the accepted checkpoint count without transporting an entire recording', async () => {
  vi.mocked(invoke).mockResolvedValue(saved)
  expect(await recordingService.finalize('/vault', 'session', 1)).toEqual(saved)
  expect(invoke).toHaveBeenCalledWith('finalize_meeting_recording', { vaultPath: '/vault', sessionId: 'session', expectedChunks: 1 })
  const source = recordingSource(saved)
  expect(source.bytes).toHaveLength(0)
  expect(source.originalPath).toBe(saved.originalPath)
  expect(source.importedAt).toBe(saved.metadata.created)
  expect(source.pages[0]).toContain('No microphone')
})
it.each([undefined, { ...saved, originalPath: '/other/private.m4a' }, { ...saved, sha256: 'invalid' }, { ...saved, sessionId: 'different' }])('rejects unconfirmed recording results: %s', async value => {
  vi.mocked(invoke).mockResolvedValue(value)
  await expect(recordingService.finalize('/vault', 'session', 1)).rejects.toThrow('did not confirm')
})
it('does not turn an unreadable recovery list into an empty success', async () => {
  vi.mocked(invoke).mockResolvedValue(undefined)
  await expect(recordingService.list('/vault')).rejects.toThrow('could not be loaded')
})
it('plays the copy the app prepared, or the recording itself when there is none', async () => {
  vi.mocked(invoke).mockResolvedValueOnce('/vault/.memoria-recordings/session/playback.webm')
  expect(await recordingService.playback('/vault', '/vault/.memoria-recordings/session/original.webm')).toBe('/vault/.memoria-recordings/session/playback.webm')
  expect(invoke).toHaveBeenCalledWith('prepare_meeting_playback', { vaultPath: '/vault', audioPath: '/vault/.memoria-recordings/session/original.webm' })
  vi.mocked(invoke).mockResolvedValueOnce(undefined)
  expect(await recordingService.playback('/vault', '/vault/audio.wav')).toBe('/vault/audio.wav')
})
