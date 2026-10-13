import type { HistoryEntry, LedgerEvidence, LedgerValue, MeetingSummary, Proposal } from '../lib/ledgerApi'

export const MOCK_MEETINGS: MeetingSummary[] = [
  { meeting_id: '/Users/luca/Laputa/transcripts/Steering 1 - Kick-off.md', occurred_at: '2026-09-14T09:30:00', source_id: 'a1b2c3d4e5f6', evidence_items: 5 },
  { meeting_id: '/Users/luca/Laputa/transcripts/Steering 2 - Vendor and budget.md', occurred_at: '2026-09-28T09:30:00', source_id: 'b2c3d4e5f6a7', evidence_items: 7 },
  { meeting_id: '/Users/luca/Laputa/transcripts/Steering 3 - Timeline.md', occurred_at: '2026-10-12T09:30:00', source_id: 'c3d4e5f6a7b8', evidence_items: 3 },
]

const M1 = MOCK_MEETINGS[0].meeting_id
const M2 = MOCK_MEETINGS[1].meeting_id
const M3 = MOCK_MEETINGS[2].meeting_id

const ev = (meeting: string, speaker: string, quote: string, audio_start: number): LedgerEvidence =>
  ({ quote, speaker, meeting, audio_start, char_start: 0, char_end: quote.length, confidence: 0.9, extractor: 'mlx' })

interface SeedVersion { value: LedgerValue; from: string; type: string; evidence: LedgerEvidence }
export interface SeedSlot { object_id: string; attribute: string; versions: SeedVersion[] }

export const MOCK_SLOTS: SeedSlot[] = [
  { object_id: 'vendor', attribute: 'outcome', versions: [
    { value: 'Alpha Systems', from: '2026-09-14', type: 'INITIAL', evidence: ev(M1, 'Aisha', 'We will go with Alpha Systems for the pilot.', 312) },
    { value: 'Beta Cloud', from: '2026-09-28', type: 'REVERSE', evidence: ev(M2, 'Aisha', 'After the demos, the decision is Beta Cloud, not Alpha Systems.', 421) },
  ] },
  { object_id: 'budget', attribute: 'amount', versions: [
    { value: 250000, from: '2026-09-14', type: 'INITIAL', evidence: ev(M1, 'Raj', 'Finance can commit two hundred and fifty thousand ringgit.', 540) },
    { value: 300000, from: '2026-09-28', type: 'REVISE', evidence: ev(M2, 'Raj', 'Beta Cloud costs more, so I am raising the budget to three hundred thousand.', 655) },
    { value: 280000, from: '2026-10-12', type: 'REVISE', evidence: ev(M3, 'Raj', 'After negotiation we settled at two hundred and eighty thousand.', 90) },
  ] },
  { object_id: 'golive', attribute: 'date', versions: [
    { value: '2026-12-01', from: '2026-09-14', type: 'INITIAL', evidence: ev(M1, 'Aisha', 'Go-live is the first of December.', 700) },
    { value: '2026-12-08', from: '2026-09-28', type: 'REVISE', evidence: ev(M2, 'Wei Ling', 'We need one more week, so go-live moves to the eighth of December.', 780) },
    { value: '2026-12-15', from: '2026-10-12', type: 'REVISE', evidence: ev(M3, 'Wei Ling', 'Migration testing slipped. Let us set go-live for the fifteenth of December.', 150) },
  ] },
  { object_id: 'training', attribute: 'owner', versions: [{ value: 'raj', from: '2026-09-28', type: 'INITIAL', evidence: ev(M2, 'Raj', 'I will organise the staff training.', 860) }] },
  { object_id: 'training', attribute: 'deadline', versions: [{ value: '2026-11-30', from: '2026-09-28', type: 'INITIAL', evidence: ev(M2, 'Raj', 'I can have the training done by the end of November.', 880) }] },
  { object_id: 'migration', attribute: 'owner', versions: [{ value: 'wei_ling', from: '2026-09-14', type: 'INITIAL', evidence: ev(M1, 'Wei Ling', 'Data migration is mine.', 900) }] },
  { object_id: 'migration', attribute: 'deadline', versions: [{ value: '2026-12-05', from: '2026-09-14', type: 'INITIAL', evidence: ev(M1, 'Wei Ling', 'I will finish migration by the fifth of December.', 915) }] },
  { object_id: 'security', attribute: 'owner', versions: [{ value: 'wei_ling', from: '2026-09-14', type: 'INITIAL', evidence: ev(M1, 'Aisha', 'Wei Ling, please own the security review.', 950) }] },
  { object_id: 'security', attribute: 'deadline', versions: [{ value: '2026-11-20', from: '2026-09-14', type: 'INITIAL', evidence: ev(M1, 'Wei Ling', 'Security review will be complete by the twentieth of November.', 965) }] },
  { object_id: 'security', attribute: 'status', versions: [{ value: 'done', from: '2026-10-12', type: 'INITIAL', evidence: ev(M3, 'Wei Ling', 'The security review is done and signed off.', 40) }] },
]

export const MOCK_PROPOSALS: Proposal[] = [
  { proposal_id: 1, object_id: 'training', label: 'Staff training', attribute: 'deadline', value: '2026-12-10', current_value: '2026-11-30', confidence: 0.74, reason: 'confirm_conflicts',
    quote: 'Maybe the training can slip to the tenth of December.', speaker: 'Raj', meeting: M3 },
  { proposal_id: 2, object_id: 'vendor', label: 'Vendor', attribute: 'outcome', value: 'Gamma Soft', current_value: 'Beta Cloud', confidence: 0.58, reason: 'confirm_conflicts',
    quote: 'Someone mentioned we might look at Gamma Soft again.', speaker: 'Aisha', meeting: M3 },
]

export const MOCK_ASK_EVIDENCE: HistoryEntry['evidence'] = [ev(M3, 'Wei Ling', 'Migration testing slipped. Let us set go-live for the fifteenth of December.', 150)]
export { M1, M2, M3 }
