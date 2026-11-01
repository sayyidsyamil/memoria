import { describe, expect, it } from 'vitest'
import type { VaultEntry } from '../types'
import { folderPathForRetargetEntry } from './noteRetargetingPaths'

function entry(path: string): VaultEntry {
  return { path, filename: path.split('/').pop() ?? path } as VaultEntry
}

describe('folderPathForRetargetEntry', () => {
  it('finds the folder of a desktop note under the vault', () => {
    expect(folderPathForRetargetEntry({ entry: entry('/vault/projects/plan.md'), vaultPath: '/vault/' })).toBe('projects')
    expect(folderPathForRetargetEntry({ entry: entry('C:\\vault\\a\\b\\plan.md'), vaultPath: 'C:\\vault' })).toBe('a/b')
  })

  it('treats a desktop note outside the vault as being at its root', () => {
    expect(folderPathForRetargetEntry({ entry: entry('/elsewhere/projects/plan.md'), vaultPath: '/vault' })).toBe('')
    expect(folderPathForRetargetEntry({ entry: entry('D:/elsewhere/plan.md'), vaultPath: '/vault' })).toBe('')
  })

  it('reads the folder from the vault-relative path a Memoria remote lists', () => {
    expect(folderPathForRetargetEntry({ entry: entry('projects/deep/plan.md'), vaultPath: '' })).toBe('projects/deep')
    expect(folderPathForRetargetEntry({ entry: entry('plan.md'), vaultPath: '/remote' })).toBe('')
  })
})
