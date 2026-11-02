import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { LiveAskPanel } from './LiveAskPanel'
import type { LiveAskResult } from './liveAskService'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
beforeEach(() => { vi.mocked(invoke).mockReset() })
const empty: LiveAskResult = { sections: [], citations: [], warnings: [] }
function open(sessionText = 'Maya: Pilot is Thursday.') {
  const view = render(<LiveAskPanel vaultPath="/vault" sessionText={sessionText} />)
  fireEvent.click(screen.getByRole('button', { name: 'Ask this meeting' }))
  return view
}
function type(question: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Meeting question' }), { target: { value: question } })
}

it('requires explicit disclosure and submission, labels provisional context, and rejects blank questions', () => {
  render(<LiveAskPanel vaultPath="/vault" sessionText="" />)
  expect(screen.getByRole('button', { name: 'Ask this meeting' })).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(invoke).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Ask this meeting' }))
  expect(screen.getByText(/This session is not durable approved evidence/)).toBeInTheDocument()
  expect(screen.getByText(/Provisional transcript: not available yet/)).toBeInTheDocument()
  type('  ')
  expect(screen.getByRole('button', { name: 'Ask', exact: true })).toBeDisabled()
  fireEvent.submit(screen.getByRole('form', { name: 'Ask this meeting' }))
  expect(invoke).not.toHaveBeenCalled()
})

it('submits the trimmed question with the latest bounded session text and vault', async () => {
  vi.mocked(invoke).mockResolvedValue(empty)
  open('older context'.repeat(600) + 'Maya: Thursday.')
  type('  When is the pilot?  ')
  fireEvent.click(screen.getByRole('button', { name: 'Ask', exact: true }))
  await screen.findByText('No supporting evidence found.')
  expect(invoke).toHaveBeenCalledExactlyOnceWith('live_ask', {
    vaultPath: '/vault', question: 'When is the pilot?',
    sessionText: ('older context'.repeat(600) + 'Maya: Thursday.').slice(-5000),
    jobId: expect.any(String),
  })
})

it('blocks duplicate clicks and same-batch form submits until the request settles', async () => {
  let resolve!: (answer: LiveAskResult) => void
  vi.mocked(invoke).mockImplementation(() => new Promise<LiveAskResult>(done => { resolve = done }))
  open(); type('Who owns it?')
  const form = screen.getByRole('form', { name: 'Ask this meeting' })
  act(() => { fireEvent.submit(form); fireEvent.submit(form) })
  const button = screen.getByRole('button', { name: 'Asking…' })
  fireEvent.click(button); fireEvent.click(button)
  expect(button).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent('Asking this meeting…')
  expect(invoke).toHaveBeenCalledTimes(1)
  await act(async () => { resolve(empty) })
  expect(screen.getByRole('button', { name: 'Ask', exact: true })).toBeEnabled()
})

it.each([new Error('Worker unavailable'), 'Backend refused request'])('shows backend errors and allows retry: %s', async failure => {
  vi.mocked(invoke).mockRejectedValueOnce(failure).mockResolvedValueOnce(empty)
  open(); type('Launch date?')
  fireEvent.click(screen.getByRole('button', { name: 'Ask', exact: true }))
  expect(await screen.findByRole('alert')).toHaveTextContent(failure instanceof Error ? failure.message : failure)
  expect(screen.getByRole('textbox')).toHaveValue('Launch date?')
  fireEvent.click(screen.getByRole('button', { name: 'Ask', exact: true }))
  await screen.findByText('No supporting evidence found.')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(invoke).toHaveBeenCalledTimes(2)
})

