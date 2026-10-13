import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { SHOW_AI_ONBOARDING_PROMPTS, needsTelemetryConsent, silentTelemetryConsent, telemetryKeysCompiledIn } from './firstRun'
import { useStartupScreenState } from '../hooks/useStartupScreenState'
import { useSilentTelemetryConsent } from '../hooks/useSilentTelemetryConsent'
import type { Settings } from '../types'

const NO_KEYS = { sentryDsn: '', sentryBuildVersion: '', sentryRelease: '', posthogKey: '', posthogHost: null }
const SENTRY_ONLY = { ...NO_KEYS, sentryDsn: 'https://key@o1.ingest.sentry.io/1' }
const POSTHOG_ONLY = { ...NO_KEYS, posthogKey: 'phc_example' }

beforeEach(() => {
  vi.stubEnv('VITE_SENTRY_DSN', '')
  vi.stubEnv('VITE_POSTHOG_KEY', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('first-run defaults for this fork', () => {
  it('keeps the inherited AI-agents prompt switched off', () => {
    expect(SHOW_AI_ONBOARDING_PROMPTS).toBe(false)
  })

  it('detects telemetry keys from either service', () => {
    expect(telemetryKeysCompiledIn(NO_KEYS)).toBe(false)
    expect(telemetryKeysCompiledIn(SENTRY_ONLY)).toBe(true)
    expect(telemetryKeysCompiledIn(POSTHOG_ONLY)).toBe(true)
  })

  it('asks for telemetry consent only when keys exist and no answer was stored', () => {
    expect(needsTelemetryConsent(null, NO_KEYS)).toBe(false)
    expect(needsTelemetryConsent(null, SENTRY_ONLY)).toBe(true)
    expect(needsTelemetryConsent(true, SENTRY_ONLY)).toBe(false)
    expect(needsTelemetryConsent(false, POSTHOG_ONLY)).toBe(false)
  })

  it('records "no" silently when nothing could be sent anyway', () => {
    expect(silentTelemetryConsent(null, NO_KEYS)).toBe(false)
    expect(silentTelemetryConsent(null, SENTRY_ONLY)).toBeNull()
    expect(silentTelemetryConsent(true, NO_KEYS)).toBeNull()
  })
})

const startupArgs = {
  aiAgentsPromptVisible: false,
  isNoteWindow: false,
  onboardingState: { status: 'ready', vaultPath: '/v' },
  runtimeMissingVaultPath: null,
  selectedVaultPath: '/v',
  settingsLoaded: true,
  showMcpSetupDialog: false,
  telemetryConsent: null,
  vaultIsLoading: false,
  vaultSwitcher: { allVaults: [{ path: '/v' }], loaded: true, vaultPath: '/v' },
}

describe('startup screen', () => {
  it('does not show the consent dialog in a build without telemetry keys', () => {
    const { result } = renderHook(() => useStartupScreenState(startupArgs))
    expect(result.current.shouldShowStartupScreen).toBe(false)
  })

  it('still shows the consent dialog when a Sentry DSN is compiled in', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://key@o1.ingest.sentry.io/1')
    const { result } = renderHook(() => useStartupScreenState(startupArgs))
    expect(result.current.shouldShowStartupScreen).toBe(true)
  })

  it('still shows the Get started step for a fresh install', () => {
    const { result } = renderHook(() => useStartupScreenState({ ...startupArgs, onboardingState: { status: 'welcome' } }))
    expect(result.current.shouldShowStartupScreen).toBe(true)
  })
})

describe('useSilentTelemetryConsent', () => {
  const settings = { telemetry_consent: null, crash_reporting_enabled: null, analytics_enabled: null, anonymous_id: null } as Settings

  it('stores telemetry_consent=false once when no keys are compiled in', () => {
    const save = vi.fn(() => Promise.resolve())
    renderHook(() => useSilentTelemetryConsent(settings, true, save))
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ telemetry_consent: false, crash_reporting_enabled: false, analytics_enabled: false }))
  })

  it('does nothing before settings load, after an answer, or when keys exist', () => {
    const save = vi.fn(() => Promise.resolve())
    renderHook(() => useSilentTelemetryConsent(settings, false, save))
    renderHook(() => useSilentTelemetryConsent({ ...settings, telemetry_consent: true }, true, save))
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_example')
    renderHook(() => useSilentTelemetryConsent(settings, true, save))
    expect(save).not.toHaveBeenCalled()
  })
})
