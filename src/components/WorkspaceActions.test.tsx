import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { WorkspaceActions } from './WorkspaceActions'
import { resetStartupMemoryHub } from '../hooks/useStartupMemoryHub'
import { announceMemoryChanged } from '../hooks/useWorkspaceSummary'
import { APP_STORAGE_KEYS } from '../constants/appStorage'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined), convertFileSrc: (path: string) => path }))
vi.mock('../utils/openNoteWindow', () => ({ openNoteInNewWindow: vi.fn(async () => undefined) }))

const ready = { speech: { state: 'ready' }, memory: { state: 'ready' }, embed: { state: 'ready' } }
function answer(models: unknown) {
  vi.mocked(invoke).mockImplementation(async (command: string) => command === 'ai_model_status' ? models : undefined)
}
const overview = (proposals = 0, objects = 1) => ({
  registry: { objects: Array.from({ length: objects }, (_, index) => ({ object_id: `item-${index}`, label: `Item ${index}`, kind: 'decision', attributes: [{ name: 'outcome', type: 'text' }] })) },
  facts: [],
  proposals: Array.from({ length: proposals }, (_, index) => ({ proposal_id: index + 1, object_id: 'item-0', label: 'Item 0', attribute: 'outcome', value: `Choice ${index}`, current_value: null, quote: 'We chose it.', speaker: 'Aisha', meeting: null })),
  check: { ok: true, problems: [] },
})
/** A workspace's answers: its meeting counts and its decision ledger. */
function workspace({ meetings = 0, pendingReviews = 0, ledger = overview() }: { meetings?: number; pendingReviews?: number; ledger?: unknown } = {}) {
  vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
    const request = (args as { request?: { action?: string; method?: string } } | undefined)?.request
    if (command === 'wiki_memory' && request?.action === 'summary') return { meetings, approved: 0, briefs: 0, pendingReviews, sourceChanged: 0 }
    if (command === 'temporal_api' && request?.method === 'overview') return structuredClone(ledger)
    if (command === 'meetings_api') return []
    return undefined
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  resetStartupMemoryHub()
})

it('keeps the sidebar alive when the bridge returns nothing', async () => {
  answer(undefined)
  await act(async () => { render(<WorkspaceActions vaultPath="/vault" />) })
  expect(screen.getByRole('button', { name: /Start meeting/ })).toBeInTheDocument()
  expect(screen.queryByText('Preparing AI…')).not.toBeInTheDocument()
})
it('opens the meeting HUD for the current vault', async () => {
  answer(ready)
  render(<WorkspaceActions vaultPath="/vault" />)
  fireEvent.click(screen.getByRole('button', { name: /Start meeting/ }))
  expect(invoke).toHaveBeenCalledWith('open_meeting_hud', { vaultPath: '/vault' })
  await screen.findByRole('button', { name: /Start meeting/ })
})
it('shows Start meeting first, then one list of Memoria places ending with Review', async () => {
  workspace({ ledger: overview(0, 0) })
  await act(async () => { render(<WorkspaceActions vaultPath="/vault" />) })
  const actions = screen.getByLabelText('Workspace actions')
  expect(within(actions).getAllByRole('button').map(button => button.textContent)).toEqual(['Start meeting', 'Decisions', 'Meetings', 'Ask', 'Briefs', 'Search', 'Review'])
  expect(screen.queryByRole('button', { name: /Import files/ })).not.toBeInTheDocument()
})
it('badges Decisions with the suggestions waiting, and Review with the knowledge reviews waiting', async () => {
  // A returning user with a note open: the sidebar stays in front.
  localStorage.setItem(APP_STORAGE_KEYS.lastActiveNotePath, '/vault/notes/plan.md')
  workspace({ pendingReviews: 2, ledger: overview(4) })
  render(<WorkspaceActions vaultPath="/vault" />)
  expect(await screen.findByRole('button', { name: 'Decisions, 4 suggestions to review' })).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: 'Review, 2 waiting' })).toBeInTheDocument()
})
it('updates the Decisions badge when memory changes', async () => {
  localStorage.setItem(APP_STORAGE_KEYS.lastActiveNotePath, '/vault/notes/plan.md')
  let waiting = 3
  vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
    const request = (args as { request?: { method?: string } } | undefined)?.request
    return command === 'temporal_api' && request?.method === 'overview' ? overview(waiting) : undefined
  })
  render(<WorkspaceActions vaultPath="/vault" />)
  await screen.findByRole('button', { name: 'Decisions, 3 suggestions to review' })
  waiting = 1
  act(() => announceMemoryChanged())
  expect(await screen.findByRole('button', { name: 'Decisions, 1 suggestion to review' })).toBeInTheDocument()
})
it('opens on Decisions at startup when the workspace holds meetings', async () => {
  workspace()
  render(<WorkspaceActions vaultPath="/vault" hasMeetingNotes />)
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByRole('tab', { name: 'Decisions' })).toHaveAttribute('aria-selected', 'true')
  expect(within(dialog).getByRole('region', { name: 'Decision board' })).toBeInTheDocument()
})
it('opens on Decisions at startup when the ledger tracks decisions, once per session', async () => {
  workspace({ ledger: overview(0, 2) })
  const first = render(<WorkspaceActions vaultPath="/vault" />)
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  first.unmount()
  // Showing the sidebar again later does not open it a second time.
  render(<WorkspaceActions vaultPath="/vault" hasMeetingNotes />)
  await screen.findByRole('button', { name: 'Decisions' })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
it('keeps a reopened note in front instead of opening Decisions', async () => {
  localStorage.setItem(APP_STORAGE_KEYS.lastActiveNotePath, '/vault/notes/plan.md')
  workspace({ meetings: 3 })
  render(<WorkspaceActions vaultPath="/vault" hasMeetingNotes />)
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('temporal_api', expect.anything()))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
it('leaves an empty workspace on its notes', async () => {
  workspace({ meetings: 0, ledger: overview(0, 0) })
  render(<WorkspaceActions vaultPath="/vault" />)
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('temporal_api', expect.anything()))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
