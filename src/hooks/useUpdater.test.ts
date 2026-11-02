import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useUpdater } from './useUpdater'
import { checkForAppUpdate, downloadAndInstallAppUpdate } from '../lib/appUpdater'
import { isTauri } from '../mock-tauri'
import { openExternalUrl } from '../utils/url'

vi.mock('../mock-tauri', () => ({ isTauri: vi.fn(() => false) }))
vi.mock('../lib/appUpdater', () => ({ checkForAppUpdate: vi.fn(), downloadAndInstallAppUpdate: vi.fn() }))
vi.mock('../utils/url', () => ({ openExternalUrl: vi.fn() }))

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

describe('useUpdater without a signed Memoria release feed', () => {
  it('starts in idle state', () => {
    expect(renderHook(() => useUpdater('stable')).result.current.status).toEqual({ state: 'idle' })
  })

  it.each([false, true])('does not request metadata automatically or manually (native=%s)', async native => {
    vi.useFakeTimers()
    vi.mocked(isTauri).mockReturnValue(native)
    const { result } = renderHook(() => useUpdater('stable'))
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    await act(async () => {
      expect(await result.current.actions.checkForUpdates()).toEqual({ kind: 'up-to-date' })
    })
    expect(result.current.status).toEqual({ state: 'idle' })
    expect(checkForAppUpdate).not.toHaveBeenCalled()
  })

  it('does not automatically check for updates when automatic checks are disabled', async () => {
    vi.useFakeTimers()
    vi.mocked(isTauri).mockReturnValue(true)
    renderHook(() => useUpdater('stable', false))
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(checkForAppUpdate).not.toHaveBeenCalled()
  })

  it('never downloads an update without eligible metadata', async () => {
    const { result } = renderHook(() => useUpdater('stable'))
    await act(async () => { await result.current.actions.startDownload() })
    expect(downloadAndInstallAppUpdate).not.toHaveBeenCalled()
    expect(result.current.status).toEqual({ state: 'idle' })
  })

  it('dismiss resets the banner state', () => {
    const { result } = renderHook(() => useUpdater('stable'))
    act(() => result.current.actions.dismiss())
    expect(result.current.status).toEqual({ state: 'idle' })
  })

  it('openReleaseNotes opens the release notes page', () => {
    const { result } = renderHook(() => useUpdater('stable'))
    act(() => result.current.actions.openReleaseNotes())
    expect(openExternalUrl).toHaveBeenCalledWith('https://tolaria.md/releases/')
  })
})
