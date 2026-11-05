import { expect, it, vi } from 'vitest'
import { withSavedWorkspace } from './workspaceWriteQueue'
import { recoverNativeWorkspaceText } from '../workspaceTextRecovery'

vi.mock('../workspaceTextRecovery', () => ({ recoverNativeWorkspaceText: vi.fn() }))

it('recovers persisted editor writes before a Git operation can read files', async () => {
  const events: string[] = []
  vi.mocked(recoverNativeWorkspaceText).mockImplementation(() => { events.push('recovered'); return true })
  await withSavedWorkspace('file:///recovery-before-git', async recovered => {
    expect(recovered).toBe(true)
    events.push('git')
  })
  expect(events).toEqual(['recovered', 'git'])
})

it('blocks Git when the pending save cannot be recovered safely', async () => {
  vi.mocked(recoverNativeWorkspaceText).mockImplementation(() => { throw new Error('externalChange') })
  const sync = vi.fn()
  await expect(withSavedWorkspace('file:///conflicted-recovery', sync)).rejects.toThrow('externalChange')
  expect(sync).not.toHaveBeenCalled()
})

it('reports a clean recovery check without changing the operation result', async () => {
  vi.mocked(recoverNativeWorkspaceText).mockReturnValue(false)
  const run = vi.fn(async (recovered: boolean) => ({ recovered, oid: 'local-checkpoint' }))
  expect(await withSavedWorkspace('file:///no-recovery-needed', run))
    .toEqual({ recovered: false, oid: 'local-checkpoint' })
  expect(run).toHaveBeenCalledExactlyOnceWith(false)
})
