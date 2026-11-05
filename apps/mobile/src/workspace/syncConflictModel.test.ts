import { expect, it } from 'vitest'
import { completeConflictChoices } from './syncConflictModel'

it('allows continuation when a fresh comparison has no remaining conflicts', () => {
  expect(completeConflictChoices([], {})).toBe(true)
})

it('requires a recognized own choice for every affected path', () => {
  const files = [{ path: 'note.md' }, { path: 'constructor' }]
  expect(completeConflictChoices(files, { 'note.md': 'local' })).toBe(false)
  expect(completeConflictChoices(files, { 'note.md': 'local', constructor: 'both' } as const)).toBe(true)
})
