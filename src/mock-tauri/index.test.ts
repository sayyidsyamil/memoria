import { afterEach, describe, expect, it, vi } from 'vitest'
import { isTauri, mockInvoke } from './index'

const originalIsTauri = (globalThis as { isTauri?: unknown }).isTauri
const windowWithLegacyMarkers = window as Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

describe('isTauri', () => {
  afterEach(() => {
    if (originalIsTauri === undefined) {
      delete (globalThis as { isTauri?: unknown }).isTauri
    } else {
      ;(globalThis as { isTauri?: unknown }).isTauri = originalIsTauri
    }

    delete windowWithLegacyMarkers.__TAURI__
    delete windowWithLegacyMarkers.__TAURI_INTERNALS__
  })

  it('prefers the Tauri v2 global runtime flag', () => {
    ;(globalThis as { isTauri?: unknown }).isTauri = true

    expect(isTauri()).toBe(true)
  })

  it('respects an explicit false runtime flag', () => {
    ;(globalThis as { isTauri?: unknown }).isTauri = false
    windowWithLegacyMarkers.__TAURI__ = {}

    expect(isTauri()).toBe(false)
  })

  it('falls back to the legacy window markers when the runtime flag is absent', () => {
    delete (globalThis as { isTauri?: unknown }).isTauri
    windowWithLegacyMarkers.__TAURI_INTERNALS__ = {}

    expect(isTauri()).toBe(true)
  })
})

describe('mockInvoke latency', () => {
  const remoteGlobals = window as Window & { MEMORIA_REMOTE_URL?: string; MEMORIA_REMOTE_TOKEN?: string }

  afterEach(() => {
    delete remoteGlobals.MEMORIA_REMOTE_URL
    delete remoteGlobals.MEMORIA_REMOTE_TOKEN
    vi.useRealTimers()
  })

  async function settlesWithoutTimers(): Promise<boolean> {
    vi.useFakeTimers()
    let settled = false
    void mockInvoke('get_build_number').then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(0)
    return settled
  }

  it('keeps simulating IPC latency for demo data', async () => {
    expect(await settlesWithoutTimers()).toBe(false)
  })

  it('answers at once on a Memoria remote, so startup is not held back (TOL-206)', async () => {
    remoteGlobals.MEMORIA_REMOTE_URL = 'https://memoria.example'
    remoteGlobals.MEMORIA_REMOTE_TOKEN = 'token-not-a-secret'

    expect(await settlesWithoutTimers()).toBe(true)
  })
})
