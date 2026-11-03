import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { MemoryAsk } from './MemoryAsk'
import { openNoteInNewWindow } from '../utils/openNoteWindow'
import type { ManualCorrectionCitation } from '../lib/citations'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => undefined) }))
vi.mock('../utils/openNoteWindow', () => ({ openNoteInNewWindow: vi.fn(async () => undefined) }))
beforeEach(() => { vi.mocked(invoke).mockReset() })
const type = (value: string) => fireEvent.change(screen.getByRole('textbox', { name: 'Question or meeting topic' }), { target: { value } })

it('answers and briefs inline as a conversation, without another dialog', async () => {
  vi.mocked(invoke).mockResolvedValue({ sections: [], citations: [], warnings: [], message: 'No reviewed evidence yet' })
  render(<MemoryAsk vaultPath="/vault" />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  type('Harbour launch')
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
  expect(await screen.findByText('No reviewed evidence yet')).toBeInTheDocument()
  expect(screen.getByText('Harbour launch')).toBeInTheDocument()
  expect(invoke).toHaveBeenLastCalledWith('wiki_memory', { request: { action: 'ask', question: 'Harbour launch', vaultPath: '/vault', jobId: expect.any(String) } })
  fireEvent.click(screen.getByRole('button', { name: 'Brief' }))
  type('Harbour launch')
  fireEvent.click(screen.getByRole('button', { name: 'Create brief' }))
  await waitFor(() => expect(screen.getAllByText('No reviewed evidence yet')).toHaveLength(2))
  expect(invoke).toHaveBeenLastCalledWith('wiki_memory', { request: { action: 'brief', question: 'Harbour launch', vaultPath: '/vault', jobId: expect.any(String) } })
})
it('labels answers that come from the decision board', async () => {
  vi.mocked(invoke).mockResolvedValue({ sections: [{ heading: 'Answer', items: [{ text: 'The current supplier for Pilot is Beta (decided 20 Oct 2026, 13:42).', citations: ['R1'] }] }],
    citations: [{ id: 'R1', sourcePath: 'review.md', sourceTitle: 'Supplier review — reviewed transcript', page: 1, quote: 'We decided to use Beta as supplier.',
      moment: { meetingId: 'm2', meetingTitle: 'Supplier review', at: 17.29 } }],
    warnings: [], source: 'tracked-facts', retrieval: 'Tracked facts · Pilot — supplier · current value' })
  render(<MemoryAsk vaultPath="/vault" />)
  type('Which supplier do we use now?'); fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
  expect(await screen.findByText(/The current supplier for Pilot is Beta/)).toBeInTheDocument()
  expect(screen.getByText('From the decision board · Pilot — supplier · current value')).toBeInTheDocument()
})
it('keeps earlier questions in the thread and scopes answers to one meeting', async () => {
  vi.mocked(invoke).mockResolvedValue({ sections: [{ heading: 'Answer', items: [{ text: 'Thursday.', citations: [] }] }], citations: [], warnings: [] })
  render(<MemoryAsk vaultPath="/vault" scope={['reviewed.md']} placeholder="Ask about this meeting…" />)
  expect(screen.getByPlaceholderText('Ask about this meeting…')).toBeInTheDocument()
  type('When is the pilot?'); fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
  await screen.findByText('Thursday.')
  type('Who owns it?'); fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
  await waitFor(() => expect(screen.getAllByText('Thursday.')).toHaveLength(2))
  expect(screen.getByText('When is the pilot?')).toBeInTheDocument()
  expect(invoke).toHaveBeenLastCalledWith('wiki_memory', { request: { action: 'ask', question: 'Who owns it?', vaultPath: '/vault', scope: ['reviewed.md'], jobId: expect.any(String) } })
})
it('offers rebuilding relevant stale evidence instead of displaying an old answer', async () => {
  vi.mocked(invoke).mockResolvedValue({ sections: [], citations: [], warnings: [],
    message: 'Relevant reviewed evidence has changed.', needsReview: [{ sourcePath: 'later.md', sourceTitle: 'Later review' }] })
  render(<MemoryAsk vaultPath="/vault" />)
  type('Current launch date'); fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
  expect(await screen.findByText('Later review needs review')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Build knowledge' })).toBeInTheDocument()
})
it('saves a generated brief with its original topic even after the input changes', async () => {
  vi.mocked(invoke).mockResolvedValueOnce({ sections: [{ heading: 'Context', items: [{ text: 'Launch Thursday', citations: ['C1'] }] }], citations: [{ id: 'C1', sourcePath: 'source.md', sourceTitle: 'Meeting', page: 1, quote: 'Launch Thursday' }], warnings: [] })
    .mockResolvedValueOnce({ pagePath: 'briefs/pilot.md' })
  render(<MemoryAsk vaultPath="/vault" briefOnly />)
  type('Pilot')
  fireEvent.click(screen.getByText('Create brief'))
  await screen.findByText('Save brief')
  type('Different topic')
  fireEvent.click(screen.getByText('Save brief'))
  await screen.findByText('Open saved brief')
  expect(invoke).toHaveBeenLastCalledWith('wiki_memory', { request: expect.objectContaining({ action: 'save_brief', topic: 'Pilot', vaultPath: '/vault', prepared: expect.any(String) }) })
})
it('hides empty brief sections and reveals the exact quote behind a citation chip', async () => {
  vi.mocked(invoke).mockResolvedValueOnce({ sections: [{ heading: 'Context', items: [{ text: 'Launch Thursday', citations: ['R1'] }] }, { heading: 'Recent updates', items: [] }, { heading: 'Risks and open questions', items: [] }],
    citations: [{ id: 'R1', sourcePath: 'source.md', sourceTitle: 'Meeting A', page: 2, quote: 'Maya confirmed Thursday.', moment: { meetingId: 'm1', meetingTitle: 'Pilot kickoff', at: 20 } }], warnings: [] })
  const open = vi.fn()
  render(<MemoryAsk vaultPath="/vault" briefOnly onOpenMoment={open} />)
  type('Pilot'); fireEvent.click(screen.getByText('Create brief'))
  await screen.findByText(/Launch Thursday/)
  expect(screen.getByRole('heading', { name: 'Context' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Recent updates' })).not.toBeInTheDocument()
  expect(screen.getByText(/Nothing recorded in approved knowledge for: Recent updates, Risks and open questions/)).toBeInTheDocument()
  expect(screen.queryByText('Maya confirmed Thursday.')).not.toBeInTheDocument()
  const chip = screen.getByRole('button', { name: 'Quote from Pilot kickoff at 0:20' })
  expect(chip).toHaveTextContent('Pilot kickoff0:20')
  fireEvent.click(chip)
  expect(screen.getByText('Maya confirmed Thursday.')).toBeInTheDocument()
  // A quote with a recording time needs no page number: a transcript has none.
  expect(screen.getByText('Meeting A')).toBeInTheDocument()
  expect(screen.queryByText(/page 2/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Go to 0:20 in the transcript' }))
  expect(open).toHaveBeenCalledWith('m1', 20)
})
it('prefills the composer from a seed', () => {
  const { rerender } = render(<MemoryAsk vaultPath="/vault" briefOnly seed={{ text: 'Project Cedar', nonce: 1 }} />)
  expect(screen.getByRole('textbox', { name: 'Question or meeting topic' })).toHaveValue('Project Cedar')
  rerender(<MemoryAsk vaultPath="/vault" briefOnly seed={{ text: 'Harbour', nonce: 2 }} />)
  expect(screen.getByRole('textbox', { name: 'Question or meeting topic' })).toHaveValue('Harbour')
})
it('names a document citation by its page, and keeps a long meeting title readable', async () => {
  vi.mocked(invoke).mockResolvedValueOnce({ sections: [{ heading: 'Answer', items: [{ text: 'Thursday.', citations: ['D1', 'M1'] }] }],
    citations: [{ id: 'D1', sourcePath: 'plan.md', sourceTitle: 'Launch plan', page: 3, quote: 'Launch on Thursday.' },
      { id: 'M1', sourcePath: 't.md', sourceTitle: 'Transcript', page: 1, quote: 'Thursday it is.', moment: { meetingId: 'm', meetingTitle: 'Procurement pilot pre-launch review', at: 45 } }], warnings: [] })
  render(<MemoryAsk vaultPath="/vault" />)
  expect(screen.getByText('Answers cite their sources. Each question is answered on its own.')).toBeInTheDocument()
  type('When?'); fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
  expect(await screen.findByRole('button', { name: 'Quote from Launch plan, page 3' })).toHaveTextContent('Launch planp.3')
  expect(screen.getByRole('button', { name: 'Quote from Procurement pilot pre-launch review at 0:45' })).toHaveTextContent('Procurement pilot pre-launch review0:45')
})

it('discloses a manual owner correction alongside a quoted deadline and preserves both when saving', async () => {
  const reason = 'The chair confirmed the recorded owner should be Raj.'
  const manual: ManualCorrectionCitation = { id: 'T1', kind: 'manual-correction', factId: 18, objectId: 'training', attribute: 'owner', requiresCurrent: true,
    statement: 'Staff training owner: Raj.', correction: { reviewer: 'user', reason, replaced_fact_id: 7 },
    recordedAt: '2026-11-04T06:00:00Z', decidedAt: '2026-10-21T02:00:00Z', claimFrom: '2026-10-21T02:00:00Z', claimTo: null,
    originalContext: [{ sourcePath: 'training.md', sourceTitle: 'Training plan — reviewed transcript' }] }
  const result = { sections: [{ heading: 'Open commitments', items: [{ text: 'Staff training: owner Raj; due 3 Nov 2026.', citations: ['T1', 'T2'] }] }],
    citations: [manual, { id: 'T2', kind: 'tracked-fact', factId: 8, objectId: 'training', attribute: 'deadline', requiresCurrent: true,
      sourcePath: 'training.md', sourceTitle: 'Training plan — reviewed transcript', page: 1,
      quote: 'I will move training to 3 November. I stay the owner.', moment: { meetingId: 'm3', meetingTitle: 'Training plan', at: 20 } }], warnings: [] }
  vi.mocked(invoke).mockResolvedValueOnce(result).mockResolvedValueOnce({ pagePath: 'briefs/training.md' })
  const openMoment = vi.fn()
  render(<MemoryAsk vaultPath="/vault" briefOnly onOpenMoment={openMoment} />)
  type('Next steering committee'); fireEvent.click(screen.getByRole('button', { name: 'Create brief' }))
  const correction = await screen.findByRole('button', { name: 'Correction by you: Staff training owner: Raj.' })
  expect(correction).toHaveTextContent('Correction by youManual')
  fireEvent.click(correction)
  const note = screen.getByText(`Corrected by you: ${reason}`)
  expect(note.closest('blockquote')).toBeNull()
  expect(screen.getByText(/Correction recorded/)).toBeInTheDocument()
  expect(screen.getByText(/Original claim date/)).toBeInTheDocument()
  expect(screen.getByText('Original context only; not evidence for the corrected value.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Go to .* in the transcript/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Open original context: Training plan — reviewed transcript' }))
  expect(openNoteInNewWindow).toHaveBeenLastCalledWith('/vault/training.md', '/vault', 'Training plan — reviewed transcript')
  expect(openMoment).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Quote from Training plan at 0:20' }))
  expect(screen.getByText('I will move training to 3 November. I stay the owner.').closest('blockquote')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Go to 0:20 in the transcript' }))
  expect(openMoment).toHaveBeenCalledWith('m3', 20)
  fireEvent.click(screen.getByRole('button', { name: 'Save brief' }))
  await screen.findByRole('button', { name: 'Open saved brief' })
  expect(invoke).toHaveBeenLastCalledWith('wiki_memory', { request: expect.objectContaining({ action: 'save_brief', result }) })
})
