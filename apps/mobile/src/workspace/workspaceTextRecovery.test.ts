import { expect, it, vi } from 'vitest'
import { recoverNativeWorkspaceText, writeNativeWorkspaceText } from './workspaceTextRecovery'

it('uses the native atomic writer without falling back after a rejected save', async () => {
  const saveWorkspaceText = vi.fn(async () => {})
  const module = { saveWorkspaceText, createWorkspaceOperationId: () => 'save-1', recoverWorkspaceText: vi.fn(() => false) }
  await expect(writeNativeWorkspaceText('file:///vault', 'note.md', 'draft', module)).resolves.toBeUndefined()
  expect(saveWorkspaceText).toHaveBeenCalledWith('file:///vault', 'note.md', 'draft', 'save-1')
  saveWorkspaceText.mockRejectedValue(new Error('externalChange'))
  await expect(writeNativeWorkspaceText('file:///vault', 'note.md', 'newer', module)).rejects.toThrow('externalChange')
})

it('distinguishes unavailable native support from a failed recovery', () => {
  expect(writeNativeWorkspaceText('file:///vault', 'note.md', 'draft', null)).toBeNull()
  expect(recoverNativeWorkspaceText('file:///vault', null)).toBe(false)
  const recoverWorkspaceText = vi.fn(() => true)
  expect(recoverNativeWorkspaceText('file:///vault', { recoverWorkspaceText })).toBe(true)
  expect(recoverWorkspaceText).toHaveBeenCalledWith('file:///vault')
  recoverWorkspaceText.mockImplementation(() => { throw new Error('invalidRecord') })
  expect(() => recoverNativeWorkspaceText('file:///vault', { recoverWorkspaceText })).toThrow('invalidRecord')
})

it('does not send Git virtual paths to a native filesystem', () => {
  const recoverWorkspaceText = vi.fn(() => true)
  expect(recoverNativeWorkspaceText('/vault', { recoverWorkspaceText })).toBe(false)
  expect(recoverWorkspaceText).not.toHaveBeenCalled()
})

it('does not silently downgrade an outdated standalone native module', () => {
  expect(() => writeNativeWorkspaceText('file:///vault', 'note.md', 'draft', {})).toThrow('nativeTextRecoveryUnavailable')
  expect(() => recoverNativeWorkspaceText('file:///vault', {})).toThrow('nativeTextRecoveryUnavailable')
})

it('reuses a failed save identifier but gives the next command a new identity', async () => {
  const saveWorkspaceText = vi.fn().mockRejectedValueOnce(new Error('interrupted')).mockResolvedValue(undefined)
  const createWorkspaceOperationId = vi.fn().mockReturnValueOnce('save-1').mockReturnValueOnce('save-2')
  const module = { saveWorkspaceText, createWorkspaceOperationId }
  await expect(writeNativeWorkspaceText('file:///vault', 'note.md', 'draft', module)).rejects.toThrow('interrupted')
  await writeNativeWorkspaceText('file:///vault', 'note.md', 'draft', module)
  await writeNativeWorkspaceText('file:///vault', 'note.md', 'draft', module)
  expect(saveWorkspaceText.mock.calls.map((call) => call.at(-1))).toEqual(['save-1', 'save-1', 'save-2'])
  expect(createWorkspaceOperationId).toHaveBeenCalledTimes(2)
})

it('does not confuse pending content or vault identities', async () => {
  const saveWorkspaceText = vi.fn().mockRejectedValueOnce(new Error('interrupted')).mockResolvedValue(undefined)
  const createWorkspaceOperationId = vi.fn()
    .mockReturnValueOnce('first').mockReturnValueOnce('different-content').mockReturnValueOnce('different-vault')
  const module = { saveWorkspaceText, createWorkspaceOperationId }
  await expect(writeNativeWorkspaceText('file:///one', 'note.md', 'draft', module)).rejects.toThrow('interrupted')
  await writeNativeWorkspaceText('file:///one', 'note.md', 'newer', module)
  await writeNativeWorkspaceText('file:///two', 'note.md', 'draft', module)
  await writeNativeWorkspaceText('file:///one', 'note.md', 'draft', module)
  expect(saveWorkspaceText.mock.calls.map((call) => call.at(-1)))
    .toEqual(['first', 'different-content', 'different-vault', 'first'])
})
