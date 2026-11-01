import fs from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import git from 'isomorphic-git'
import { afterEach, expect, it } from 'vitest'
import { createGitVault } from '../workspace/git/gitVault'
import { assertGitCorruptObjectFailure, assertGitReadFailure, assertGitReadFailureSafety } from './assertGitReadFailureSafety'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function context() {
  const dir = await mkdtemp(join(tmpdir(), 'memoria-read-failure-'))
  roots.push(dir)
  return { fs: { promises: fs.promises }, dir }
}

async function fixture() {
  const repository = await context()
  await git.init({ ...repository, defaultBranch: 'main' })
  await writeFile(join(repository.dir, 'read-safety.md'), '---\ncustom: preserved\n---\n# Keep me\n')
  await createGitVault(repository).checkpoint({ name: 'Test', email: 'qa@example.invalid' })
  return repository
}

it.each(['EACCES', 'EIO'])('preserves saved state and propagates a directory %s error', async code => {
  await expect(assertGitReadFailure(await fixture(), 'readdir', code)).resolves.toBeUndefined()
})

it.each(['EACCES', 'EIO'])('does not turn an object-read %s error into a missing object', async code => {
  await expect(assertGitReadFailure(await fixture(), 'readFile', code)).resolves.toBeUndefined()
})

it('preserves corrupt-object diagnostics and distinguishes an absent object', async () => {
  await expect(assertGitCorruptObjectFailure(await fixture())).resolves.toBeUndefined()
})

it('runs the complete portable native recovery proof against a real filesystem', async () => {
  await expect(assertGitReadFailureSafety(await context())).resolves.toBe(true)
})
