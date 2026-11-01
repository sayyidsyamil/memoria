import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { WorkspaceMemoryHub } from './WorkspaceMemoryHub'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (path:string) => path }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => undefined) }))
vi.mock('../utils/openNoteWindow', () => ({ openNoteInNewWindow: vi.fn(async () => undefined) }))
beforeEach(() => { vi.mocked(invoke).mockReset() })
const draft = {segments:[],duration:58,text:'original',warnings:[]}
const meeting = (patch = {}) => ({id:'one',title:'Pilot review',status:'needs-review',pagePath:'meeting.md',audioPath:'audio.wav',created:'2026-11-01T03:05:00.000Z',
  turns:[{start:1,end:2,speaker:'S01',text:'Saved edit'}],names:{S01:'Maya'},draft,...patch})
it('groups approved claims by page, filters by type and flags changed sources', async () => {
  vi.mocked(invoke).mockResolvedValue([
    {id:'1',title:'Launch',pageTitle:'Pilot launch',kind:'Decision',statement:'Thursday launch',sourceTitle:'Meeting A',sourcePath:'a.md',page:1,quote:'Thursday',knowledgePath:'launch.md',status:'source-unchanged'},
    {id:'3',title:'Scope',pageTitle:'Pilot launch',kind:'Decision',statement:'Operations only',sourceTitle:'Meeting B',sourcePath:'b.md',page:2,quote:'Operations',knowledgePath:'launch.md',status:'source-unchanged'},
    {id:'2',title:'Send report',pageTitle:'Weekly report',kind:'Commitment',statement:'Maya sends report',sourceTitle:'Meeting A',sourcePath:'a.md',page:1,quote:'Report',knowledgePath:'report.md',status:'needs-review'}])
  render(<WorkspaceMemoryHub vaultPath="/vault" />)
  fireEvent.click(screen.getByText('All approved'))
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
it('shows live counts in the sidebar rows and flags changed sources', () => {
  render(<WorkspaceMemoryHub vaultPath="/vault" summary={{meetings:2,approved:12,briefs:1,pendingReviews:0,sourceChanged:1}} />)
  expect(screen.getByRole('button',{name:/Meetings/})).toHaveTextContent('2')
  const approved = screen.getByRole('button',{name:/All approved/})
  expect(approved).toHaveTextContent('12')
  expect(approved.querySelector('[data-attention]')).not.toBeNull()
  expect(screen.getByRole('button',{name:/Briefs/})).toHaveTextContent('1')
})
it('switches between all five sections without closing the dialog', async () => {
  vi.mocked(invoke).mockResolvedValue([])
  render(<WorkspaceMemoryHub vaultPath="/vault" />)
  fireEvent.click(screen.getByText('Meetings'))
  expect(await screen.findAllByRole('tab')).toHaveLength(5)
  expect(screen.getAllByRole('tab').map(tab => tab.textContent?.replace(/\d+$/, ''))).toEqual(['Meetings', 'Search', 'Ask', 'Approved', 'Briefs'])
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
  render(<WorkspaceMemoryHub vaultPath="/vault" />)
  fireEvent.click(screen.getByText('All approved'))
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
