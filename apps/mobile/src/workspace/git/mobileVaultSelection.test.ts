import { expect, it } from 'vitest'
import { refreshedVault } from './mobileVaultSelection'
import { rememberPreparedWorkspaceSnapshot, takePreparedWorkspaceSnapshot } from '../preparedWorkspaceSnapshot'
import { buildLocalVaultWorkspaceSnapshot } from '../localVaultSnapshot'

function fixture() {
  const index = { directories: [], files: [] }
  const selection = { index, vaultAlias: 'fixture', vaultLabel: 'Fixture', vaultRootUri: 'file:///fixture' }
  const options = { files: index.files, folderPaths: index.directories, vaultAlias: selection.vaultAlias,
    vaultLabel: selection.vaultLabel, vaultPath: selection.vaultRootUri }
  return { next: { selection, git: null }, index, options, snapshot: buildLocalVaultWorkspaceSnapshot(options) }
}

it('keeps a freshly prepared selection through the controller refresh instead of dropping its launch index', () => {
  const f = fixture()
  rememberPreparedWorkspaceSnapshot(f.index, f.options, f.snapshot)
  const refreshed = refreshedVault(f.next, f.next, 'selected.md')
  expect(refreshed.selection?.index).toBe(f.index)
  expect(refreshed.selection?.selectedNoteId).toBe('selected.md')
  expect(f.next.selection).not.toHaveProperty('selectedNoteId')
  expect(takePreparedWorkspaceSnapshot(f.index, f.options)).toBe(f.snapshot)
})

it('still drops an old or consumed index when sync requires a fresh view of disk', () => {
  const f = fixture()
  expect(refreshedVault(f.next, f.next).selection?.index).toBeUndefined()
  rememberPreparedWorkspaceSnapshot(f.index, f.options, f.snapshot)
  takePreparedWorkspaceSnapshot(f.index, f.options)
  expect(refreshedVault(f.next, f.next).selection?.index).toBeUndefined()
})

it('does not copy the previous vault selection to a different root', () => {
  const f = fixture()
  rememberPreparedWorkspaceSnapshot(f.index, f.options, f.snapshot)
  const previous = { selection: { ...f.next.selection, vaultRootUri: 'file:///other' }, git: null }
  expect(refreshedVault(f.next, previous, 'other.md').selection?.selectedNoteId).toBeUndefined()
})

it('preserves a removed or absent selection', () => {
  const next = { selection: null, git: null }
  expect(refreshedVault(next, fixture().next)).toBe(next)
})
