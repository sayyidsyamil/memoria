import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useUpdater } from './useUpdater'

vi.mock('../mock-tauri', () => ({ isTauri: () => true }))
vi.mock('../lib/appUpdater', () => ({
  checkForAppUpdate: vi.fn(),
  downloadAndInstallAppUpdate: vi.fn(),
}))

it('keeps the unconfigured fork updater idle without requesting upstream metadata', async () => {
  const { checkForAppUpdate } = await import('../lib/appUpdater')
  const { result } = renderHook(() => useUpdater('stable'))
  await act(async () => {
    expect(await result.current.actions.checkForUpdates()).toEqual({ kind: 'up-to-date' })
  })
  expect(result.current.status.state).toBe('idle')
  expect(checkForAppUpdate).not.toHaveBeenCalled()
})
