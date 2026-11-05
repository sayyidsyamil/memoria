import { expect, it } from 'vitest'
import { gitCloneProgressLabel } from './gitCloneProgressLabel'

it('names actual phases and shows per-phase counts instead of an overall percentage', () => {
  const result = gitCloneProgressLabel({ progress: { phase: 'Receiving objects', loaded: 240, total: 3000 } })
  expect(result.label).toBe('Downloading objects...')
  expect(result.count).toBe('240 of 3,000')
  expect(result.value).toEqual({ min: 0, max: 3000, now: 240 })
  expect(gitCloneProgressLabel({ progress: { phase: 'Updating workdir', loaded: 12, total: 20 } }).label).toBe('Writing files...')
})

it('handles unknown totals and phase names without invented progress', () => {
  expect(gitCloneProgressLabel({ progress: { phase: 'Analyzing workdir', loaded: 20, total: 0 } }).count).toBe('20')
  expect(gitCloneProgressLabel({ progress: null }).count).toBeNull()
  expect(gitCloneProgressLabel({ progress: { phase: 'Future phase', loaded: 0, total: 0 } }).label).toBe('Cloning repository...')
})

it('distinguishes cancelling from publishing a completed clone', () => {
  expect(gitCloneProgressLabel({ cancelling: true }).label).toBe('Cancelling...')
  expect(gitCloneProgressLabel({ publishing: true }).label).toBe('Opening vault...')
  expect(gitCloneProgressLabel({ publishing: true, progress: { phase: 'Receiving objects', loaded: 20, total: 20 } }).count).toBeNull()
})
