import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { WorkspaceActions } from './WorkspaceActions'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined), convertFileSrc: (path: string) => path }))
vi.mock('../utils/openNoteWindow', () => ({ openNoteInNewWindow: vi.fn(async () => undefined) }))

const ready = { speech: { state: 'ready' }, memory: { state: 'ready' }, embed: { state: 'ready' } }
function answer(models: unknown) {
  vi.mocked(invoke).mockImplementation(async (command: string) => command === 'ai_model_status' ? models : undefined)
}
beforeEach(() => { vi.clearAllMocks() })

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
