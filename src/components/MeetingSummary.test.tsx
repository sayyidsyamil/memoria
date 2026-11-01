import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { MeetingSummary } from './MeetingSummary'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => undefined) }))
vi.mock('../utils/openNoteWindow', () => ({ openNoteInNewWindow: vi.fn(async () => undefined) }))
const claim = (patch = {}) => ({ id: 'a:0', title: 'Cedar pilot', kind: 'Project', statement: 'Cedar pilot runs Thursday.', quote: 'Project Cedar will run its pilot on Thursday.', sourcePath: 'reviewed.md', sourceTitle: 'Transcript', page: 1, pageTitle: 'Project Cedar', status: 'source-unchanged', moment: { meetingId: 'm', meetingTitle: 'Kickoff', at: 20 }, ...patch })
const turns = [{ start: 20, end: 25, speaker: 'S01', text: 'one two three' }, { start: 65, end: 70, speaker: 'S02', text: 'four' }]
const respond = (claims: unknown[], proposals: unknown[]) => vi.mocked(invoke).mockImplementation(async (_command, args) => (args as { request: { action: string } }).request.action === 'approved' ? claims : proposals)
const props = { vaultPath: '/vault', sourcePath: 'reviewed.md', title: 'Kickoff', turns, names: { S01: 'Maya' }, marks: [{ at: 40, label: 'Checklist' }], buildNow: false, onSeek: vi.fn(), onBrief: vi.fn() }
beforeEach(() => { vi.mocked(invoke).mockReset(); props.onSeek.mockReset(); props.onBrief.mockReset() })

it('shows approved outcomes grouped by type, linked to the moment they were said', async () => {
  respond([claim(), claim({ id: 'a:1', kind: 'Commitment', title: 'Checklist', statement: 'Maya sends the checklist.', moment: { meetingId: 'm', meetingTitle: 'Kickoff', at: 65 } }), claim({ id: 'other', sourcePath: 'elsewhere.md' })], [])
  render(<MeetingSummary {...props} />)
  expect(await screen.findByText(/2 approved outcomes · Linked to the recording/)).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Commitments' })).toHaveTextContent('Maya sends the checklist.')
  fireEvent.click(screen.getByRole('button', { name: 'Play from 1:05' }))
  expect(props.onSeek).toHaveBeenCalledWith(65)
  // key moments combine the user's marks with where outcomes were said, in time order
  const moments = screen.getByRole('complementary', { name: 'Meeting details' })
  expect(moments).toHaveTextContent('0:20Project Cedar')
  expect(moments).toHaveTextContent('0:40Checklist')
  fireEvent.click(screen.getByRole('button', { name: /0:40/ }))
  expect(props.onSeek).toHaveBeenCalledWith(40)
  expect(moments).toHaveTextContent('Maya')
  expect(moments).toHaveTextContent('75%')
  fireEvent.click(screen.getByRole('button', { name: 'Create brief' }))
  expect(props.onBrief).toHaveBeenCalledWith('Project Cedar')
})
it('asks for approval while suggestions are pending, then shows the summary', async () => {
  respond([], [{ sourcePath: 'reviewed.md', status: 'pending', id: 'p', sourceTitle: 'Transcript', claims: [], retrieval: 'BM25' }])
  render(<MeetingSummary {...props} />)
  expect(await screen.findByRole('region', { name: 'Review knowledge' })).toBeInTheDocument()
  expect(invoke).not.toHaveBeenCalledWith('wiki_memory', { request: expect.objectContaining({ action: 'compile' }) })
  respond([claim()], [])
  window.dispatchEvent(new Event('memoria-memory-changed'))
  expect(await screen.findByText(/1 approved outcome · Linked to the recording/)).toBeInTheDocument()
})
it('offers to build knowledge when nothing is approved and flags changed sources', async () => {
  respond([], [])
  const { unmount } = render(<MeetingSummary {...props} />)
  expect(await screen.findByText('No approved outcomes yet')).toBeInTheDocument()
  unmount()
  respond([claim({ status: 'needs-review' })], [])
  render(<MeetingSummary {...props} />)
  expect(await screen.findByText('1 source changed — needs review')).toBeInTheDocument()
})
it('explains the locked state before the transcript is reviewed and builds right after saving', async () => {
  const { unmount } = render(<MeetingSummary {...props} sourcePath={null} />)
  expect(screen.getByText('Review the transcript first')).toBeInTheDocument()
  unmount()
  respond([], [])
  render(<MeetingSummary {...props} buildNow />)
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('wiki_memory', { request: expect.objectContaining({ action: 'compile', sourcePath: 'reviewed.md' }) }))
})
