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
  save: (vaultPath: string, record: unknown) => invoke('wiki_memory', { request: { action: 'save_meeting', vaultPath, record } }),
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
  expect(within(screen.getByRole('tab', { name: /Knowledge/ })).getByText('3')).toBeInTheDocument()
  expect(screen.getByText('Operations only')).toBeInTheDocument()
  fireEvent.click(within(screen.getByRole('group',{name:'Knowledge type'})).getByRole('button',{name:/^Commitment/}))
  expect(screen.queryByText('Thursday launch')).not.toBeInTheDocument()
  expect(screen.getByText('Source changed — needs review')).toBeInTheDocument()
  expect(screen.getByText('Source · Meeting A · page 1')).toBeInTheDocument()
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
  expect(screen.getByRole('dialog', { name: 'Meeting record' })).toHaveFocus()
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
it('opens a reviewed meeting that has no draft on its reviewed turns, and Save & close keeps them', async () => {
  // Observed on the demo vault: the review opened on "Create transcript", and Save & close then saved no turns.
  const reviewed = meeting({ id:'seeded', status:'transcript-reviewed', transcriptPath:'t.md', outcomesStatus:'not-built', draft:undefined,
    turns:[{start:1,end:4,speaker:'S01',text:'We go with Beta Cloud.'},{start:5,end:9,speaker:'S02',text:'Agreed.'}], names:{S01:'Aisha',S02:'Raj'} })
  const saved: unknown[] = []
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    const request = (args as { request: { action: string; record?: unknown } }).request
    if (request.action === 'meetings') return [reviewed]
    if (request.action === 'meeting_record') return structuredClone(reviewed)
    if (request.action === 'meeting_draft') return null
    if (request.action === 'save_meeting') { saved.push(request.record); return request.record }
    return []
  })
  renderOpen('meetings')
  fireEvent.click(await screen.findByRole('button', { name: 'Review outcomes' }))
  fireEvent.click(await screen.findByRole('tab', { name: 'Transcript' }))
  expect(await screen.findByRole('textbox', { name: 'Transcript turn 1' })).toHaveValue('We go with Beta Cloud.')
  expect(screen.getByRole('combobox', { name: 'Speaker for turn 2' })).toHaveDisplayValue('Raj')
  expect(screen.queryByRole('button', { name: 'Create transcript' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Save & close' }))
  await waitFor(() => expect(saved).toHaveLength(1))
  expect(saved[0]).toMatchObject({ id: 'seeded', transcriptPath: 't.md', names: { S01: 'Aisha', S02: 'Raj' },
    turns: [expect.objectContaining({ text: 'We go with Beta Cloud.' }), expect.objectContaining({ text: 'Agreed.' })] })
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Meeting memory' })).toHaveFocus())
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
it('does not ask for outcome approval when the meeting\'s decisions are already accepted on the board', async () => {
  // FINDINGS 37: reviewed demo meetings offered "Review outcomes", with "Outcomes approved" still to do, though the board held their decisions.
  const reviewed = (id: string, title: string) => meeting({id, title, status:'transcript-reviewed', transcriptPath:`${id}.md`, outcomesStatus:'not-built', draft:undefined})
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    const action = (args as { request?: { action: string } }).request?.action
    if (action === 'meetings') return [reviewed('decided','Decided on the board'), reviewed('open','Nothing decided yet')]
    if (action === 'meeting_record') return reviewed('decided','Decided on the board')
    if (action === 'meeting_draft') return null
    return []
  })
  renderOpen('meetings', { decisionsByMeeting: { decided: 4 } })
  const decided = (await screen.findByText('Decided on the board')).closest('article')!
  const open = screen.getByText('Nothing decided yet').closest('article')!
  expect(within(decided).getByText('Decisions accepted').closest('li')).toHaveAttribute('data-state','done')
  expect(within(decided).queryByText('Outcomes approved')).not.toBeInTheDocument()
  expect(within(decided).queryByRole('button',{name:'Review outcomes'})).not.toBeInTheDocument()
  // A meeting with nothing on the board still has its outcomes to review.
  expect(within(open).getByText('Outcomes approved').closest('li')).toHaveAttribute('aria-current','step')
  expect(within(open).getByRole('button',{name:'Review outcomes'})).toBeInTheDocument()
  fireEvent.click(within(decided).getByRole('button',{name:'Open meeting'}))
  expect(await screen.findByRole('tab',{name:'Decisions',selected:true})).toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab',{name:'Summary'}))
  expect(await screen.findByRole('heading',{name:'Decisions accepted'})).toBeInTheDocument()
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
  expect(within(screen.getByRole('tab',{name:/Knowledge/})).getByLabelText('needs attention')).toBeInTheDocument()
  expect(document.querySelector('.hub-footer')).toHaveTextContent('3 suggestions to review')
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
  expect(screen.getAllByRole('tab').map(tab => tab.textContent?.replace(/\d+$/, ''))).toEqual(['Decisions', 'Meetings', 'Ask', 'Briefs', 'Search', 'Knowledge'])
  fireEvent.click(screen.getByRole('tab', { name: /Ask/ }))
  expect(await screen.findByRole('textbox', { name: 'Question or meeting topic' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: /Search/ }))
  expect(await screen.findByRole('textbox', { name: 'Search meetings and approved knowledge' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: /Briefs/ }))
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('wiki_memory', { request: { action: 'briefs', vaultPath: '/vault' } }))
  fireEvent.click(await screen.findByRole('button', { name: 'Create a brief' }))
  expect(await screen.findByRole('textbox', { name: 'Question or meeting topic' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Create brief' })).toBeInTheDocument()
})
it.each(['Escape', 'Done', 'Close'])('contains keyboard focus through section navigation and returns to its opener after %s', async dismiss => {
  vi.mocked(invoke).mockResolvedValue([])
  render(<><button type="button">Outside action</button><WorkspaceMemoryHub vaultPath="/vault" /></>)
  const outside = screen.getByRole('button', { name: 'Outside action' })
  const opener = screen.getByRole('button', { name: 'Briefs' })
  opener.focus()
  fireEvent.click(opener)
  const dialog = await screen.findByRole('dialog', { name: 'Meeting memory' })
  expect(dialog).toHaveFocus()
  act(() => outside.focus())
  expect(dialog).toHaveFocus()
  const briefs = within(dialog).getByRole('tab', { name: /Briefs/ })
  act(() => briefs.focus())
  fireEvent.keyDown(briefs, { key: 'End' })
  expect(await within(dialog).findByRole('tab', { name: /Knowledge/, selected: true })).toHaveFocus()
  expect(within(dialog).getAllByRole('tab')).toHaveLength(6)
  const close = within(dialog).getByRole('button', { name: 'Close', exact: true })
  const done = within(dialog).getByRole('button', { name: 'Done', exact: true })
  act(() => close.focus())
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
  expect(done).toHaveFocus()
  fireEvent.keyDown(done, { key: 'Tab' })
  expect(close).toHaveFocus()
  if (dismiss === 'Escape') fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  else fireEvent.click(within(dialog).getByRole('button', { name: dismiss, exact: true }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(opener).toHaveFocus())
})
it('opens the meeting at the moment an approved claim was said', async () => {
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    const action = (args as { request: { action: string } }).request.action
    if (action === 'approved') return [{id:'1',title:'Launch',pageTitle:'Pilot launch',kind:'Decision',statement:'Thursday launch',sourceTitle:'Meeting A',sourcePath:'a.md',page:1,quote:'Thursday',knowledgePath:'launch.md',status:'source-unchanged',moment:{meetingId:'one',meetingTitle:'Pilot review',at:20}}]
    if (action === 'meeting_record') return meeting()
    return []
  })
  renderOpen('approved')
  // A quote with a recording time needs no page number: a transcript has none.
  expect(await screen.findByText('Source · Meeting A')).toBeInTheDocument()
  fireEvent.click(await screen.findByRole('button', { name: 'Open Pilot review at 0:20' }))
  expect(await screen.findByRole('textbox', { name: 'Transcript turn 1' })).toHaveValue('Saved edit')
  expect(screen.getByLabelText('Elapsed time')).toHaveTextContent('0:20')
})
it('keeps an empty Knowledge count distinct from approved values on the decision board', async () => {
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const request = (args as { request: { method?: string } }).request
    if (command === 'temporal_api' && request.method === 'overview') return {
      registry: { objects: [{ object_id: 'budget', label: 'Pilot budget', kind: 'decision', attributes: [{ name: 'amount', type: 'number' }] }] },
      facts: [{ fact_id: 1, object_id: 'budget', label: 'Pilot budget', attribute: 'amount', value: 100, n_changes: 0, valid_from: '2026-11-01',
        evidence: [{ quote: 'We agreed on 100.', speaker: 'Maya', meeting: 'one' }] }],
      proposals: [], check: { ok: true, problems: [] },
    }
    return []
  })
  renderOpen('facts', { summary: { meetings: 1, approved: 0, briefs: 0, pendingReviews: 0, sourceChanged: 0 } })
  expect(await screen.findByRole('article', { name: 'Pilot budget' })).toHaveTextContent('Current100')
  const knowledge = screen.getByRole('tab', { name: /Knowledge/ })
  expect(within(knowledge).getByText('0')).toBeInTheDocument()
  fireEvent.click(knowledge)
  expect(await screen.findByRole('heading', { name: 'No knowledge claims yet' })).toBeInTheDocument()
  expect(screen.getByText(/Your approved decisions and commitments are on the Decisions tab/)).toBeInTheDocument()
  expect(invoke).toHaveBeenCalledWith('wiki_memory', { request: { action: 'approved', vaultPath: '/vault' } })
  fireEvent.click(screen.getByRole('tab', { name: 'Decisions' }))
  expect(await screen.findByRole('article', { name: 'Pilot budget' })).toHaveTextContent('We agreed on 100.')
  expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument()
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
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Meeting memory' })).toHaveFocus())
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
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Cancel' }), { pointerType: 'touch', button: 0 })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('dialog', { name: 'Meeting memory' })).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Delete meeting Pilot review' })).toHaveFocus())
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
it('reports a list that failed to load under its title, offers to try again, and counts nothing meanwhile', async () => {
  let fail = true
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    const action = (args as { request: { action: string } }).request.action
    if (action === 'meetings' && fail) throw new Error('The local memory runtime is not responding.')
    return action === 'meetings' ? [meeting()] : []
  })
  renderOpen('meetings')
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(/^The local memory runtime is not responding\.$/)
  expect(alert.closest('.hub-alert')?.previousElementSibling).toHaveClass('hub-page-heading')
  expect(document.querySelector('.hub-footer')).toHaveTextContent(/^Done$/)
  expect(screen.queryByRole('textbox', { name: 'Search meetings' })).not.toBeInTheDocument()
  fail = false
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Pilot review')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(document.querySelector('.hub-footer')).toHaveTextContent('1 meeting')
  expect(screen.getByRole('textbox', { name: 'Search meetings' })).toBeInTheDocument()
})
it('keeps one way to start a brief: the empty state when there are none, the page action when there are', async () => {
  vi.mocked(invoke).mockResolvedValue([])
  const view = renderOpen('briefs')
  expect(await screen.findByRole('button', { name: 'Create a brief' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'New brief' })).not.toBeInTheDocument()
  view.unmount()
  vi.mocked(invoke).mockResolvedValue([{ id: 'b1', topic: 'Pilot launch', pagePath: 'briefs/pilot.md', created: '2026-11-02T08:15:00Z' }])
  renderOpen('briefs')
  expect(await screen.findByRole('button', { name: 'Open brief Pilot launch' })).toHaveTextContent(/^Open$/)
  expect(screen.getByRole('button', { name: 'New brief' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Create a brief' })).not.toBeInTheDocument()
  expect(document.querySelector('.hub-footer')).toHaveTextContent('1 saved brief')
})
