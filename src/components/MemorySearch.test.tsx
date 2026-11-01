import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { MemorySearch } from './MemorySearch'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const outcome = (patch = {}) => ({ query: 'churn', words: ['churn'], meetings: 3, speakers: ['Priya Nair', 'Unknown speaker', 'Sam'], claims: [], lines: [
  { meetingId: 'm1', title: 'Q3 churn review', created: '2026-08-14T10:00:00Z', reviewed: true, speaker: 'S01', label: 'Priya Nair', at: 1111, text: 'Net revenue churn landed at 3.1 percent, down from 4.4.' },
  { meetingId: 'm2', title: 'Board prep', created: '2026-07-29T10:00:00Z', reviewed: false, speaker: 'S02', label: 'Sam', at: 362, text: 'Lead with the churn number.' }], ...patch })
beforeEach(() => { vi.useFakeTimers(); vi.mocked(invoke).mockReset() })
afterEach(() => vi.useRealTimers())
const search = async (value: string) => { fireEvent.change(screen.getByRole('textbox', { name: 'Search meetings and approved knowledge' }), { target: { value } }); await act(async () => { await vi.advanceTimersByTimeAsync(300) }) }

it('shows a prompt until something is typed, then debounced results with highlights and moments', async () => {
  vi.mocked(invoke).mockResolvedValue(outcome())
  const open = vi.fn()
  render(<MemorySearch vaultPath="/vault" onOpenMoment={open} onOpenPage={vi.fn()} />)
  expect(screen.getByText('Search every meeting')).toBeInTheDocument()
  expect(invoke).not.toHaveBeenCalled()
  await search('churn')
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(invoke).toHaveBeenCalledWith('wiki_memory', { request: { action: 'search', vaultPath: '/vault', query: 'churn' } })
  expect(screen.getAllByText('churn', { selector: 'mark' })).toHaveLength(2)
  expect(screen.getByText('18:31')).toBeInTheDocument()
  expect(screen.getByText('Draft')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('2 lines · 0 approved claims · 3 meetings')
  fireEvent.click(screen.getByText('Q3 churn review').closest('button')!)
  expect(open).toHaveBeenCalledWith('m1', 1111)
})
it('filters by speaker and date range and hides the unknown speaker chip', async () => {
  vi.mocked(invoke).mockResolvedValue(outcome())
  render(<MemorySearch vaultPath="/vault" onOpenMoment={vi.fn()} onOpenPage={vi.fn()} />)
  await search('churn')
  expect(screen.queryByRole('button', { name: 'Unknown speaker' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Priya Nair' }))
  await act(async () => { await vi.advanceTimersByTimeAsync(300) })
  expect(invoke).toHaveBeenLastCalledWith('wiki_memory', { request: expect.objectContaining({ speaker: 'Priya Nair' }) })
  fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' }))
  await act(async () => { await vi.advanceTimersByTimeAsync(300) })
  expect(invoke).toHaveBeenLastCalledWith('wiki_memory', { request: expect.objectContaining({ speaker: 'Priya Nair', since: expect.any(String) }) })
})
it('lists matching approved claims and explains an empty result', async () => {
  vi.mocked(invoke).mockResolvedValueOnce(outcome({ lines: [], claims: [{ id: 'c1', title: 'Churn guardrail', pageTitle: 'Churn rules', kind: 'Decision', statement: 'Churn must stay under four percent.', sourcePath: 's.md', sourceTitle: 'Pricing review', knowledgePath: 'k.md', moment: { meetingId: 'm1', at: 14 } }] }))
    .mockResolvedValueOnce(outcome({ lines: [], claims: [] }))
  render(<MemorySearch vaultPath="/vault" onOpenMoment={vi.fn()} onOpenPage={vi.fn()} />)
  await search('churn')
  expect(screen.getByText('Approved knowledge')).toBeInTheDocument()
  expect(screen.getByText('Churn rules')).toBeInTheDocument()
  expect(screen.getByText('0:14')).toBeInTheDocument()
  await search('zebra')
  expect(screen.getByText('No matches')).toBeInTheDocument()
})
