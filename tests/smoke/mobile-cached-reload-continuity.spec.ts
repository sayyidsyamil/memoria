import { createRequire } from 'node:module'
import { expect, test } from '@playwright/test'

const require = createRequire(import.meta.url)
const { initialWorkspacePending }: typeof import('../../apps/mobile/src/workspace/mobileVaultPresentation') =
  require('../../apps/mobile/src/workspace/mobileVaultPresentation')
const { readNativeWorkspaceStartupPreview }: typeof import('../../apps/mobile/src/workspace/nativeWorkspaceStartupPreview') =
  require('../../apps/mobile/src/workspace/nativeWorkspaceStartupPreview')

test('@smoke cached native workspace never exposes the full-screen loading flag during reload', () => {
  const selection = { vaultRootUri: 'file:///owned-smoke', vaultLabel: 'Owned smoke' }
  for (const phase of ['startup', 'foreground', 'post-sync', 'vault-switch']) {
    expect(initialWorkspacePending({ restorePending: true, active: { selection, git: null } }), phase).toBe(false)
  }
  expect(initialWorkspacePending({ restorePending: true, active: { selection: null, git: null } })).toBe(true)
})

test('@smoke ordered startup accepts slow cached navigation without granting cached write authority', async () => {
  const preview = { kind: 'provisional' as const, notes: [], allNotes: [], typeDefinitions: {}, sidebarSections: [], noteListSubtitle: '' }
  const events: string[] = []
  const result = await readNativeWorkspaceStartupPreview({ vaultRootUri: 'file:///owned-smoke', vaultLabel: 'Owned smoke' },
    undefined, { recover: () => { events.push('recover') }, readConfig: () => null,
      readPreview: async () => { await new Promise(resolve => setTimeout(resolve, 350)); return preview } }, true)
  expect(result).toBe(preview)
  expect(events).toEqual(['recover'])
  expect(result).not.toHaveProperty('sync')
})
