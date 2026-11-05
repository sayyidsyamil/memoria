import { expect, it, vi } from 'vitest'
import { nativeWorkspaceTextBatchWriter } from './workspaceTextRecovery'

const changes = [{ path: 'first.md', content: '# First' }, { path: 'second.md', content: '# Second' }]

it('exposes no batch capability without the standalone native module', () => {
  expect(nativeWorkspaceTextBatchWriter(null)).toBeUndefined()
})

it('fails closed for an outdated standalone binary', async () => {
  const write = nativeWorkspaceTextBatchWriter({})
  expect(write).toBeTypeOf('function')
  await expect(async () => write?.('file:///vault', changes)).rejects.toThrow('nativeTextRecoveryUnavailable')
})

it('keeps the batch identity across failures and renews it after success', async () => {
  const saveWorkspaceTexts = vi.fn().mockRejectedValueOnce(new Error('interrupted')).mockResolvedValue(undefined)
  const createWorkspaceOperationId = vi.fn().mockReturnValueOnce('first').mockReturnValueOnce('next')
  const write = nativeWorkspaceTextBatchWriter({ saveWorkspaceTexts, createWorkspaceOperationId })
  await expect(write?.('file:///vault', changes)).rejects.toThrow('interrupted')
  await write?.('file:///vault', changes)
  await write?.('file:///vault', changes)
  expect(saveWorkspaceTexts.mock.calls).toEqual([
    ['file:///vault', changes, 'first'], ['file:///vault', changes, 'first'], ['file:///vault', changes, 'next'],
  ])
})

it('keeps pending identities separate for other vaults and other payloads', async () => {
  const saveWorkspaceTexts = vi.fn().mockRejectedValueOnce(new Error('interrupted')).mockResolvedValue(undefined)
  const createWorkspaceOperationId = vi.fn().mockReturnValueOnce('first').mockReturnValueOnce('vault').mockReturnValueOnce('payload')
  const write = nativeWorkspaceTextBatchWriter({ saveWorkspaceTexts, createWorkspaceOperationId })
  await expect(write?.('file:///one', changes)).rejects.toThrow('interrupted')
  await write?.('file:///two', changes)
  await write?.('file:///one', [{ path: 'first.md', content: '# Later' }])
  await write?.('file:///one', changes)
  expect(saveWorkspaceTexts.mock.calls.map((call) => call.at(-1))).toEqual(['first', 'vault', 'payload', 'first'])
})
