// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { GitProgressEvent } from 'isomorphic-git'
import { useGitSyncProgress } from './useGitSyncProgress'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('throttles object updates while immediately publishing phase changes and completion', async () => {
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const test = await mountProgress()
  let report: (event: GitProgressEvent) => void = vi.fn()
  let finish = () => {}
  let job: Promise<void> | undefined
  try {
    await act(async () => { job = test.read().run(onProgress => {
      report = onProgress
      return new Promise<void>(resolve => { finish = resolve })
    }) })
    await act(async () => report({ phase: 'Receiving objects', loaded: 1, total: 100 }))
    await act(async () => report({ phase: 'Receiving objects', loaded: 2, total: 100 }))
    expect(test.read().progress?.loaded).toBe(1)
    now = 150
    await act(async () => report({ phase: 'Receiving objects', loaded: 50, total: 100 }))
    expect(test.read().progress?.loaded).toBe(50)
    await act(async () => report({ phase: 'Resolving deltas', loaded: 1, total: 10 }))
    expect(test.read().progress?.phase).toBe('Resolving deltas')
    await act(async () => report({ phase: 'Resolving deltas', loaded: 10, total: 10 }))
    expect(test.read().progress?.loaded).toBe(10)
    await act(async () => test.read().clear())
    expect(test.read().progress).toBeNull()
    await act(async () => { finish(); await job })
    await act(async () => report({ phase: 'Receiving objects', loaded: 99, total: 100 }))
    expect(test.read().progress).toBeNull()
  } finally { finish(); await job; await test.close() }
})

it('clears progress after transport failure and preserves the original failure', async () => {
  const test = await mountProgress()
  const failure = new Error('owned transport failure')
  try {
    await act(async () => {
      await expect(test.read().run(async report => {
        report({ phase: 'Counting objects', loaded: 10, total: 100 })
        throw failure
      })).rejects.toBe(failure)
    })
    expect(test.read().progress).toBeNull()
  } finally { await test.close() }
})

async function mountProgress() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const root = createRoot(document.createElement('div'))
  let current: ReturnType<typeof useGitSyncProgress> | undefined
  function Probe() {
    const value = useGitSyncProgress()
    useLayoutEffect(() => { current = value }, [value])
    return null
  }
  await act(async () => root.render(createElement(Probe)))
  return {
    read: () => { if (!current) throw new Error('Not mounted'); return current },
    close: () => act(async () => root.unmount()),
  }
}
