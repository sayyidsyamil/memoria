import fs from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import git from 'isomorphic-git'
import { afterEach, expect, it, vi } from 'vitest'
import { ensureGitMergeHistory } from './gitHistory'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture(boundary?: string) {
  const dir = await mkdtemp(join(tmpdir(), 'memoria-history-guard-'))
  roots.push(dir)
  await mkdir(join(dir, '.git'))
  if (boundary) await writeFile(join(dir, '.git/shallow'), boundary)
  vi.spyOn(git, 'resolveRef').mockResolvedValue('local')
  vi.spyOn(git, 'findMergeBase').mockResolvedValue([])
  return { fs, dir }
}

it('does not fetch additional history or change a full working copy', async () => {
  const context = await fixture()
  const deepen = vi.fn()
  expect(await ensureGitMergeHistory(context, 'remote', deepen)).toBe('remote')
  expect(deepen).not.toHaveBeenCalled()
  expect(git.findMergeBase).not.toHaveBeenCalled()
})

it('keeps a shallow boundary when a common ancestor already exists', async () => {
  const context = await fixture('boundary\n')
  vi.mocked(git.findMergeBase).mockResolvedValue(['ancestor'])
  const deepen = vi.fn()
  expect(await ensureGitMergeHistory(context, 'remote', deepen)).toBe('remote')
  expect(deepen).not.toHaveBeenCalled()
})

it('stops instead of retrying unchanged unavailable history indefinitely', async () => {
  const context = await fixture('boundary\n')
  const deepen = vi.fn().mockResolvedValue('remote')
  await expect(ensureGitMergeHistory(context, 'remote', deepen)).rejects.toThrow('gitHistoryUnavailable')
  expect(deepen).toHaveBeenCalledExactlyOnceWith(['boundary'])
})

it('propagates cancellation and does not continue requesting history', async () => {
  const context = await fixture('boundary\n')
  const abort = new Error('syncCancelled')
  const deepen = vi.fn().mockRejectedValue(abort)
  await expect(ensureGitMergeHistory(context, 'remote', deepen)).rejects.toBe(abort)
  expect(deepen).toHaveBeenCalledOnce()
})

it('passes every boundary and stops once complete history has been fetched', async () => {
  const context = await fixture('first\nsecond\n')
  const deepen = vi.fn(async () => {
    await rm(join(context.dir, '.git/shallow'))
    return 'updated-remote'
  })
  expect(await ensureGitMergeHistory(context, 'remote', deepen)).toBe('updated-remote')
  expect(deepen).toHaveBeenCalledExactlyOnceWith(['first', 'second'])
})

it('does not silently treat unreadable history metadata as a full clone', async () => {
  const context = await fixture()
  await mkdir(join(context.dir, '.git/shallow'))
  const deepen = vi.fn()
  await expect(ensureGitMergeHistory(context, 'remote', deepen)).rejects.toMatchObject({ code: 'EISDIR' })
  expect(deepen).not.toHaveBeenCalled()
})
