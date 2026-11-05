import { createRequire } from 'node:module'
import { expect, test } from '@playwright/test'

const require = createRequire(import.meta.url)
const { createGitEditorAccess }: typeof import('../../apps/mobile/src/workspace/git/gitEditorAccess') =
  require('../../apps/mobile/src/workspace/git/gitEditorAccess')
const { createWorkspaceSyncEditors }: typeof import('../../apps/mobile/src/workspace/workspaceSyncEditors') =
  require('../../apps/mobile/src/workspace/workspaceSyncEditors')
const { withWorkspaceOperation }: typeof import('../../apps/mobile/src/workspace/git/workspaceOperationQueue') =
  require('../../apps/mobile/src/workspace/git/workspaceOperationQueue')
const { withSavedWorkspace }: typeof import('../../apps/mobile/src/workspace/git/workspaceWriteQueue') =
  require('../../apps/mobile/src/workspace/git/workspaceWriteQueue')

test('@smoke a changed mobile sync awaits fresh indexing outside the disk lock before releasing editors', async () => {
  const editors = createWorkspaceSyncEditors()
  let resumed = false
  editors.register(async () => () => { resumed = true }, 'selected.md')
  let release = () => {}
  const pendingIndex = new Promise<void>(resolve => { release = resolve })
  const events: string[] = []
  const root = 'file:///owned-async-refresh-smoke'
  const access = createGitEditorAccess({ editors, rootUri: root, refresh: async selected => {
    expect(selected).toBe('selected.md')
    await withWorkspaceOperation(root, async () => { events.push('index') })
    await pendingIndex
    events.push('publish')
  } })
  const operation = access(() => withSavedWorkspace(root, async () => ({ value: 'merged', workspaceChanged: true })))
  await expect.poll(() => events).toEqual(['index'])
  expect(editors.isBlocked()).toBe(true)
  release()
  expect(await operation).toBe('merged')
  expect(events).toEqual(['index', 'publish'])
  expect(editors.isBlocked()).toBe(false)
  expect(resumed).toBe(false)
  expect(editors.generation()).toBe(1)
})
