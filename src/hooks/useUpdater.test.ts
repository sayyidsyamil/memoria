import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const checkForAppUpdate = vi.fn()

vi.mock('../mock-tauri', () => ({ isTauri: () => true }))
vi.mock('../lib/appUpdater', () => ({
  checkForAppUpdate: (...args: unknown[]) => checkForAppUpdate(...args),
  downloadAndInstallAppUpdate: vi.fn(),
}))

import { SHOW_UPSTREAM_LINKS } from '../constants/feedback'
import { useUpdater } from './useUpdater'

describe('useUpdater in a fork without an upstream release feed', () => {
  it('keeps the upstream links switched off', () => {
    expect(SHOW_UPSTREAM_LINKS).toBe(false)
  })

  it('never contacts the upstream update feed, at start-up or on request', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useUpdater('stable'))
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(checkForAppUpdate).not.toHaveBeenCalled()

    let outcome: unknown
    await act(async () => { outcome = await result.current.actions.checkForUpdates() })
    expect(outcome).toMatchObject({ kind: 'error', message: expect.stringContaining('turned off') })
    expect(checkForAppUpdate).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
