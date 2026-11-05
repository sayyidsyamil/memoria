import { expect, it, vi } from 'vitest'
import { createWorkspaceSyncEditors } from '../workspaceSyncEditors'
import { createGitEditorAccess } from './gitEditorAccess'

it('resumes the same editor after checkpoint and releases its block before network work', async () => {
  const editors = createWorkspaceSyncEditors()
  const resume = vi.fn()
  const refresh = vi.fn()
  editors.register(async () => resume, 'note')
  const access = createGitEditorAccess({ editors, refresh })
  expect(await access(async () => {
    expect(editors.isBlocked()).toBe(true)
    return { value: 'checkpoint', workspaceChanged: false }
  })).toBe('checkpoint')
  expect(editors.isBlocked()).toBe(false)
  expect(editors.generation()).toBe(0)
  expect(resume).toHaveBeenCalledOnce()
  expect(refresh).not.toHaveBeenCalled()
})

it('refreshes after changed or uncertain local mutations without discarding the selected note', async () => {
  const editors = createWorkspaceSyncEditors()
  editors.register(async () => () => {}, 'selected')
  const refresh = vi.fn()
  const access = createGitEditorAccess({ editors, refresh })
  await expect(access(async () => { throw new Error('checkout interrupted') })).rejects.toThrow('checkout interrupted')
  expect(refresh).toHaveBeenCalledWith('selected')
  expect(editors.isBlocked()).toBe(false)
})

it('does not invoke Git when the draft cannot be saved', async () => {
  const editors = createWorkspaceSyncEditors()
  editors.register(async () => { throw new Error('disk full') })
  const operation = vi.fn()
  await expect(createGitEditorAccess({ editors, refresh: vi.fn() })(operation)).rejects.toThrow('disk full')
  expect(operation).not.toHaveBeenCalled()
  expect(editors.isBlocked()).toBe(false)
})
