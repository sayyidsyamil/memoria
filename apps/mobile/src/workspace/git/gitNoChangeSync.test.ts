import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import git from 'isomorphic-git'
import { afterEach, expect, it, vi } from 'vitest'
import { createGitFetchFixture } from './gitFetchTestFixture'
import { syncGitVault } from './gitRemote'
import { gitTestEnvironment } from './gitTestServer'

const author = { name: 'Sync regression', email: 'qa@example.invalid' }
afterEach(() => vi.restoreAllMocks())

it('uses two verified checkpoint walks and no redundant integration walk for an unchanged remote', async () => {
  const fixture = await createGitFetchFixture()
  try {
    const walk = vi.spyOn(git, 'walk')
    const result = await syncGitVault(fixture.context, author)
    expect(result).toEqual({ kind: 'synced', changedFiles: 0, workspaceChanged: false })
    expect(walk).toHaveBeenCalledTimes(2)
    expect(await git.resolveRef({ ...fixture.context, ref: 'HEAD' })).toBe(fixture.base)
    const transferred = fixture.meter.exchanges.reduce((sum, exchange) => sum + exchange.receivedBytes, 0)
    expect(transferred).toBeLessThan(fixture.cloneBytes / 10)
  } finally { await fixture.close() }
})

it('still checkpoints and pushes edits made while the unchanged remote is being fetched', async () => {
  const fixture = await createGitFetchFixture()
  try {
    let edited = false
    const content = '---\ncustom: retained\n---\n# Edited during fetch\n'
    const http = { request: async (request: Parameters<typeof fixture.context.http.request>[0]) => {
      if (!edited && request.url.endsWith('/git-upload-pack')) {
        edited = true
        await writeFile(join(fixture.context.dir, 'note-0.md'), content)
      }
      return fixture.context.http.request(request)
    } }
    expect(await syncGitVault({ ...fixture.context, http }, author)).toMatchObject({ kind: 'synced' })
    expect(edited).toBe(true)
    expect(await readFile(join(fixture.context.dir, 'note-0.md'), 'utf8')).toBe(content)
    const remote = execFileSync('git', ['--git-dir', fixture.remote, 'show', 'main:note-0.md'],
      { env: gitTestEnvironment(), encoding: 'utf8' })
    expect(remote).toBe(content)
    expect(await git.log({ fs, dir: fixture.context.dir })).toHaveLength(2)
  } finally { await fixture.close() }
})
