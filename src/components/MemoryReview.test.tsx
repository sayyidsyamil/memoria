import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { MemoryReview } from './MemoryReview'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../utils/openNoteWindow', () => ({ openNoteInNewWindow: vi.fn() }))
const proposal = { id: 'one', status: 'pending', sourcePath: 'source.md', sourceTitle: 'Pilot review', retrieval: 'BM25',
  claims: [{ title: 'Launch date', kind: 'Decision', statement: 'Launch is 19 November.', quote: 'Maya confirmed 19 November.', evidenceId: 'E1', page: 1, targetPath: 'launch.md' }] }

it('shows evidence, saves reviewed changes, and moves completed work into history', async () => {
  vi.mocked(invoke).mockReset()
  vi.mocked(invoke).mockResolvedValueOnce([proposal])
    .mockResolvedValueOnce(proposal).mockResolvedValueOnce({ status: 'applied' }).mockResolvedValueOnce([{ ...proposal, status: 'applied' }])
  render(<MemoryReview vaultPath="/vault" />)
  fireEvent.click(screen.getByRole('button', { name: 'Review knowledge' }))
  expect(await screen.findByText('Maya confirmed 19 November.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByText('Changes saved to your knowledge. Existing text was preserved.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Show completed reviews' }))
  expect(screen.getByText('Saved')).toBeInTheDocument()
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('wiki_memory', { request: { action: 'apply', vaultPath: '/vault', sourcePath: undefined, id: 'one' } }))
})

it('offers to rebuild a stale review from the global list', async () => {
  vi.mocked(invoke).mockReset()
  vi.mocked(invoke).mockResolvedValueOnce([proposal]).mockResolvedValueOnce(proposal)
    .mockRejectedValueOnce('knowledge/launch.md changed since compilation. Compile again; your edits were preserved.')
    .mockResolvedValueOnce({ ...proposal, id: 'two' }).mockResolvedValueOnce([{ ...proposal, id: 'two' }, { ...proposal, status: 'stale' }])
  render(<MemoryReview vaultPath="/vault" />)
  fireEvent.click(screen.getByRole('button', { name: 'Review knowledge' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Save changes' }))
  expect(await screen.findByText(/changed since compilation/)).toBeInTheDocument()
  fireEvent.click(await screen.findByRole('button', { name: 'Rebuild this review' }))
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('wiki_memory', { request: { action: 'compile', vaultPath: '/vault', sourcePath: 'source.md', id: undefined, jobId: expect.any(String) } }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Rebuild this review' })).not.toBeInTheDocument())
})
it('shows one source at a time while keeping the others selectable', async () => {
  vi.mocked(invoke).mockReset()
  const other = { ...proposal, id: 'other', sourceTitle: 'Budget review', claims: [{ ...proposal.claims[0], quote: 'Budget evidence' }] }
  vi.mocked(invoke).mockResolvedValue([proposal, other])
  render(<MemoryReview vaultPath="/vault" />)
  fireEvent.click(screen.getByRole('button', { name: 'Review knowledge' }))
  await screen.findByText('Maya confirmed 19 November.')
  expect(screen.queryByText('Budget evidence')).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('combobox', { name: 'Choose source to review' }), { target: { value: 'other' } })
  expect(screen.getByText('Budget evidence')).toBeInTheDocument()
  expect(screen.queryByText('Maya confirmed 19 November.')).not.toBeInTheDocument()
})

it('reviews in place and keeps saved claims visible, without opening another dialog', async () => {
  vi.mocked(invoke).mockReset()
  vi.mocked(invoke).mockResolvedValueOnce([proposal]).mockResolvedValueOnce(proposal).mockResolvedValueOnce({ status: 'applied' })
    .mockResolvedValueOnce([{ ...proposal, status: 'applied' }])
  render(<MemoryReview vaultPath="/vault" sourcePath="source.md" inline autoOpen buildOnOpen={false} />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(await screen.findByText('Maya confirmed 19 November.')).toBeInTheDocument()
  expect(invoke).not.toHaveBeenCalledWith('wiki_memory', { request: expect.objectContaining({ action: 'compile' }) })
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByText('Saved')).toBeInTheDocument()
  expect(screen.getByText('Maya confirmed 19 November.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Undo saved changes' })).toBeInTheDocument()
})
it('offers a build action for a reviewed transcript that has no proposals yet', async () => {
  vi.mocked(invoke).mockReset()
  vi.mocked(invoke).mockResolvedValue([])
  render(<MemoryReview vaultPath="/vault" sourcePath="source.md" inline />)
  expect(screen.getByText('No outcomes proposed yet')).toBeInTheDocument()
  expect(invoke).not.toHaveBeenCalled()
})
