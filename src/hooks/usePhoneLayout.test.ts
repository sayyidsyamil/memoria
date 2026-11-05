import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PHONE_LAYOUT_QUERY, usePhoneLayout } from './usePhoneLayout'
import { stubPhoneMedia } from '../test-utils/phoneLayout'

describe('usePhoneLayout', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('follows the phone-width media query', () => {
    const media = stubPhoneMedia(true)
    const { result } = renderHook(() => usePhoneLayout(true))
    expect(result.current).toBe(true)
    expect(window.matchMedia).toHaveBeenCalledWith(PHONE_LAYOUT_QUERY)

    act(() => { media.setMatches(false) })
    expect(result.current).toBe(false)
  })

  it('is never a phone when disabled', () => {
    stubPhoneMedia(true)
    const { result } = renderHook(() => usePhoneLayout(false))
    expect(result.current).toBe(false)
  })

  it('is not a phone without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined)
    const { result } = renderHook(() => usePhoneLayout(true))
    expect(result.current).toBe(false)
  })
})
