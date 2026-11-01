import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { ModelRuntimeStatus } from './ModelRuntimeStatus'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
beforeEach(() => { vi.mocked(invoke).mockReset() })

it('shows each actual runtime separately rather than a single AI ready label', async () => {
  vi.mocked(invoke).mockResolvedValue({ speech: { state: 'ready' }, qwen: { state: 'preparing' }, embed: { state: 'failed', message: 'Model missing' } })
  render(<ModelRuntimeStatus />)
  await waitFor(() => expect(screen.getByRole('status', { name: 'Local AI runtime status' })).toHaveTextContent('Speech: Ready'))
  expect(screen.getByRole('status')).toHaveTextContent('Knowledge: Preparing')
  expect(screen.getByRole('status')).toHaveTextContent('Search: Needs attention')
  expect(screen.getByTitle('Search: Model missing')).toBeInTheDocument()
})

it('reports unavailable bridge data instead of claiming readiness', async () => {
  vi.mocked(invoke).mockResolvedValue(undefined)
  render(<ModelRuntimeStatus />)
  expect(await screen.findByText('Local AI status unavailable')).toBeInTheDocument()
})
it('treats missing or malformed individual runtimes as queued', async () => {
  vi.mocked(invoke).mockResolvedValue({ speech: null, qwen: { state: 'ready' }, embed: 42 })
  render(<ModelRuntimeStatus />)
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Knowledge: Ready'))
  expect(screen.getByRole('status')).toHaveTextContent('Speech: Queued')
  expect(screen.getByRole('status')).toHaveTextContent('Search: Queued')
})
