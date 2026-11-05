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

const author = { name: 'Branch QA', email: 'qa@example.invalid' }
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action() })

it('pushes the real branch, not a stale file shadowing its short name', async () => {
  const { context, remote } = await fixture()
  const original = await git.resolveRef({ ...context, ref: 'HEAD' })
  await writeFile(join(context.dir, '.git/main'), `${original}\n`)
  await writeFile(join(context.dir, 'note.md'), '# New local content\n')

  expect(await syncGitVault(context, author)).toMatchObject({ kind: 'synced' })

  const head = await git.resolveRef({ ...context, ref: 'HEAD' })
  expect(head).not.toBe(original)
  expect(await git.resolveRef({ fs, gitdir: remote, ref: 'refs/heads/main' })).toBe(head)
  expect(await readFile(join(context.dir, '.git/main'), 'utf8')).toBe(`${original}\n`)
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'memoria-shadowed-sync-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const remote = join(root, 'team', 'vault.git')
  await mkdir(remote, { recursive: true })
  const options = { env: gitTestEnvironment(), stdio: 'pipe' as const }
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], options)
  const seed = { fs, dir: join(root, 'seed') }
  await mkdir(seed.dir)
  await git.init({ ...seed, defaultBranch: 'main' })
  await writeFile(join(seed.dir, 'note.md'), '# Original\n')
  await createGitVault(seed).checkpoint(author)
  execFileSync('git', ['-C', seed.dir, 'push', remote, 'main'], options)
  const server = await startGitTestServer(root)
  cleanup.push(server.close)
  const context = { fs, http: server.http, dir: join(root, 'device') }
  await cloneGitVault(context, 'https://github.com/team/vault')
  return { context, remote }
}
