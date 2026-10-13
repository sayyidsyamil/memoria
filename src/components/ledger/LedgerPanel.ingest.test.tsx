import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IngestResult } from '../../lib/ledgerApi'
import type { VaultEntry } from '../../types'
import { requestOpenLedger } from '../../utils/memoriaWorkflow'
import { LedgerPanel } from '../LedgerPanel'
import { freshState, makeEngine } from './fakeEngine'
import { PARSE_WARNING } from './ingestSummary'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))
vi.mock('../../mock-tauri', () => ({ isTauri: () => true, mockInvoke: vi.fn() }))

const ENTRIES = [{ path: '/vault/transcripts/steering-2.md', title: 'Steering 2', isA: 'Transcript', archived: false } as VaultEntry]

async function addMeeting(reply: Partial<IngestResult>) {
  const engine = makeEngine(freshState())
  invokeMock.mockReset().mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (!args) return undefined
    const result = await engine(command, args)
    return args.method === 'meetings.ingest' ? { ...(result as object), ...reply } : result
  })
  render(<LedgerPanel vaultPath="/vault" entries={ENTRIES} onSaveNote={vi.fn()} />)
  act(() => requestOpenLedger({ tab: 'meetings' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Add Steering 2' }))
}

beforeEach(() => invokeMock.mockReset())
afterEach(cleanup)

describe('Meetings tab: honest feedback after adding a meeting', () => {
  it('warns, and does not report success, when the model answer could not be fully read', async () => {
    await addMeeting({ counts: { applied: 0, proposed: 0 }, stats: { parsed_cleanly: false } })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(PARSE_WARNING)
    expect(alert).toHaveTextContent('Steering 2')
    expect(alert).toHaveTextContent('0 decisions and promises recorded, 0 waiting for your review, 0 ignored')
    await waitFor(() => expect(screen.queryByText(/Reading the meeting/)).toBeNull())
    expect(screen.queryByText('Added "Steering 2".')).toBeNull()
    expect(screen.getByText('Added "Steering 2", but some decisions may be missing.')).toBeInTheDocument()
  })

  it('shows the three counts and a truthful reason for each kind of ignored suggestion', async () => {
    await addMeeting({ counts: { applied: 2, proposed: 1, ungrounded: 1, invalid: 1, unresolved: 2 }, stats: { parsed_cleanly: true } })
    const status = await screen.findByText(/Steering 2: 2 decisions/)
    expect(status).toHaveTextContent('Steering 2: 2 decisions and promises recorded, 1 waiting for your review, 4 ignored.')
    expect(status).toHaveTextContent('1 suggestion ignored because the quoted words were not found in the transcript')
    expect(status).toHaveTextContent('1 suggestion ignored because its value or date could not be understood')
    expect(status).toHaveTextContent('2 suggestions ignored because it was not clear which tracked item it was about')
    expect(screen.queryByText(PARSE_WARNING)).toBeNull()
  })
})
