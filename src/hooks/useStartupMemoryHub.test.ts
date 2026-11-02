import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { APP_STORAGE_KEYS } from '../constants/appStorage'
import { resetStartupMemoryHub, useStartupMemoryHub } from './useStartupMemoryHub'

beforeEach(() => {
  localStorage.clear()
  resetStartupMemoryHub()
})
afterEach(() => { vi.useRealTimers() })

it('waits until it is known whether the workspace holds memory, then opens once', () => {
  const open = vi.fn()
  const { rerender } = renderHook(({ holds }) => useStartupMemoryHub(holds, open), { initialProps: { holds: undefined as boolean | undefined } })
  expect(open).not.toHaveBeenCalled()
  rerender({ holds: true })
  expect(open).toHaveBeenCalledTimes(1)
  rerender({ holds: false })
  rerender({ holds: true })
  expect(open).toHaveBeenCalledTimes(1)
})

it('decides once per app session, even when the sidebar is shown again', () => {
  const open = vi.fn()
  renderHook(() => useStartupMemoryHub(false, open)).unmount()
  renderHook(() => useStartupMemoryHub(true, open))
  expect(open).not.toHaveBeenCalled()
})

it('leaves a note that is being reopened in front', () => {
  localStorage.setItem(APP_STORAGE_KEYS.lastActiveNotePath, '/vault/plan.md')
  const open = vi.fn()
  renderHook(() => useStartupMemoryHub(true, open))
  expect(open).not.toHaveBeenCalled()
})

it('does not open once the app has long finished starting', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  resetStartupMemoryHub()
  vi.setSystemTime(Date.now() + 31_000)
  const open = vi.fn()
  renderHook(() => useStartupMemoryHub(true, open))
  expect(open).not.toHaveBeenCalled()
})
