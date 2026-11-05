import { describe, expect, it } from 'vitest'
import { mobileWorkspaceHasNoVault } from './mobileWorkspaceEmptyState'
import type { MobileWorkspaceSnapshot } from './mobileWorkspaceModel'

describe('mobileWorkspaceHasNoVault', () => {
  it('recognizes first launch before a vault has been selected', () => {
    expect(mobileWorkspaceHasNoVault(snapshot({ kind: 'noVault' }))).toBe(true)
  })

  it('does not treat an opened empty vault as missing', () => {
    expect(mobileWorkspaceHasNoVault(snapshot({ kind: 'synced' }))).toBe(false)
  })
})

function snapshot(sync: MobileWorkspaceSnapshot['sync']): MobileWorkspaceSnapshot {
  return {
    editorBlocks: [],
    editorBullets: [],
    noteListSubtitle: '',
    notes: [],
    sidebarSections: [],
    sync,
  }
}
