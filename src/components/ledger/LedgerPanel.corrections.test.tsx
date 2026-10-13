import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryEntry, LedgerFact } from '../../lib/ledgerApi'
import { requestOpenLedger } from '../../utils/memoriaWorkflow'
import { LedgerPanel } from '../LedgerPanel'
import { FACTS, freshState, HISTORY, makeEngine, type FakeState } from './fakeEngine'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))
vi.mock('../../mock-tauri', () => ({ isTauri: () => true, mockInvoke: vi.fn() }))

const BANNER = 'Corrected by Aisha: The year was wrong. The quote below is the original one and supports the earlier value.'
const [REPLACED, ORIGINAL_CURRENT] = HISTORY

const retractedByCorrection: HistoryEntry = { ...ORIGINAL_CURRENT, fact_id: 3, retracted: { tx: 9, by: 'Aisha', reason: 'corrected: The year was wrong' } }
const corrected = (over: Partial<HistoryEntry>): HistoryEntry => ({ ...ORIGINAL_CURRENT, fact_id: 8, value: '2026-12-20', change_type: 'REVISE', supersedes: null, ...over })

let state: FakeState

async function openGolive(history: HistoryEntry[], fact: Partial<LedgerFact>) {
  state = freshState()
  state.facts = [{ ...FACTS[0], ...fact }, FACTS[1]]
  const engine = makeEngine(state)
  invokeMock.mockReset().mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (!args) return undefined
    if (args.method !== 'facts.history') return engine(command, args)
    state.calls.push({ method: 'facts.history', params: {} })
    return history
  })
  render(<LedgerPanel vaultPath="/vault" entries={[]} onSaveNote={vi.fn()} />)
  act(() => requestOpenLedger())
  await screen.findByText('Go-live date')
}
const historyCalls = () => state.calls.filter((c) => c.method === 'facts.history').length

beforeEach(() => invokeMock.mockReset())
afterEach(cleanup)

describe('corrections in the Evidence dialog', () => {
  it('names who corrected the value and why (older engines: link plus retraction)', async () => {
    await openGolive([REPLACED, retractedByCorrection, corrected({ corrects: 3 })], { fact_id: 8, value: '2026-12-20', corrects: 3 })
    fireEvent.click(await screen.findByRole('button', { name: 'Evidence: Go-live date Date' }))
    const dialog = await screen.findByRole('dialog', { name: /Evidence: Go-live date/ })
    expect(await within(dialog).findByRole('note')).toHaveTextContent(BANNER)
  })

  it('uses the correction block when the engine provides it, without reading the history', async () => {
    await openGolive([], { fact_id: 8, value: '2026-12-20', corrects: 3, correction: { reviewer: 'Aisha', reason: 'The year was wrong', replaced_fact_id: 3 } })
    fireEvent.click(await screen.findByRole('button', { name: 'Evidence: Go-live date Date' }))
    const dialog = await screen.findByRole('dialog', { name: /Evidence: Go-live date/ })
    expect(within(dialog).getByRole('note')).toHaveTextContent(BANNER)
    expect(historyCalls()).toBe(0)
  })

  it('offers the history of a corrected value even when it never changed otherwise', async () => {
    await openGolive([], { fact_id: 8, value: '2026-12-20', n_changes: 0, corrects: 3, correction: { reviewer: 'Aisha', reason: 'The year was wrong', replaced_fact_id: 3 } })
    expect(await screen.findByRole('button', { name: 'History: Go-live date Date' })).toHaveTextContent('corrected')
  })

  it('shows no banner for a value nobody corrected', async () => {
    await openGolive([REPLACED, ORIGINAL_CURRENT], {})
    fireEvent.click(await screen.findByRole('button', { name: 'Evidence: Go-live date Date' }))
    const dialog = await screen.findByRole('dialog', { name: /Evidence: Go-live date/ })
    expect(within(dialog).queryByRole('note')).toBeNull()
    expect(historyCalls()).toBe(0)
  })
})

describe('corrections in the History timeline', () => {
  const stepText = 'Corrected by Aisha: The year was wrong'

  it('shows the correction as its own step (older engines)', async () => {
    await openGolive([REPLACED, retractedByCorrection, corrected({ corrects: 3 })], { fact_id: 8, value: '2026-12-20', corrects: 3 })
    fireEvent.click(await screen.findByRole('button', { name: 'History: Go-live date Date' }))
    const dialog = await screen.findByRole('dialog', { name: /History: Go-live date/ })
    const step = await within(dialog).findByRole('listitem', { name: 'Correction' })
    expect(step).toHaveTextContent(stepText)
    expect(step).toHaveTextContent('Was 15 Dec 2026')
    expect(within(dialog).getByText('Set aside by the correction below.')).toBeInTheDocument()
    expect(within(dialog).getByText('Corrected')).toBeInTheDocument()
  })

  it('shows the correction as its own step (new correction block)', async () => {
    const fixed = corrected({ corrects: 3, correction: { reviewer: 'Aisha', reason: 'The year was wrong', replaced_fact_id: 3 } })
    await openGolive([REPLACED, retractedByCorrection, fixed], { fact_id: 8, value: '2026-12-20', correction: fixed.correction })
    fireEvent.click(await screen.findByRole('button', { name: 'History: Go-live date Date' }))
    const dialog = await screen.findByRole('dialog', { name: /History: Go-live date/ })
    expect(await within(dialog).findAllByRole('listitem', { name: 'Correction' })).toHaveLength(1)
    expect(within(dialog).getByRole('listitem', { name: 'Correction' })).toHaveTextContent(stepText)
  })

  it('adds no correction step when nothing was corrected', async () => {
    await openGolive([REPLACED, ORIGINAL_CURRENT], {})
    fireEvent.click(await screen.findByRole('button', { name: 'History: Go-live date Date' }))
    const dialog = await screen.findByRole('dialog', { name: /History: Go-live date/ })
    await within(dialog).findByText('Changed')
    expect(within(dialog).queryByRole('listitem', { name: 'Correction' })).toBeNull()
  })
})
