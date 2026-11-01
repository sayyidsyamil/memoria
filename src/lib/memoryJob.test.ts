import { expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { startMemoryJob } from './memoryJob'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))

it('scopes progress and cancellation to one job and releases the listener on failure', async () => {
  let handler: (event: { payload: { jobId: string; stage: string } }) => void = () => undefined
  const cleanup = vi.fn()
  vi.mocked(listen).mockImplementation(async (_event, callback) => { handler = callback; return cleanup })
  let reject: (error: Error) => void = () => undefined
  vi.mocked(invoke).mockImplementation(command => command === 'cancel_wiki_memory' ? Promise.resolve() : new Promise((_resolve, fail) => { reject = fail }))
  const progress = vi.fn()
  const job = startMemoryJob({ action: 'ask', vaultPath: '/vault' }, progress)
  await new Promise(resolve => setTimeout(resolve, 0))
  const args = vi.mocked(invoke).mock.calls[0][1] as { request: { jobId: string } }
  handler({ payload: { jobId: 'other', stage: 'wrong' } })
  handler({ payload: { jobId: args.request.jobId, stage: 'Loading model' } })
  expect(progress).toHaveBeenCalledExactlyOnceWith('Loading model')
  await job.cancel()
  expect(invoke).toHaveBeenLastCalledWith('cancel_wiki_memory', { jobId: args.request.jobId })
  reject(new Error('Cancelled'))
  await expect(job.promise).rejects.toThrow('Cancelled')
  expect(cleanup).toHaveBeenCalledOnce()
})
