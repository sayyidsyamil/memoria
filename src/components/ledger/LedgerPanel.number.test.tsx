import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Proposal } from '../../lib/ledgerApi'
import { requestOpenLedger } from '../../utils/memoriaWorkflow'
import { LedgerPanel } from '../LedgerPanel'
import { freshState, makeEngine, type FakeState } from './fakeEngine'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))
vi.mock('../../mock-tauri', () => ({ isTauri: () => true, mockInvoke: vi.fn() }))

const MISREAD: Proposal = {
  proposal_id: 11, object_id: 'budget', label: 'Pilot budget (RM)', attribute: 'amount', value: 2500000, current_value: 280000, confidence: 0.9,
  reason: 'the number is not in the quote', quote: 'Okay, the pilot budget is 250,000 ringgit. Raj, please note that down.', speaker: 'Aisha', meeting: 'transcripts/steering-1.md',
}

let state: FakeState
const callsOf = (method: string) => state.calls.filter((c) => c.method === method)

async function openReview(proposal: Proposal) {
  state = freshState()
  state.proposals = [proposal]
  const engine = makeEngine(state)
  invokeMock.mockReset().mockImplementation(async (command: string, args?: Record<string, unknown>) => (args ? engine(command, args) : undefined))
  render(<LedgerPanel vaultPath="/vault" entries={[]} onSaveNote={vi.fn()} />)
  act(() => requestOpenLedger({ tab: 'review' }))
  const text = await screen.findByText(/Memoria wants to record/)
  return text.closest('[aria-label^="Suggestion:"]') as HTMLElement
}

beforeEach(() => invokeMock.mockReset())
afterEach(cleanup)

describe('review card for a misread number', () => {
  it('says in plain words that the number is not in the quote', async () => {
    const card = await openReview(MISREAD)
    expect(within(card).getByText('The number 2,500,000 does not appear in the quote. Please check it.')).toBeInTheDocument()
    expect(within(card).queryByText(/differs from what is already recorded/)).toBeNull()
    expect(within(card).getByRole('button', { name: 'Accept' })).toBeEnabled()
  })

  it('does not claim something is recorded when nothing is (first value)', async () => {
    const card = await openReview({ ...MISREAD, current_value: null })
    expect(within(card).getByText(/Memoria wants to record/)).toHaveTextContent('Memoria wants to record 2,500,000. Nothing is recorded yet for Pilot budget (RM).')
    expect(within(card).queryByText(/is recorded now/)).toBeNull()
  })

  it('pre-fills the number written in the quote and accepts the corrected number', async () => {
    const card = await openReview(MISREAD)
    fireEvent.click(within(card).getByRole('button', { name: 'Edit then accept' }))
    const field = within(card).getByLabelText('Value to record') as HTMLInputElement
    expect(field.value).toBe('250000')
    fireEvent.click(within(card).getByRole('button', { name: 'Save and accept' }))
    await waitFor(() => expect(callsOf('proposals.accept')).toHaveLength(1))
    expect(callsOf('proposals.accept')[0].params).toEqual({ proposal_id: 11, edits: { value: 250000 } })
  })

  it('keeps the suggested number when the quote has no single big number', async () => {
    const card = await openReview({ ...MISREAD, quote: 'The budget is 250,000 now, up from 200,000 before.' })
    fireEvent.click(within(card).getByRole('button', { name: 'Edit then accept' }))
    expect((within(card).getByLabelText('Value to record') as HTMLInputElement).value).toBe('2500000')
  })

  it('leaves ordinary suggestions with their own wording and value', async () => {
    const card = await openReview({ ...MISREAD, reason: 'confirm_conflicts' })
    expect(within(card).getByText('This differs from what is already recorded, so it needs your decision.')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: 'Edit then accept' }))
    expect((within(card).getByLabelText('Value to record') as HTMLInputElement).value).toBe('2500000')
  })
})
