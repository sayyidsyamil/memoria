import { expect, it } from 'vitest'
import {
  acknowledgePendingPaths, markPendingPaths, pendingNotePath,
  validPendingSyncFields, workspacePendingWritePaths,
} from './mobilePendingChanges'

it('tracks paths without mutating older checkpoints and deduplicates repeated edits', () => {
  const first = markPendingPaths({}, ['first.md', 'second.md', 'first.md'])
  const next = markPendingPaths(first, ['first.md'])
  expect(first).toEqual({ pendingRevision: 1, pendingPaths: [
    { path: 'first.md', revision: 1 }, { path: 'second.md', revision: 1 },
  ] })
  expect(next.pendingPaths).toEqual([
    { path: 'first.md', revision: 2 }, { path: 'second.md', revision: 1 },
  ])
})

it('preserves edits made during a checkpoint, including another edit to the same note', () => {
  const first = markPendingPaths({}, ['same.md', 'older.md'])
  const edited = markPendingPaths(first, ['same.md', 'new.md'])
  expect(acknowledgePendingPaths(edited, first.pendingRevision)).toEqual({
    pendingRevision: 2, pendingPaths: [
      { path: 'same.md', revision: 2 }, { path: 'new.md', revision: 2 },
    ],
  })
  const clean = acknowledgePendingPaths(edited, edited.pendingRevision)
  expect(clean.pendingPaths).toEqual([])
  expect(markPendingPaths(clean, ['later.md']).pendingRevision).toBe(3)
})

it('records both sides of moves while excluding configuration-only writes from note markers', () => {
  expect(workspacePendingWritePaths([
    { kind: 'saveNote', path: 'same.md', content: '# Changed' },
    { kind: 'moveNote', path: 'same.md', toPath: 'folder/renamed.md' },
    { kind: 'renameFolder', path: 'before', toPath: 'after' },
    { kind: 'saveVaultConfig', config: {} },
  ])).toEqual(['same.md', 'folder/renamed.md', 'before', 'after'])
})

it('marks notes below a renamed folder without marking similarly named siblings', () => {
  const paths = new Set(['one.md', 'folder'])
  expect(pendingNotePath(paths, 'one.md')).toBe(true)
  expect(pendingNotePath(paths, 'folder/nested/two.md')).toBe(true)
  expect(pendingNotePath(paths, 'folders/two.md')).toBe(false)
  expect(pendingNotePath(paths, 'other.md')).toBe(false)
})

it('accepts old ledgers and validates durable per-note revisions', () => {
  expect(validPendingSyncFields({})).toBe(true)
  expect(validPendingSyncFields(markPendingPaths({}, ['note.md']))).toBe(true)
  const invalid = [
    { pendingRevision: 1 },
    { pendingRevision: 1, pendingPaths: null },
    { pendingRevision: -1, pendingPaths: [] },
    { pendingRevision: 1, pendingPaths: [{ path: '../outside.md', revision: 1 }] },
    { pendingRevision: 1, pendingPaths: [{ path: '/outside.md', revision: 1 }] },
    { pendingRevision: 1, pendingPaths: [{ path: 'note.md', revision: 2 }] },
    { pendingRevision: 1, pendingPaths: [{ path: 'note.md', revision: 0 }] },
    { pendingRevision: 1, pendingPaths: [{ path: 'note.md', revision: '1' }] },
  ]
  for (const value of invalid) expect(validPendingSyncFields(value)).toBe(false)
})
