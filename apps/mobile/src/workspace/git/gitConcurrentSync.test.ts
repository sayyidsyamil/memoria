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
import { persistWorkspaceOperations } from './workspaceWriteQueue'

const author = { name: 'Concurrency QA', email: 'qa@example.invalid' }
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action() })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'memoria-concurrent-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const remote = join(root, 'team', 'vault.git')
  await mkdir(remote, { recursive: true })
  const options = { env: gitTestEnvironment(), stdio: 'pipe' as const }
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], options)
  const seed = { fs, dir: join(root, 'seed') }
  await mkdir(seed.dir)
  await git.init({ ...seed, defaultBranch: 'main' })
  await writeFile(join(seed.dir, 'note.md'), '# Initial\n')
  await createGitVault(seed).checkpoint(author)
  execFileSync('git', ['-C', seed.dir, 'push', remote, 'main'], options)
  const server = await startGitTestServer(root)
  cleanup.push(server.close)
  const context = { fs, http: server.http, dir: join(root, 'tablet') }
  await cloneGitVault(context, 'https://github.com/team/vault')
  return context
}

it.each(['git-upload-pack', 'git-receive-pack'])('persists editor writes during %s without waiting for the network', { timeout: 4000 }, async service => {
  const context = await fixture()
  await writeFile(join(context.dir, 'note.md'), '# Checkpoint\n')
  let edited = false
  const http = { request: async (request: Parameters<typeof context.http.request>[0]) => {
    if (!edited && request.url.includes(service)) {
      edited = true
      await persistWorkspaceOperations(context.dir, [() => writeFile(join(context.dir, 'typing.md'), '# New typing\n')])
    }
    return context.http.request(request)
  } }
  await syncGitVault({ ...context, http }, author)
  expect(edited).toBe(true)
  expect(await readFile(join(context.dir, 'typing.md'), 'utf8')).toBe('# New typing\n')
  await syncGitVault(context, author)
  expect(await createGitVault(context).requireClean()).toMatchObject({ changedFiles: 0 })
})
