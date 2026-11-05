import { expect, it } from 'vitest'
import { mobileUpdateDiagnostics } from './mobileUpdateDiagnostics'
import type { MobileUpdateRuntime, MobileUpdateState } from './mobileUpdateChannel.types'

const state: MobileUpdateState = { selected: 'stable', phase: 'idle', busy: false, checkedAt: null }
const runtime: MobileUpdateRuntime = {
  available: true, channel: 'alpha', updateId: '01a15fd5-a0e1-7840-bdb9-8619f6c36f73',
  appVersion: '0.1.0', buildVersion: '2', runtimeVersion: '223f31e5f754fd4058e2ad089fa0255f7ef4bfaf', isEmbeddedLaunch: false,
  setChannel: () => {}, check: async () => false, fetch: async () => true, reload: async () => {},
}

it('shows the native version, full running UUID and runtime independently of the selected channel', () => {
  const result = mobileUpdateDiagnostics(runtime, state)
  expect(result.build).toBe('App 0.1.0 (build 2)')
  expect(result.running).toBe('Running OTA: 01a15fd5-a0e1-7840-bdb9-8619f6c36f73')
  expect(result.runtime).toContain(runtime.runtimeVersion)
  expect(result.status).toBe('Not checked on Stable yet.')
  expect(result.checked).toBeNull()
})

it('distinguishes updates with the same UUID time prefix', () => {
  const other = { ...runtime, updateId: '01a15fd5-a0e1-7840-bdb9-8619f6c36f74' }
  expect(mobileUpdateDiagnostics(other, state).running).not.toBe(mobileUpdateDiagnostics(runtime, state).running)
})

it('does not infer a downloaded update channel from native or compiled Alpha metadata', () => {
  const result = mobileUpdateDiagnostics(runtime, { ...state, phase: 'current', checkedAt: 1792609200000 })
  expect(result.running).not.toContain('Alpha')
  expect(result.status).toBe('No newer compatible update found on Stable.')
  expect(result.checked).toContain(new Date(1792609200000).toLocaleString())
})

it('distinguishes embedded builds and unknown identity without guessing', () => {
  expect(mobileUpdateDiagnostics({ ...runtime, isEmbeddedLaunch: true }, state).running).toBe('Embedded build')
  for (const missing of [null, '']) {
    const unknown = mobileUpdateDiagnostics({ ...runtime, updateId: missing, appVersion: missing, buildVersion: missing, runtimeVersion: missing }, state)
    expect(unknown.running).toBe('Running OTA: Unknown')
    expect(unknown.build).toBe('App Unknown (build Unknown)')
    expect(unknown.runtime).toBe('Runtime: Unknown')
  }
})

it('shows a failure with the previous check time instead of claiming current freshness', () => {
  const result = mobileUpdateDiagnostics(runtime, { ...state, phase: 'failed', checkedAt: 1792609200000 })
  expect(result.status).toBe('Could not update. Your notes are unchanged.')
  expect(result.checked).toContain(new Date(1792609200000).toLocaleString())
})