it('renders engine sections, warnings and review notices and discloses exact citation quotes', async () => {
  vi.mocked(invoke).mockResolvedValue({
    sections: [
      { heading: 'Approved knowledge', items: [{ text: 'Pilot is planned.', citations: ['R1'] }] },
      { heading: 'Provisional transcript (not approved)', items: [{ text: 'Thursday was mentioned in this session.', citations: [] }] },
    ],
    citations: [{ id: 'R1', quote: 'Maya approved the pilot.', sourceTitle: 'Pilot kickoff', sourcePath: 'sources/pilot.md', page: 2 }],
    warnings: ['Transcript may contain recognition errors.'], needsReview: [{ sourcePath: 'old.md', sourceTitle: 'Old source' }],
  } satisfies LiveAskResult)
  open(); type('Pilot?'); fireEvent.click(screen.getByRole('button', { name: 'Ask', exact: true }))
  expect(await screen.findByRole('heading', { name: 'Approved knowledge' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Provisional transcript (not approved)' })).toBeInTheDocument()
  expect(screen.getByText('Thursday was mentioned in this session.')).toBeInTheDocument()
  expect(screen.getByText('Transcript may contain recognition errors.')).toBeInTheDocument()
  expect(screen.getByText(/Old source needs review/)).toBeInTheDocument()
  expect(screen.queryByText('Maya approved the pilot.')).not.toBeInTheDocument()
  const cite = screen.getByRole('button', { name: 'Evidence R1: Pilot kickoff, page 2' })
  fireEvent.click(cite)
  expect(cite).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText('Maya approved the pilot.')).toBeInTheDocument()
  expect(screen.getByText(/sources\/pilot.md/)).toBeInTheDocument()
  fireEvent.click(cite)
  expect(cite).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('Maya approved the pilot.')).not.toBeInTheDocument()
})

it('uses the current transcript on each explicit question and keeps disclosure changes request-free', async () => {
  vi.mocked(invoke).mockResolvedValue(empty)
  const { rerender } = open('Early turn')
  type('Status?'); fireEvent.click(screen.getByRole('button', { name: 'Ask', exact: true }))
  await screen.findByText('No supporting evidence found.')
  rerender(<LiveAskPanel vaultPath="/vault" sessionText="New turn" />)
  fireEvent.click(screen.getByRole('button', { name: 'Ask this meeting' }))
  fireEvent.click(screen.getByRole('button', { name: 'Ask this meeting' }))
  expect(invoke).toHaveBeenCalledTimes(1)
  type('Now?'); fireEvent.submit(screen.getByRole('form', { name: 'Ask this meeting' }))
  await waitFor(() => expect(invoke).toHaveBeenLastCalledWith('live_ask', { vaultPath: '/vault', question: 'Now?', sessionText: 'New turn', jobId: expect.any(String) }))
  await screen.findByText('No supporting evidence found.')
})

it('discards late answers after the vault changes', async () => {
  let resolve!: (answer: LiveAskResult) => void
  vi.mocked(invoke).mockImplementation(command => command === 'cancel_wiki_memory' ? Promise.resolve() : new Promise<LiveAskResult>(done => { resolve = done }))
  const { rerender } = open(); type('Old vault?')
  fireEvent.click(screen.getByRole('button', { name: 'Ask', exact: true }))
  rerender(<LiveAskPanel vaultPath="/other" sessionText="Other meeting" />)
  await act(async () => { resolve({ ...empty, message: 'Old vault answer' }) })
  fireEvent.click(screen.getByRole('button', { name: 'Ask this meeting' }))
  expect(screen.queryByText('Old vault answer')).not.toBeInTheDocument()
  expect(screen.getByRole('textbox')).toHaveValue('')
})

it('End disables and cancels the owned request, ignoring a late answer', async () => {
  let resolve!: (answer: LiveAskResult) => void
  vi.mocked(invoke).mockImplementation(command => command === 'cancel_wiki_memory' ? Promise.resolve() : new Promise<LiveAskResult>(done => { resolve = done }))
  const { rerender } = open()
  type('Supplier?'); fireEvent.submit(screen.getByRole('form', { name: 'Ask this meeting' }))
  const request = vi.mocked(invoke).mock.calls[0][1] as { jobId: string }
  rerender(<LiveAskPanel vaultPath="/vault" sessionText="Final turn" enabled={false} />)
  expect(invoke).toHaveBeenCalledWith('cancel_wiki_memory', { jobId: request.jobId })
  await act(async () => resolve({ ...empty, message: 'Late answer' }))
  expect(screen.queryByText('Late answer')).not.toBeInTheDocument()
  expect(screen.getByRole('textbox')).toBeDisabled()
})

it('unmount cancels the request using the same caller-owned job ID', () => {
  vi.mocked(invoke).mockImplementation(command => command === 'cancel_wiki_memory' ? Promise.resolve() : new Promise(() => undefined))
  const { unmount } = open(); type('Owner?')
  fireEvent.submit(screen.getByRole('form', { name: 'Ask this meeting' }))
  const request = vi.mocked(invoke).mock.calls[0][1] as { jobId: string }
  unmount()
  expect(invoke).toHaveBeenCalledWith('cancel_wiki_memory', { jobId: request.jobId })
})
