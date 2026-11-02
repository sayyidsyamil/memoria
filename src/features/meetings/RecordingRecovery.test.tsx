import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { RecordingRecovery } from './RecordingRecovery'
import { meetingService, MeetingServiceError } from './meetingService'
import { recordingService, type SavedRecording } from './recordingService'
import { applySource } from '../../lib/sourceImport'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }))
vi.mock('./recordingService', async original => ({ ...await original<typeof import('./recordingService')>(),
  recordingService: { list: vi.fn(), finalize: vi.fn(), complete: vi.fn() },
}))
vi.mock('./meetingService', async original => ({ ...await original<typeof import('./meetingService')>(),
  meetingService: { get: vi.fn(), save: vi.fn() },
}))
vi.mock('../../lib/sourceImport', () => ({ applySource: vi.fn(async () => 'source.md') }))
const original: SavedRecording = {
  sessionId: 'session', metadata: { title: 'Interrupted test', created: '2026-11-02T00:00:00Z', mimeType: 'audio/mp4', sourceKind: 'replay' },
  chunkCount: 3, byteLength: 123, warnings: ['Container tail unverified.'], interrupted: true,
  originalPath: '/vault/.memoria-recordings/session/original.m4a', sha256: 'a'.repeat(64),
}
const record = { id: 'session', title: 'Interrupted test', pagePath: 'meetings/session.md', status: 'needs-review' as const }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(recordingService.list).mockResolvedValue({ recordings: [original], activeRecording: false })
  vi.mocked(recordingService.finalize).mockResolvedValue(original)
  vi.mocked(recordingService.complete).mockResolvedValue(undefined)
  vi.mocked(meetingService.get).mockRejectedValue(new MeetingServiceError({ code: 'MEETING_NOT_FOUND', message: 'Missing' }))
  vi.mocked(meetingService.save).mockResolvedValue(record)
  vi.mocked(invoke).mockResolvedValue(null)
})

it('recovers the same identity into review and marks publication only after saving source and record', async () => {
  const recovered = vi.fn()
  render(<RecordingRecovery vaultPath="/vault" active onRecovered={recovered} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Recover recording' }))
  await waitFor(() => expect(recovered).toHaveBeenCalledWith(record))
  expect(recordingService.finalize).toHaveBeenCalledWith('/vault', 'session')
  expect(applySource).toHaveBeenCalledWith(expect.objectContaining({ id: 'session', originalPath: original.originalPath, bytes: expect.any(Uint8Array) }), '/vault')
  expect(meetingService.save).toHaveBeenCalledWith('/vault', expect.objectContaining({ id: 'session', status: 'needs-review', audioPath: '.memoria-recordings/session/original.m4a', sourcePath: 'source.md' }))
  expect(recordingService.complete).toHaveBeenCalledWith('/vault', 'session', 'source.md')
  expect(vi.mocked(recordingService.complete).mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(meetingService.save).mock.invocationCallOrder[0])
})

it('does not overwrite a meeting whose transcript was already reviewed before interruption', async () => {
  const reviewed = { ...record, status: 'transcript-reviewed' as const, transcriptPath: 'reviewed.md', sourcePath: 'original-source.md' }
  vi.mocked(meetingService.get).mockResolvedValue(reviewed)
  const recovered = vi.fn()
  render(<RecordingRecovery vaultPath="/vault" active onRecovered={recovered} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Recover recording' }))
  await waitFor(() => expect(recovered).toHaveBeenCalledWith(reviewed))
  expect(meetingService.save).not.toHaveBeenCalled()
  expect(applySource).not.toHaveBeenCalled()
  expect(recordingService.complete).toHaveBeenCalledWith('/vault', 'session', 'original-source.md')
})

it('retains recoverable evidence and refuses a completion marker after publication failure', async () => {
  vi.mocked(meetingService.save).mockRejectedValue(new Error('write failed'))
  render(<RecordingRecovery vaultPath="/vault" active onRecovered={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Recover recording' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('write failed')
  expect(screen.getByRole('button', { name: 'Recover recording' })).toBeEnabled()
  expect(recordingService.complete).not.toHaveBeenCalled()
})

it('surfaces recovery-list failures instead of showing successful empty state', async () => {
  vi.mocked(recordingService.list).mockRejectedValue(new Error('journal unreadable'))
  render(<RecordingRecovery vaultPath="/vault" active onRecovered={vi.fn()} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('journal unreadable')
  expect(screen.getByRole('button', { name: 'Retry recovery list' })).toBeInTheDocument()
})

it('will not offer recovery while the current HUD exists', async () => {
  vi.mocked(recordingService.list).mockResolvedValue({ recordings: [], activeRecording: true })
  render(<RecordingRecovery vaultPath="/vault" active onRecovered={vi.fn()} />)
  expect(await screen.findByText(/End or close the current meeting HUD/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Recover recording' })).not.toBeInTheDocument()
})
