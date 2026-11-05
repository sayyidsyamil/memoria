import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const require = createRequire(import.meta.url)
const { createGitFetchFixture }: typeof import('../../apps/mobile/src/workspace/git/gitFetchTestFixture') =
  require('../../apps/mobile/src/workspace/git/gitFetchTestFixture')
const { createGitVault }: typeof import('../../apps/mobile/src/workspace/git/gitVault') =
  require('../../apps/mobile/src/workspace/git/gitVault')
const { createGitEditorAccess }: typeof import('../../apps/mobile/src/workspace/git/gitEditorAccess') =
  require('../../apps/mobile/src/workspace/git/gitEditorAccess')
const { createWorkspaceSyncEditors }: typeof import('../../apps/mobile/src/workspace/workspaceSyncEditors') =
  require('../../apps/mobile/src/workspace/workspaceSyncEditors')
const { gitTestEnvironment }: typeof import('../../apps/mobile/src/workspace/git/gitTestServer') =
  require('../../apps/mobile/src/workspace/git/gitTestServer')

test('@smoke a manual checkpoint preserves a local draft and refreshes recovered note content', async () => {
  const fixture = await createGitFetchFixture()
  try {
    const { context, seed, remote, base } = fixture
    const author = { name: 'Manual recovery QA', email: 'qa@example.invalid' }
    const content = '# Recovered remote note\n'
    await writeFile(join(seed, 'note-0.md'), content)
    const target = await createGitVault({ fs: context.fs, dir: seed }).checkpoint(author)
    const processOptions = { env: gitTestEnvironment(), stdio: 'pipe' as const }
    execFileSync('git', ['-C', seed, 'push', remote, 'main'], processOptions)
    execFileSync('git', ['-C', context.dir, 'fetch', remote, 'main'], processOptions)
    const journal = join(context.dir, '.git', 'memoria-checkout.json')
    await writeFile(journal, JSON.stringify({ version: 1, branch: 'main', before: base, target: target.oid }))
    const draft = '# Local uncommitted draft\n'
    await writeFile(join(context.dir, 'local-draft.md'), draft)
    const editors = createWorkspaceSyncEditors()
    let resumed = false
    editors.register(async () => () => { resumed = true }, 'note-0.md')
    const refreshed: (string | undefined)[] = []
    const access = createGitEditorAccess({ editors, refresh: selected => { refreshed.push(selected) } })
    const vault = createGitVault(context)
    const checkpoint = await access(async () => {
      const value = await vault.checkpoint(author, 'Keep my draft')
      return { value, workspaceChanged: value.workspaceChanged }
    })
    expect(checkpoint).toMatchObject({ changedFiles: 1, workspaceChanged: true })
    expect(refreshed).toEqual(['note-0.md'])
    expect(editors.generation()).toBe(1)
    expect(editors.isBlocked()).toBe(false)
    expect(resumed).toBe(false)
    expect(await readFile(join(context.dir, 'note-0.md'), 'utf8')).toBe(content)
    expect(await readFile(join(context.dir, 'local-draft.md'), 'utf8')).toBe(draft)
    expect(await readFile(join(context.dir, 'attachment.bin'))).toEqual(Buffer.from([0, 255, 128, 10]))
    await expect(readFile(journal)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await vault.requireClean()).toMatchObject({ oid: checkpoint.oid, workspaceChanged: false })
    expect(execFileSync('git', ['-C', context.dir, 'log', '-1', '--format=%s'], processOptions).toString().trim())
      .toBe('Keep my draft')
    expect(execFileSync('git', ['-C', context.dir, 'rev-parse', 'HEAD^'], processOptions).toString().trim()).toBe(target.oid)
  } finally {
    await fixture.close()
  }
})
