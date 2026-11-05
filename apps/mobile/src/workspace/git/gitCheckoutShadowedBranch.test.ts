import fs from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import git from 'isomorphic-git'
import { afterEach, expect, it } from 'vitest'
import { createGitVault } from './gitVault'
import { recoverGitCheckout } from './gitCheckoutRecovery'

const roots: string[] = []
const author = { name: 'Recovery QA', email: 'qa@example.invalid' }
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

it('recovers the real branch when a stale pseudoref shadows its short name', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'memoria-shadowed-branch-'))
  roots.push(dir)
  const context = { fs, dir }
  await git.init({ ...context, defaultBranch: 'main' })
  await writeFile(join(dir, 'note.md'), '# Original\n')
  const before = (await createGitVault(context).checkpoint(author)).oid
  await git.branch({ ...context, ref: 'next' })
  await git.checkout({ ...context, ref: 'next' })
  await writeFile(join(dir, 'note.md'), '# Remote change\n')
  const target = (await createGitVault(context).checkpoint(author)).oid
  await git.checkout({ ...context, ref: 'refs/heads/main' })
  await git.branch({ ...context, ref: 'stale' })
  await git.checkout({ ...context, ref: 'stale' })
  await writeFile(join(dir, 'note.md'), '# Unrelated branch\n')
  const shadow = (await createGitVault(context).checkpoint(author)).oid
  await git.checkout({ ...context, ref: 'refs/heads/main' })
  await writeFile(join(dir, '.git/main'), `${shadow}\n`)
  await writeFile(join(dir, '.git/memoria-checkout.json'), JSON.stringify({ version: 1, branch: 'main', before, target }))

  await recoverGitCheckout(context)

  expect(await git.resolveRef({ ...context, ref: 'HEAD' })).toBe(target)
  expect(await readFile(join(dir, 'note.md'), 'utf8')).toBe('# Remote change\n')
  expect(await readFile(join(dir, '.git/main'), 'utf8')).toBe(`${shadow}\n`)
  await expect(readFile(join(dir, '.git/memoria-checkout.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})
