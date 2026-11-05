import fs from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import git from 'isomorphic-git'
import { afterEach, expect, it, vi } from 'vitest'
import { createGitVault } from './gitVault'
import { syncGitVault } from './gitRemote'
import { runSavedVaultOperation } from './savedVaultOperation'
import { createWorkspaceSyncEditors } from '../workspaceSyncEditors'

const author = { name: 'Manual QA', email: 'qa@example.invalid' }
const roots: string[] = []
afterEach(async () => { for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true }) })

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'memoria-manual-git-'))
  roots.push(dir)
  await git.init({ fs, dir, defaultBranch: 'main' })
  await git.setConfig({ fs, dir, path: 'remote.origin.url', value: 'https://github.com/team/vault.git' })
  await writeFile(join(dir, 'note.md'), '# Initial\n')
  await createGitVault({ fs, dir }).checkpoint(author)
  return { fs, dir }
}

it('records a user-written message in a local commit without contacting a remote', async () => {
  const context = await fixture()
  await writeFile(join(context.dir, 'note.md'), '# Revised\n')
  const result = await createGitVault(context).checkpoint(author, 'Review project decisions')
  expect(result.changedFiles).toBe(1)
  expect(result).toHaveProperty('workspaceChanged', false)
  expect((await git.readCommit({ ...context, oid: result.oid })).commit.message.trim()).toBe('Review project decisions')
  expect(await readFile(join(context.dir, 'note.md'), 'utf8')).toBe('# Revised\n')
})

it('rejects empty manual messages without creating a commit', async () => {
  const context = await fixture()
  await writeFile(join(context.dir, 'note.md'), '# Revised\n')
  await expect(createGitVault(context).checkpoint(author, '  ')).rejects.toThrow('emptyCommitMessage')
  expect(await git.log(context)).toHaveLength(1)
})

async function pendingCheckout() {
  const context = await fixture()
  const before = await git.resolveRef({ ...context, ref: 'HEAD' })
  await git.branch({ ...context, ref: 'incoming' })
  await git.checkout({ ...context, ref: 'incoming' })
  await writeFile(join(context.dir, 'note.md'), '# Recovered note\n')
  const target = (await createGitVault(context).checkpoint(author)).oid
  await git.checkout({ ...context, ref: 'main' })
  const journal = join(context.dir, '.git', 'memoria-checkout.json')
  await writeFile(journal, JSON.stringify({ version: 1, branch: 'main', before, target }))
  return { context, target, journal }
}

it.each(['manual', 'clean'] as const)('reports %s checkpoint recovery and refreshes instead of reviving the stale editor', async mode => {
  const { context, target, journal } = await pendingCheckout()
  const editors = createWorkspaceSyncEditors()
  const resume = vi.fn()
  editors.register(async () => resume, 'note.md')
  const refresh = vi.fn()
  const vault = createGitVault(context)
  let checkpoint: Awaited<ReturnType<typeof vault.checkpoint>> | undefined
  await runSavedVaultOperation({
    editors, refresh,
    run: async () => {
      const result = await (mode === 'manual' ? vault.checkpoint(author, 'Review') : vault.requireClean())
      checkpoint = result
      return result.workspaceChanged ? undefined : 'unchanged'
    },
  })
  expect(checkpoint).toMatchObject({ changedFiles: 0, oid: target, workspaceChanged: true })
  expect(refresh).toHaveBeenCalledExactlyOnceWith('note.md')
  expect(resume).not.toHaveBeenCalled()
  expect(editors.generation()).toBe(1)
  expect(await readFile(join(context.dir, 'note.md'), 'utf8')).toBe('# Recovered note\n')
  await expect(readFile(journal)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await vault.requireClean()).toMatchObject({ changedFiles: 0, oid: target, workspaceChanged: false })
  expect(await git.log(context)).toHaveLength(2)
})

it('manual sync refuses uncommitted changes before contacting a remote', async () => {
  const context = await fixture()
  await writeFile(join(context.dir, 'note.md'), '# Revised\n')
  const request = vi.fn().mockRejectedValue(new Error('Unexpected remote call'))
  await expect(syncGitVault({ ...context, http: { request }, checkpoint: false }, author)).rejects.toThrow('uncommittedChanges')
  expect(request).not.toHaveBeenCalled()
  expect(await git.log(context)).toHaveLength(1)
})
