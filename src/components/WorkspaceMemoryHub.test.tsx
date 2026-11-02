import { createRef } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { WorkspaceMemoryHub, type HubView, type MemoryHubHandle } from './WorkspaceMemoryHub'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (path:string) => path }))
// Component tests isolate the frontend service; its real IPC contract has separate tests.
vi.mock('../features/meetings/meetingService', () => ({ meetingService: {
  list: async (vaultPath: string) => {
    const result = await invoke('wiki_memory', { request: { action: 'meetings', vaultPath } })
    return (result as { created?: string }[]).sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''))
  },
  get: (vaultPath: string, id: string) => invoke('wiki_memory', { request: { action: 'meeting_record', vaultPath, id } }),
  delete: (vaultPath: string, id: string) => invoke('wiki_memory', { request: { action: 'delete_meeting', vaultPath, id } }),
} }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => undefined) }))
vi.mock('../features/meetings/recordingService', () => ({ recordingService: { list: vi.fn(async () => ({ recordings: [], activeRecording: false })) } }))
vi.mock('../utils/openNoteWindow', () => ({ openNoteInNewWindow: vi.fn(async () => undefined) }))
beforeEach(() => { vi.mocked(invoke).mockReset() })
const draft = {segments:[],duration:58,text:'original',warnings:[]}
/** Opens the memory window on a section, as the sidebar does at startup. */
function renderOpen(view: HubView, props: Partial<Parameters<typeof WorkspaceMemoryHub>[0]> = {}) {
  const hub = createRef<MemoryHubHandle>()
  const result = render(<WorkspaceMemoryHub ref={hub} vaultPath="/vault" {...props} />)
  act(() => hub.current!.open(view))
  return { ...result, hub }
}
const meeting = (patch = {}) => ({id:'one',title:'Pilot review',status:'needs-review',pagePath:'meeting.md',audioPath:'audio.wav',created:'2026-11-01T03:05:00.000Z',
  turns:[{start:1,end:2,speaker:'S01',text:'Saved edit'}],names:{S01:'Maya'},draft,...patch})
