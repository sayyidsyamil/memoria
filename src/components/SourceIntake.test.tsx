import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { SourceIntake } from './SourceIntake'
import { readImportQueue, writeImportQueue } from '../lib/sourceImportQueue'
import { applySource } from '../lib/sourceImport'
import { openNoteInNewWindow } from '../utils/openNoteWindow'
import { invoke } from '@tauri-apps/api/core'

vi.mock('../lib/sourceImportQueue', () => ({ readImportQueue: vi.fn(), writeImportQueue: vi.fn() }))
vi.mock('../lib/sourceImport', () => ({ applySource: vi.fn(), prepareSource: vi.fn() }))
vi.mock('../utils/openNoteWindow', () => ({ openNoteInNewWindow: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => undefined) }))

const pending = { id: 'one', name: 'Report.pdf', state: 'review' as const,
  source: { id: 'one', filename: 'Report.pdf', title: 'Report', sha256: 'abc', bytes: new Uint8Array([1]), pages: ['Evidence from page one'] } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(readImportQueue).mockResolvedValue([pending])
  vi.mocked(writeImportQueue).mockResolvedValue()
  vi.mocked(applySource).mockResolvedValue('source-Report-one.md')
  vi.mocked(openNoteInNewWindow).mockResolvedValue()
})

it('restores a pending review, applies it, and opens the saved source', async () => {
  render(<SourceIntake vaultPath="/vault" />)
  await screen.findByRole('button', { name: /Import files/ })
  await waitFor(() => expect(screen.getByText('Import files (1 to review)')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'Import files' }))
  expect(await screen.findByText('Evidence from page one')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Import only' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Open source' }))
  await waitFor(() => expect(openNoteInNewWindow).toHaveBeenCalledWith('/vault/source-Report-one.md', '/vault', 'Report.pdf'))
  expect(writeImportQueue).toHaveBeenCalledWith('/vault', [expect.objectContaining({ state: 'saved', sourcePath: 'source-Report-one.md', source: undefined })])
})

it('recovers interrupted saves as reviews and does not overwrite an unreadable queue', async () => {
  vi.mocked(readImportQueue).mockResolvedValueOnce([{ ...pending, state: 'saving' }])
  const first = render(<SourceIntake vaultPath="/vault" />)
  await screen.findByText('Import files (1 to review)')
  first.unmount()
  vi.mocked(readImportQueue).mockRejectedValueOnce(new Error('Storage unavailable'))
  render(<SourceIntake vaultPath="/vault" />)
  fireEvent.click(screen.getByRole('button', { name: 'Import files' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not read saved imports')
  expect(screen.getByRole('button', { name: 'Choose files' })).toBeDisabled()
  expect(writeImportQueue).not.toHaveBeenCalled()
})

it('highlights the drop zone while files are dragged over it', async () => {
  vi.mocked(readImportQueue).mockResolvedValue([])
  render(<SourceIntake vaultPath="/vault" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Import files' }))
  const zone = (await screen.findByText('Drop documents here')).closest('[data-dragging]') as HTMLElement
  expect(zone).toHaveAttribute('data-dragging', 'false')
  fireEvent.dragOver(zone, { dataTransfer: { types: ['Files'] } })
  expect(zone).toHaveAttribute('data-dragging', 'true')
  fireEvent.dragLeave(zone)
  expect(zone).toHaveAttribute('data-dragging', 'false')
})
it('imports then opens knowledge building directly without publishing unreviewed claims', async () => {
  vi.mocked(invoke).mockResolvedValue([])
  render(<SourceIntake vaultPath="/vault" />)
  await screen.findByText('Import files (1 to review)')
  fireEvent.click(screen.getByRole('button', { name: 'Import files' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Import & build knowledge' }))
  await screen.findByRole('dialog', { name: 'Review knowledge' })
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('wiki_memory', { request: expect.objectContaining({ action: 'compile', sourcePath: 'source-Report-one.md', vaultPath: '/vault' }) }))
  expect(vi.mocked(invoke).mock.calls.some(([, args]) => (args as { request?: { action: string } })?.request?.action === 'apply')).toBe(false)
})
