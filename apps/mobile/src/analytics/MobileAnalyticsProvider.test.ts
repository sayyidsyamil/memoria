import { beforeEach, expect, it, vi } from 'vitest'
import type { EffectCallback } from 'react'

const state = vi.hoisted(() => ({ ready: false, settings: { analytics: false, crashReporting: true },
  effects: [] as EffectCallback[], setEnabled: vi.fn() }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initialize: () => unknown) => [initialize()],
  useEffect: (effect: EffectCallback) => { state.effects.push(effect) },
}))
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-crypto', () => ({ randomUUID: () => 'test-session' }))
vi.mock('../settings/useMobileSettings', () => ({ useMobileSettings: () => state }))
vi.mock('./mobileTelemetryRuntime', () => ({ mobileRuntimeContext: () => ({}), mobileTelemetryConfig: () => ({ posthogKey: '' }) }))
vi.mock('./mobileSentry', () => ({ mobileCrashReporting: { setEnabled: state.setEnabled } }))

import { MobileAnalyticsProvider } from './MobileAnalyticsProvider'

beforeEach(() => { state.effects = []; state.setEnabled.mockClear() })

it('does not discard a pending native crash while persisted consent is still loading', () => {
  state.ready = false
  MobileAnalyticsProvider({ children: null })
  state.effects.forEach(effect => { effect() })
  expect(state.setEnabled).not.toHaveBeenCalled()
})

it('restores consent once ready and revokes it on cleanup', () => {
  state.ready = true
  MobileAnalyticsProvider({ children: null })
  const cleanup = state.effects[1]?.()
  expect(state.setEnabled).toHaveBeenCalledWith(true)
  cleanup?.()
  expect(state.setEnabled).toHaveBeenLastCalledWith(false)
})