it('groups approved claims by page, filters by type and flags changed sources', async () => {
  vi.mocked(invoke).mockResolvedValue([
    {id:'1',title:'Launch',pageTitle:'Pilot launch',kind:'Decision',statement:'Thursday launch',sourceTitle:'Meeting A',sourcePath:'a.md',page:1,quote:'Thursday',knowledgePath:'launch.md',status:'source-unchanged'},
    {id:'3',title:'Scope',pageTitle:'Pilot launch',kind:'Decision',statement:'Operations only',sourceTitle:'Meeting B',sourcePath:'b.md',page:2,quote:'Operations',knowledgePath:'launch.md',status:'source-unchanged'},
    {id:'2',title:'Send report',pageTitle:'Weekly report',kind:'Commitment',statement:'Maya sends report',sourceTitle:'Meeting A',sourcePath:'a.md',page:1,quote:'Report',knowledgePath:'report.md',status:'needs-review'}])
  renderOpen('approved')
  await screen.findByText('Thursday launch')
  expect(screen.getAllByRole('heading',{level:3}).map(item => item.textContent)).toEqual(['Pilot launch','Weekly report'])
  expect(screen.getByText('Operations only')).toBeInTheDocument()
  fireEvent.click(within(screen.getByRole('group',{name:'Knowledge type'})).getByRole('button',{name:/^Commitment/}))
  expect(screen.queryByText('Thursday launch')).not.toBeInTheDocument()
  expect(screen.getByText('Source changed — needs review')).toBeInTheDocument()
  expect(screen.getByText(/3 approved claims across 2 pages · 1 needs review/)).toBeInTheDocument()
})
it('lists durable meetings and reopens saved transcript edits', async () => {
  vi.mocked(invoke).mockResolvedValueOnce([meeting()]).mockResolvedValueOnce(meeting())
  render(<WorkspaceMemoryHub vaultPath="/vault" />)
  fireEvent.click(screen.getByText('Meetings'))
  const review = await screen.findByRole('button',{name:'Review transcript'})
  expect(screen.getByText('1 meeting')).toBeInTheDocument()
  fireEvent.click(review)
  expect(await screen.findByRole('textbox',{name:'Transcript turn 1'})).toHaveValue('Saved edit')
  // Opening a record must not drop the cursor into (and select) the title field.
  expect(screen.getByRole('textbox',{name:'Meeting title'})).not.toHaveFocus()
})
it('reopens an unreviewed recovered meeting with its created transcript', async () => {
  // Observed natively: an empty saved turn list replaced the created draft, leaving "No readable speech" and no way back.
  const recovered = meeting({ id:'rec', turns:[], draft:undefined })
  const created = { segments:[{start:9.86,end:12.42,speaker:'S01',text:'We decided to use Acme as supplier.'}], duration:15.96, text:'', warnings:[] }
  vi.mocked(invoke).mockResolvedValueOnce([recovered]).mockResolvedValueOnce(recovered).mockResolvedValueOnce(created)
  render(<WorkspaceMemoryHub vaultPath="/vault" />)
  fireEvent.click(screen.getByText('Meetings'))
  fireEvent.click(await screen.findByRole('button',{name:'Review transcript'}))
  expect(await screen.findByRole('textbox',{name:'Transcript turn 1'})).toHaveValue('We decided to use Acme as supplier.')
  expect(screen.queryByText(/No readable speech was detected/)).not.toBeInTheDocument()
})
it('offers one next action per meeting and shows real progress', async () => {
  vi.mocked(invoke).mockResolvedValueOnce([
    meeting({id:'a',title:'Needs transcript'}),
    meeting({id:'b',title:'Needs outcomes',status:'transcript-reviewed',transcriptPath:'t.md',outcomesStatus:'needs-review'}),
    meeting({id:'c',title:'Finished',status:'transcript-reviewed',transcriptPath:'t2.md',outcomesStatus:'approved'})])
  render(<WorkspaceMemoryHub vaultPath="/vault" />)
  fireEvent.click(screen.getByText('Meetings'))
  await screen.findByText('Needs outcomes')
  expect(screen.getByRole('button',{name:'Review transcript'})).toBeInTheDocument()
  expect(screen.getByRole('button',{name:'Review outcomes'})).toBeInTheDocument()
  expect(screen.getByRole('button',{name:'Open meeting'})).toBeInTheDocument()
  const rails = screen.getAllByRole('list',{name:'Meeting progress'})
  expect(within(rails[0]).getByText('Transcript reviewed').closest('li')).toHaveAttribute('aria-current','step')
  expect(within(rails[2]).getByText('Outcomes approved').closest('li')).not.toHaveAttribute('aria-current')
})
it('shows an empty state that starts a meeting', async () => {
  const start = vi.fn()
  vi.mocked(invoke).mockResolvedValue([])
  render(<WorkspaceMemoryHub vaultPath="/vault" onStartMeeting={start} />)
  fireEvent.click(screen.getByText('Meetings'))
  fireEvent.click(await screen.findByRole('button',{name:'Start meeting'}))
  expect(start).toHaveBeenCalled()
})
it('shows live counts in the sidebar rows, flags waiting suggestions and changed sources', async () => {
  vi.mocked(invoke).mockResolvedValue([])
  render(<WorkspaceMemoryHub vaultPath="/vault" decisionsWaiting={3} summary={{meetings:2,approved:12,briefs:1,pendingReviews:0,sourceChanged:1}} />)
  const decisions = screen.getByRole('button',{name:'Decisions, 3 suggestions to review'})
  expect(decisions.querySelector('[data-attention]')).toHaveTextContent('3')
  expect(screen.getByRole('button',{name:'Meetings, 2'})).toHaveTextContent('2')
  expect(screen.getByRole('button',{name:'Briefs, 1'})).toHaveTextContent('1')
  expect(screen.queryByRole('button',{name:/approved/i})).not.toBeInTheDocument()
  fireEvent.click(decisions)
  expect(within(await screen.findByRole('tab',{name:/Decisions/})).getByLabelText('needs attention')).toBeInTheDocument()
  expect(within(screen.getByRole('tab',{name:/Approved/})).getByLabelText('needs attention')).toBeInTheDocument()
})
it('lists the Memoria places in one sidebar list, with further rows such as Review at its end', () => {
  render(<WorkspaceMemoryHub vaultPath="/vault"><button type="button">Review</button></WorkspaceMemoryHub>)
  const list = screen.getByRole('navigation',{name:'Meeting memory'})
  expect(within(list).getAllByRole('button').map(button => button.textContent)).toEqual(['Decisions','Meetings','Ask','Briefs','Search','Review'])
})
it('opens on Decisions, the decision board, by default', async () => {
  vi.mocked(invoke).mockResolvedValue([])
  render(<WorkspaceMemoryHub vaultPath="/vault" />)
  fireEvent.click(screen.getByRole('button',{name:'Decisions'}))
  expect(await screen.findByRole('tab',{name:'Decisions'})).toHaveAttribute('aria-selected','true')
  expect(screen.getByRole('region',{name:'Decision board'})).toBeInTheDocument()
  expect(screen.getByText('Nothing here changes without your approval')).toBeInTheDocument()
})
it('opens a section on request, as the app does at startup', async () => {
  vi.mocked(invoke).mockResolvedValue([])
  renderOpen('facts')
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  expect(screen.getByRole('tab',{name:'Decisions'})).toHaveAttribute('aria-selected','true')
})
it('switches between all six sections without closing the dialog', async () => {
  vi.mocked(invoke).mockResolvedValue([])
  render(<WorkspaceMemoryHub vaultPath="/vault" />)
  fireEvent.click(screen.getByText('Meetings'))
  expect(await screen.findAllByRole('tab')).toHaveLength(6)
  expect(screen.getAllByRole('tab').map(tab => tab.textContent?.replace(/\d+$/, ''))).toEqual(['Decisions', 'Meetings', 'Ask', 'Briefs', 'Search', 'Approved'])
  fireEvent.click(screen.getByRole('tab', { name: /Ask/ }))
  expect(await screen.findByRole('textbox', { name: 'Question or meeting topic' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: /Search/ }))
  expect(await screen.findByRole('textbox', { name: 'Search meetings and approved knowledge' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: /Briefs/ }))
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('wiki_memory', { request: { action: 'briefs', vaultPath: '/vault' } }))
  fireEvent.click(await screen.findByRole('button', { name: 'New brief' }))
  expect(await screen.findByRole('textbox', { name: 'Question or meeting topic' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Create brief' })).toBeInTheDocument()
})
it('opens the meeting at the moment an approved claim was said', async () => {
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    const action = (args as { request: { action: string } }).request.action
    if (action === 'approved') return [{id:'1',title:'Launch',pageTitle:'Pilot launch',kind:'Decision',statement:'Thursday launch',sourceTitle:'Meeting A',sourcePath:'a.md',page:1,quote:'Thursday',knowledgePath:'launch.md',status:'source-unchanged',moment:{meetingId:'one',meetingTitle:'Pilot review',at:20}}]
    if (action === 'meeting_record') return meeting()
    return []
  })
  renderOpen('approved')
  fireEvent.click(await screen.findByRole('button', { name: 'Open Pilot review at 0:20' }))
  expect(await screen.findByRole('textbox', { name: 'Transcript turn 1' })).toHaveValue('Saved edit')
  expect(screen.getByLabelText('Elapsed time')).toHaveTextContent('0:20')
})
it('keeps recordings newest first regardless of bridge order', async () => {
  vi.mocked(invoke).mockResolvedValue([
    meeting({ id: 'old', title: 'Older meeting', created: '2026-10-01T10:00:00Z' }),
    meeting({ id: 'new', title: 'Latest meeting', created: '2026-11-01T10:00:00Z' }),
  ])
  render(<WorkspaceMemoryHub vaultPath="/vault" />)
  fireEvent.click(screen.getByText('Meetings'))
  await screen.findByText('Latest meeting')
  expect(screen.getAllByRole('article').map(item => item.querySelector('h3')?.textContent)).toEqual(['Latest meeting', 'Older meeting'])
})
it('requires confirmation to delete a meeting and refreshes the list after success', async () => {
  let deleted = false
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    const action = (args as { request: { action: string } }).request.action
    if (action === 'delete_meeting') { deleted = true; return { deleted: true } }
    return deleted ? [] : [meeting()]
  })
  render(<WorkspaceMemoryHub vaultPath="/vault" />)
  fireEvent.click(screen.getByText('Meetings'))
  fireEvent.click(await screen.findByRole('button', { name: 'Delete meeting Pilot review' }))
  expect(deleted).toBe(false)
  expect(screen.getByText(/Original audio, sources, and approved knowledge are kept/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Delete meeting' }))
  await screen.findByText('No meetings yet')
  expect(deleted).toBe(true)
})
it('keeps a meeting visible when deletion fails and allows cancellation', async () => {
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    if ((args as { request: { action: string } }).request.action === 'delete_meeting') throw new Error('Meeting page was edited externally')
    return [meeting()]
  })
  render(<WorkspaceMemoryHub vaultPath="/vault" />)
  fireEvent.click(screen.getByText('Meetings'))
  fireEvent.click(await screen.findByRole('button', { name: 'Delete meeting Pilot review' }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete meeting' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('edited externally')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByText('Pilot review')).toBeInTheDocument()
})
it('does not let a stale request overwrite the current view or its error', async () => {
  let rejectMeetings!: (error: Error) => void
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    const action = (args as { request: { action: string } }).request.action
    if (action === 'meetings') return new Promise((_resolve, reject) => { rejectMeetings = reject })
    return []
  })
  render(<WorkspaceMemoryHub vaultPath="/vault" />)
  fireEvent.click(screen.getByText('Meetings'))
  expect(screen.getByText('Loading meetings…')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: /Briefs/ }))
  await screen.findByText('No saved briefs yet')
  await act(async () => { rejectMeetings(new Error('Old request failed')) })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('tab', { name: /Briefs/ })).toHaveAttribute('aria-selected', 'true')
})
