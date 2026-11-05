import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { postNativeQaEvent, setNativeQaSinkUrl } from './nativeQaSink'
import { runNativeWriteRecoveryProbe } from './nativeWriteRecoveryProbe'

const native = vi.hoisted(() => ({ available: true, enabled: true, run: vi.fn() }))
vi.mock('expo', () => ({ requireOptionalNativeModule: () => native.available
  ? { nativeStorageQAEnabled: native.enabled, runTextRecoveryProbe: native.run } : null }))
vi.mock('../workspace/expoWorkspaceFileSystem', () => ({ expoWorkspaceFileSystem: {} }))

beforeEach(() => {
  native.available = true
  native.enabled = true
  native.run.mockReset().mockResolvedValue({ pending: true, privateJournal: true })
  vi.stubGlobal('__DEV__', false)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}))
})
afterEach(() => { setNativeQaSinkUrl(null); vi.unstubAllGlobals() })

it.each([null, 'http://127.0.0.1:43211/layout'])('retains its proof destination when the layout sink becomes %s', async replacement => {
  const result = deferred<{ pending: boolean; privateJournal: boolean }>()
  native.run.mockReturnValue(result.promise)
  const pending = runNativeWriteRecoveryProbe('http://127.0.0.1:43210/', 'prepare')
  setNativeQaSinkUrl(replacement)
  result.resolve({ pending: true, privateJournal: true })
  await pending
  expect(fetch).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:43210/proof', expect.objectContaining({
    body: JSON.stringify({ phase: 'prepare', passed: true, checks: { journalPublished: true, privateJournal: true } }),
    redirect: 'error', credentials: 'omit',
  }))
  postNativeQaEvent({ id: 'layout' })
  if (replacement) expect(fetch).toHaveBeenLastCalledWith(replacement, expect.objectContaining({ body: '{"id":"layout"}' }))
  else expect(fetch).toHaveBeenCalledTimes(1)
})

it('delivers a failure to its original collector after the shared sink is cleared', async () => {
  const result = deferred<never>()
  native.run.mockReturnValue(result.promise)
  const pending = runNativeWriteRecoveryProbe('http://127.0.0.1:43210/', 'prepare')
  setNativeQaSinkUrl(null)
  result.reject(new Error('native probe failed'))
  await pending
  expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:43210/proof', expect.objectContaining({
    body: JSON.stringify({ phase: 'prepare', passed: false, error: 'native probe failed' }),
  }))
})

it.each(['invalid', 'https://127.0.0.1/', 'http://localhost/', 'http://example.com/',
  'http://user:password@127.0.0.1/', 'file:///tmp/qa'])('does not run native work or transmit for %s', async endpoint => {
  await expect(runNativeWriteRecoveryProbe(endpoint, 'prepare')).resolves.toBeUndefined()
  expect(native.run).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
  await runNativeWriteRecoveryProbe('http://127.0.0.1:43210/', 'prepare')
  expect(native.run).toHaveBeenCalledOnce()
})

it.each(['absent', 'disabled'])('cannot start native recovery when QA capability is %s', async capability => {
  native.available = capability !== 'absent'
  native.enabled = false
  await runNativeWriteRecoveryProbe('http://127.0.0.1:43210/', 'prepare')
  expect(native.run).not.toHaveBeenCalled()
  expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:43210/proof', expect.objectContaining({
    body: JSON.stringify({ phase: 'prepare', passed: false, error: 'nativeTextRecoveryUnavailable' }),
  }))
})

it('keeps proof reporting failures from leaving the runner busy', async () => {
  vi.mocked(fetch).mockRejectedValue(new Error('collector unavailable'))
  await runNativeWriteRecoveryProbe('http://127.0.0.1:43210/', 'prepare')
  await runNativeWriteRecoveryProbe('http://127.0.0.1:43210/', 'cleanup')
  expect(native.run).toHaveBeenNthCalledWith(2, 'cleanup')
})

it('retains the existing development-build authorization while still requiring the native method', async () => {
  vi.stubGlobal('__DEV__', true)
  native.enabled = false
  await runNativeWriteRecoveryProbe('http://127.0.0.1:43210/', 'prepare')
  expect(native.run).toHaveBeenCalledOnce()
})

it('does not overlap recovery runs or replace the pending run collector', async () => {
  const result = deferred<{ pending: boolean; privateJournal: boolean }>()
  native.run.mockReturnValue(result.promise)
  const pending = runNativeWriteRecoveryProbe('http://127.0.0.1:43210/', 'prepare')
  await runNativeWriteRecoveryProbe('http://127.0.0.1:43211/', 'cleanup')
  expect(native.run).toHaveBeenCalledExactlyOnceWith('prepare')
  result.resolve({ pending: true, privateJournal: true })
  await pending
  expect(fetch).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:43210/proof', expect.anything())
})

it('reports non-Error failures safely and can retry after an invalid phase', async () => {
  native.run.mockRejectedValueOnce('not an Error')
  await runNativeWriteRecoveryProbe('http://127.0.0.1:43210/', 'prepare')
  expect(fetch).toHaveBeenLastCalledWith('http://127.0.0.1:43210/proof', expect.objectContaining({
    body: JSON.stringify({ phase: 'prepare', passed: false, error: 'unknown' }),
  }))
  await runNativeWriteRecoveryProbe('http://127.0.0.1:43210/', 'invalid')
  expect(native.run).toHaveBeenCalledOnce()
})

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: Error) => void = () => {}
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
