import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()
const mockInvokeMock = vi.fn()
let tauri = true

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))
vi.mock('../mock-tauri', () => ({ isTauri: () => tauri, mockInvoke: (...args: unknown[]) => mockInvokeMock(...args) }))

import { createLedgerApi, ledgerErrorKind, ledgerErrorMessage, LedgerError } from './ledgerApi'

beforeEach(() => {
  invokeMock.mockReset().mockResolvedValue({})
  mockInvokeMock.mockReset().mockResolvedValue({})
  tauri = true
})

describe('ledgerErrorMessage', () => {
  it('passes friendly Rust strings through unchanged', () => {
    expect(ledgerErrorMessage('Python 3.11 was not found at /opt/homebrew/bin/python3.11.')).toBe('Python 3.11 was not found at /opt/homebrew/bin/python3.11.')
  })

  it('reads the message of Error objects and plain {message} objects', () => {
    expect(ledgerErrorMessage(new Error('  disk full  '))).toBe('disk full')
    expect(ledgerErrorMessage({ message: 'bad value' })).toBe('bad value')
  })

  it('falls back to a readable sentence for empty or unknown errors', () => {
    for (const input of [undefined, null, '', '   ', {}, 42]) {
      expect(ledgerErrorMessage(input)).toMatch(/Something went wrong with the decision engine/)
    }
  })

  it('explains a missing command or browser preview without jargon', () => {
    expect(ledgerErrorMessage('Command ledger_call not found')).toBe('The decision engine is not available in this build of Memoria.')
    expect(ledgerErrorMessage(new Error('No mock handler for command: ledger_call'))).toBe('The decision engine is not available in the browser preview.')
  })
})

describe('engine error types', () => {
  it('reads the [Kind] prefix added by the bridge and hides it from the message', () => {
    const text = '[StaleProposal] proposal 3 was made against a belief that has since changed'
    expect(ledgerErrorKind(text)).toBe('StaleProposal')
    expect(ledgerErrorKind(new Error('[AlreadyDone] proposal 3 is already accepted'))).toBe('AlreadyDone')
    expect(ledgerErrorMessage(text)).toBe('proposal 3 was made against a belief that has since changed')
  })

  it('has no kind for friendly bridge messages', () => {
    expect(ledgerErrorKind('Python 3.11 was not found at /opt/homebrew/bin/python3.11.')).toBeUndefined()
    expect(ledgerErrorKind(undefined)).toBeUndefined()
  })

  it('keeps the kind on the error thrown by API calls', async () => {
    invokeMock.mockRejectedValueOnce('[StaleProposal] proposal 3 is out of date')
    const error = await createLedgerApi('/v').acceptProposal(3).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LedgerError)
    expect((error as LedgerError).kind).toBe('StaleProposal')
    expect((error as LedgerError).message).toBe('proposal 3 is out of date')
  })
})

describe('createLedgerApi', () => {
  it('sends every call through ledger_call with the vault path', async () => {
    await createLedgerApi('/vault').ping()
    expect(invokeMock).toHaveBeenCalledWith('ledger_call', { vaultPath: '/vault', method: 'ping', params: {} })
    expect(mockInvokeMock).not.toHaveBeenCalled()
  })

  it('uses the browser mock when not running inside Tauri', async () => {
    tauri = false
    await createLedgerApi('/vault').listMeetings()
    expect(mockInvokeMock).toHaveBeenCalledWith('ledger_call', { vaultPath: '/vault', method: 'meetings.list', params: {} })
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('maps ingest input to the engine parameter names and omits unset options', async () => {
    const api = createLedgerApi('/v')
    await api.ingestMeeting({ meetingId: 'a.md', turns: [{ speaker: 'Aisha', text: 'Hi', start: 3 }], occurredAt: '2026-11-02T09:30:00' })
    expect(invokeMock).toHaveBeenLastCalledWith('ledger_call', {
      vaultPath: '/v',
      method: 'meetings.ingest',
      params: { meeting_id: 'a.md', turns: [{ speaker: 'Aisha', text: 'Hi', start: 3 }], occurred_at: '2026-11-02T09:30:00' },
    })
    await api.ingestMeeting({ meetingId: 'b.md', turns: [], extractor: 'keyword' })
    expect(invokeMock.mock.lastCall?.[1].params).toEqual({ meeting_id: 'b.md', turns: [], extractor: 'keyword' })
  })

  it('maps review and correction calls to snake_case params', async () => {
    const api = createLedgerApi('/v')
    await api.acceptProposal(4, { value: '2026-12-20' })
    expect(invokeMock.mock.lastCall?.[1]).toMatchObject({ method: 'proposals.accept', params: { proposal_id: 4, edits: { value: '2026-12-20' } } })
    await api.acceptProposal(5)
    expect(invokeMock.mock.lastCall?.[1].params).toEqual({ proposal_id: 5 })
    await api.rejectProposal(6)
    expect(invokeMock.mock.lastCall?.[1]).toMatchObject({ method: 'proposals.reject', params: { proposal_id: 6 } })
    await api.correctFact(9, 280000, 'Raj corrected it')
    expect(invokeMock.mock.lastCall?.[1]).toMatchObject({ method: 'facts.correct', params: { fact_id: 9, value: 280000, reason: 'Raj corrected it' } })
    await api.retractFact(9, 'said in error')
    expect(invokeMock.mock.lastCall?.[1]).toMatchObject({ method: 'facts.retract', params: { fact_id: 9, reason: 'said in error' } })
  })

  it('maps history, ask and registry calls', async () => {
    const api = createLedgerApi('/v')
    await api.factHistory('golive', 'date')
    expect(invokeMock.mock.lastCall?.[1]).toMatchObject({ method: 'facts.history', params: { object_id: 'golive', attribute: 'date' } })
    await api.ask('What is the go-live date?')
    expect(invokeMock.mock.lastCall?.[1]).toMatchObject({ method: 'ask', params: { question: 'What is the go-live date?' } })
    await api.setRegistry({ objects: [], people: { aisha: 'Aisha' } })
    expect(invokeMock.mock.lastCall?.[1]).toMatchObject({ method: 'registry.set', params: { objects: [], people: { aisha: 'Aisha' } } })
  })

  it('turns engine failures into readable Error messages', async () => {
    invokeMock.mockRejectedValueOnce('The decision engine stopped unexpectedly.')
    await expect(createLedgerApi('/v').brief()).rejects.toThrow('The decision engine stopped unexpectedly.')
    invokeMock.mockRejectedValueOnce(undefined)
    await expect(createLedgerApi('/v').brief()).rejects.toThrow(/Something went wrong/)
  })
})
