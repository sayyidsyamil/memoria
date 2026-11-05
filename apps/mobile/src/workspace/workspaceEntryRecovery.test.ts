import { expect, it, vi } from 'vitest'
import { changeNativeWorkspaceEntry } from './workspaceEntryRecovery'

it('routes move and deletion intent through the native recovery boundary', async () => {
  const changeWorkspaceEntry = vi.fn(async () => {})
  const module = { changeWorkspaceEntry, createWorkspaceOperationId: vi.fn().mockReturnValueOnce('move-1').mockReturnValueOnce('delete-2') }
  await changeNativeWorkspaceEntry('file:///vault', { path: 'before.md', toPath: 'after.md', directory: false }, module)
  await changeNativeWorkspaceEntry('file:///vault', { path: 'folder', directory: true }, module)
  expect(changeWorkspaceEntry.mock.calls).toEqual([
    ['file:///vault', 'before.md', 'after.md', false, 'move-1'],
    ['file:///vault', 'folder', null, true, 'delete-2'],
  ])
})

it('does not fall back after a native recovery failure', async () => {
  const changeWorkspaceEntry = vi.fn(async () => { throw new Error('externalChange') })
  const module = { changeWorkspaceEntry, createWorkspaceOperationId: () => 'failed-1' }
  await expect(changeNativeWorkspaceEntry('file:///vault', { path: 'note.md', directory: false }, module))
    .rejects.toThrow('externalChange')
})

it('retains an operation identifier across failure but not a subsequent successful command', async () => {
  const changeWorkspaceEntry = vi.fn().mockRejectedValueOnce(new Error('interrupted')).mockResolvedValue(undefined)
  const createWorkspaceOperationId = vi.fn().mockReturnValueOnce('attempt-1').mockReturnValueOnce('attempt-2')
  const module = { changeWorkspaceEntry, createWorkspaceOperationId }
  const change = { path: 'before.md', toPath: 'after.md', directory: false }
  await expect(changeNativeWorkspaceEntry('file:///vault', change, module)).rejects.toThrow('interrupted')
  await changeNativeWorkspaceEntry('file:///vault', change, module)
  await changeNativeWorkspaceEntry('file:///vault', change, module)
  expect(changeWorkspaceEntry.mock.calls.map((call) => call.at(-1))).toEqual(['attempt-1', 'attempt-1', 'attempt-2'])
  expect(createWorkspaceOperationId).toHaveBeenCalledTimes(2)
})

it('only uses the legacy adapter when no custom native module exists', () => {
  expect(changeNativeWorkspaceEntry('file:///vault', { path: 'note.md', directory: false }, null)).toBeNull()
  expect(() => changeNativeWorkspaceEntry('file:///vault', { path: 'note.md', directory: false }, {}))
    .toThrow('nativeEntryRecoveryUnavailable')
})
