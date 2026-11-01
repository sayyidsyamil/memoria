import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import git from 'isomorphic-git'
import { afterEach, expect, it } from 'vitest'
import { cloneGitVault, syncGitVault } from './gitRemote'
import { createGitVault } from './gitVault'
import { gitTestEnvironment, startGitTestServer } from './gitTestServer'

const author = { name: 'History QA', email: 'qa@example.invalid' }
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action() })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'memoria-history-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const remote = join(root, 'team', 'vault.git')
  await mkdir(remote, { recursive: true })
  const run = (args: string[]) => execFileSync('git', args, { env: gitTestEnvironment(), stdio: 'pipe' })
  run(['init', '--bare', '--initial-branch=main', remote])
  const seed = { fs, dir: join(root, 'seed') }
  await mkdir(seed.dir)
  await git.init({ ...seed, defaultBranch: 'main' })
  await writeFile(join(seed.dir, 'note.md'), '# Shared note\n')
  const base = (await createGitVault(seed).checkpoint(author)).oid
  for (let index = 0; index < 20; index += 1) {
    await writeFile(join(seed.dir, 'old-attachment.bin'), Buffer.alloc(4096, index))
    await createGitVault(seed).checkpoint(author)
  }
  await rm(join(seed.dir, 'old-attachment.bin'))
  const head = (await createGitVault(seed).checkpoint(author)).oid
  run(['-C', seed.dir, 'push', remote, 'main'])
  const server = await startGitTestServer(root)
  cleanup.push(server.close)
  const local = { fs, http: server.http, dir: join(root, 'local') }
  await cloneGitVault(local, 'https://github.com/team/vault')
  return { local, seed, remote, run, head, base }
}

it('clones the complete current tree without downloading removed attachment history', async () => {
  const { local, head } = await fixture()
  expect(await readFile(join(local.dir, 'note.md'), 'utf8')).toBe('# Shared note\n')
  expect(await git.listFiles(local)).toEqual(['note.md'])
  expect((await git.log(local)).map(entry => entry.oid)).toEqual([head])
  expect((await readFile(join(local.dir, '.git/shallow'), 'utf8')).trim()).toBe(head)
})

it('merges and pushes ordinary independent edits without fetching pre-clone history', async () => {
  const { local, seed, remote, run, head } = await fixture()
  await writeFile(join(local.dir, 'phone.md'), '# Phone\n')
  await writeFile(join(seed.dir, 'desktop.md'), '# Desktop\n')
  await createGitVault(seed).checkpoint(author)
  run(['-C', seed.dir, 'push', remote, 'main'])
  expect(await syncGitVault(local, author)).toMatchObject({ kind: 'synced' })
  expect(await readFile(join(local.dir, 'desktop.md'), 'utf8')).toBe('# Desktop\n')
  expect(await readFile(join(local.dir, 'phone.md'), 'utf8')).toBe('# Phone\n')
  expect((await readFile(join(local.dir, '.git/shallow'), 'utf8')).trim()).toBe(head)
  expect(run(['--git-dir', remote, 'show', 'main:phone.md']).toString()).toBe('# Phone\n')
})

it('retrieves missing ancestors before merging remote history rewritten before the clone', async () => {
  const { local, seed, remote, run, base, head } = await fixture()
  run(['--git-dir', remote, 'update-ref', 'refs/heads/previous', head])
  run(['-C', seed.dir, 'checkout', '-b', 'rewritten', base])
  await writeFile(join(seed.dir, 'desktop.md'), '# Rewritten desktop\n')
  await createGitVault(seed).checkpoint(author)
  run(['-C', seed.dir, 'push', '--force', remote, 'rewritten:main'])
  await writeFile(join(local.dir, 'phone.md'), '# Kept local edit\n')
  expect(await syncGitVault(local, author)).toMatchObject({ kind: 'synced' })
  expect(await readFile(join(local.dir, 'phone.md'), 'utf8')).toBe('# Kept local edit\n')
  expect(await readFile(join(local.dir, 'desktop.md'), 'utf8')).toBe('# Rewritten desktop\n')
  expect(await git.findMergeBase({ ...local, oids: [head, base] })).toEqual([base])
})

it('preserves local edits and the remote branch when required ancestors are unavailable', async () => {
  const { local, seed, remote, run, base } = await fixture()
  run(['-C', seed.dir, 'checkout', '-b', 'rewritten', base])
  await writeFile(join(seed.dir, 'desktop.md'), '# Rewritten desktop\n')
  const remoteHead = (await createGitVault(seed).checkpoint(author)).oid
  run(['-C', seed.dir, 'push', '--force', remote, 'rewritten:main'])
  run(['--git-dir', remote, 'gc', '--prune=now'])
  await writeFile(join(local.dir, 'phone.md'), '# Irreplaceable local edit\n')
  const localHead = (await createGitVault(local).checkpoint(author)).oid
  await expect(syncGitVault(local, author)).rejects.toThrow()
  expect(await git.resolveRef({ ...local, ref: 'HEAD' })).toBe(localHead)
  expect(await readFile(join(local.dir, 'phone.md'), 'utf8')).toBe('# Irreplaceable local edit\n')
  expect(run(['--git-dir', remote, 'rev-parse', 'main']).toString().trim()).toBe(remoteHead)
})
