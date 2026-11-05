// @vitest-environment jsdom
import { act, createElement, useEffect, useSyncExternalStore } from 'react'
import type { GitProgressEvent } from 'isomorphic-git'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useGitCloneProgress, type GitCloneControl } from './useGitCloneProgress'

const roots: ReturnType<typeof createRoot>[] = []
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('publishes real progress without rerendering for every object', async () => {
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const current = await mountProgress()
  const job = deferredJob()
  let finished: Promise<void>
  await act(async () => { finished = current().run(job.start) })
  await act(async () => { job.options().onProgress({ phase: 'Receiving objects', loaded: 1, total: 100 }) })
  expect(current().progress.snapshot()?.loaded).toBe(1)
  await act(async () => { job.options().onProgress({ phase: 'Receiving objects', loaded: 2, total: 100 }) })
  expect(current().progress.snapshot()?.loaded).toBe(1)
  now = 150
  await act(async () => { job.options().onProgress({ phase: 'Receiving objects', loaded: 50, total: 100 }) })
  expect(current().progress.snapshot()?.loaded).toBe(50)
  await act(async () => { job.options().onProgress({ phase: 'Receiving objects', loaded: 100, total: 100 }) })
  expect(current().progress.snapshot()?.loaded).toBe(100)
  await act(async () => { job.finish(); await finished })
  expect(current().progress.snapshot()).toBeNull()
  expect(current().running).toBe(false)
})

it('updates clone progress without rerendering the surrounding workspace', async () => {
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const workspaceRendered = vi.fn()
  const progressObserved = vi.fn()
  const current = await mountProgress(workspaceRendered, progressObserved)
  const job = deferredJob()
  let finished: Promise<void>
  await act(async () => { finished = current().run(job.start) })
  const initialRenders = workspaceRendered.mock.calls.length
  for (let loaded = 1; loaded <= 30; loaded++) {
    now += 101
    await act(async () => { job.options().onProgress({ phase: 'Receiving objects', loaded, total: 30 }) })
  }
  expect(progressObserved).toHaveBeenLastCalledWith({ phase: 'Receiving objects', loaded: 30, total: 30 })
  expect(progressObserved).toHaveBeenCalledTimes(31)
  await act(async () => { job.finish(); await finished })
  expect(progressObserved).toHaveBeenLastCalledWith(null)
  expect(workspaceRendered).toHaveBeenCalledTimes(initialRenders + 1)
})

it('keeps cancellation pending until the storage operation has finished cleanup', async () => {
  const current = await mountProgress()
  const job = deferredJob()
  let finished: Promise<void>
  await act(async () => { finished = current().run(job.start) })
  await act(async () => current().cancel())
  expect(job.options().signal.aborted).toBe(true)
  expect(current().cancelling).toBe(true)
  expect(current().running).toBe(true)
  await act(async () => { job.finish(); await finished })
  expect(current().running).toBe(false)
  expect(current().cancelling).toBe(false)
})

it('ignores late callbacks from a finished clone and does not overlap jobs', async () => {
  const current = await mountProgress()
  const job = deferredJob()
  let finished: Promise<void>
  await act(async () => { finished = current().run(job.start) })
  const duplicate = vi.fn()
  await expect(current().run(duplicate)).rejects.toThrow('cloneInProgress')
  expect(duplicate).not.toHaveBeenCalled()
  await act(async () => { job.finish(); await finished })
  await act(async () => { job.options().onProgress({ phase: 'Updating workdir', loaded: 1, total: 10 }) })
  expect(current().progress.snapshot()).toBeNull()
})

it('stops accepting cancellation once the completed clone is being published', async () => {
  const current = await mountProgress()
  const job = deferredJob()
  let finished: Promise<void>
  await act(async () => { finished = current().run(job.start) })
  await act(async () => job.options().onPublish())
  expect(current().publishing).toBe(true)
  await act(async () => current().cancel())
  expect(job.options().signal.aborted).toBe(false)
  expect(current().cancelling).toBe(false)
  await act(async () => { job.finish(); await finished })
  expect(current().publishing).toBe(false)
})

function deferredJob() {
  let options: GitCloneControl
  let finish = () => {}
  const start = (value: typeof options) => {
    options = value
    return new Promise<void>(resolve => { finish = resolve })
  }
  return { start, options: () => options, finish: () => finish() }
}

async function mountProgress(onRender = () => {}, onProgress: (progress: GitProgressEvent | null) => void = () => {}) {
  const root = createRoot(document.createElement('div'))
  roots.push(root)
  let current: ReturnType<typeof useGitCloneProgress>
  function Probe() {
    onRender()
    const progress = useGitCloneProgress()
    useEffect(() => { current = progress }, [progress])
    return createElement(ProgressProbe, { progress: progress.progress, onProgress })
  }
  await act(async () => root.render(createElement(Probe)))
  return () => current
}

function ProgressProbe({ progress, onProgress }: {
  progress: ReturnType<typeof useGitCloneProgress>['progress']
  onProgress: (progress: GitProgressEvent | null) => void
}) {
  const value = useSyncExternalStore(progress.subscribe, progress.snapshot, progress.snapshot)
  useEffect(() => { onProgress(value) }, [value, onProgress])
  return null
}
