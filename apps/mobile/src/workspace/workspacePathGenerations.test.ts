import { expect, it } from 'vitest'
import { beginWorkspacePathIndex, trackWorkspacePathWrites } from './workspacePathGenerations'

it('collects unique writes by index pass and clears each reconciled batch', () => {
  const first = beginWorkspacePathIndex('file:///fixture-vault')
  trackWorkspacePathWrites('file:///fixture-vault', ['notes/changed.md', 'notes/changed.md'])
  expect(first.takeChangedPaths()).toEqual(['notes/changed.md'])
  expect(first.takeChangedPaths()).toEqual([])
  first.finish()

  const next = beginWorkspacePathIndex('file:///fixture-vault')
  expect(next.takeChangedPaths()).toEqual([])
  next.finish()
})
