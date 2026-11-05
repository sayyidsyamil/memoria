import { expect, it } from 'vitest'
import { vaultSyncStatus } from './useVaultSyncPresentation'

it('prioritizes a failed local save over the absence of a remote', () => {
  expect(vaultSyncStatus(false, 'pending', { kind: 'writeFailed' })).toEqual({
    status: 'saveFailed', label: 'Could not save local changes. Retry saving before switching or syncing vaults.', retry: true,
  })
})

it('keeps a save-barrier failure visible even when the current editor has no write failure', () => {
  expect(vaultSyncStatus(false, 'saveFailed', { kind: 'synced' }).retry).toBe(true)
})

it('does not offer remote sync for a healthy local-only vault', () => {
  expect(vaultSyncStatus(false, 'pending', { kind: 'synced' })).toEqual({ status: 'pending', label: 'Local only', retry: false })
})

it('preserves divergence instead of offering a destructive repair', () => {
  expect(vaultSyncStatus(true, 'diverged', { kind: 'synced' })).toMatchObject({ status: 'diverged', retry: false })
})
