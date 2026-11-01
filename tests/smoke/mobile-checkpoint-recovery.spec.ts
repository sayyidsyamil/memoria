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
const { syncGitVault }: typeof import('../../apps/mobile/src/workspace/git/gitRemote') =
  require('../../apps/mobile/src/workspace/git/gitRemote')
const { createGitEditorAccess }: typeof import('../../apps/mobile/src/workspace/git/gitEditorAccess') =
  require('../../apps/mobile/src/workspace/git/gitEditorAccess')
const { createWorkspaceSyncEditors }: typeof import('../../apps/mobile/src/workspace/workspaceSyncEditors') =
  require('../../apps/mobile/src/workspace/workspaceSyncEditors')
const { gitTestEnvironment }: typeof import('../../apps/mobile/src/workspace/git/gitTestServer') =
  require('../../apps/mobile/src/workspace/git/gitTestServer')

test('@smoke mobile checkpoint recovery refreshes the editor even when remote heads match', async () => {
  const fixture = await createGitFetchFixture()
  try {
    const { context, seed, remote, base } = fixture
    const author = { name: 'Recovery QA', email: 'qa@example.invalid' }
    const content = '# Recovered note\n'
    await writeFile(join(seed, 'note-0.md'), content)
    const target = await createGitVault({ fs: context.fs, dir: seed }).checkpoint(author)
    execFileSync('git', ['-C', seed, 'push', remote, 'main'], { env: gitTestEnvironment(), stdio: 'pipe' })
    execFileSync('git', ['-C', context.dir, 'fetch', remote, 'main'], { env: gitTestEnvironment(), stdio: 'pipe' })
    const journalPath = join(context.dir, '.git', 'memoria-checkout.json')
    await writeFile(journalPath, JSON.stringify({ version: 1, branch: 'main', before: base, target: target.oid }))
    const editors = createWorkspaceSyncEditors()
    editors.register(async () => () => {}, 'note-0.md')
    const refreshed: (string | undefined)[] = []
    const access = createGitEditorAccess({ editors, refresh: selected => { refreshed.push(selected) } })
    expect(await syncGitVault({ ...context, withLocalAccess: access }, author))
      .toMatchObject({ kind: 'synced', workspaceChanged: true })
    expect(refreshed).toEqual(['note-0.md'])
    expect(editors.isBlocked()).toBe(false)
    expect(editors.generation()).toBe(1)
    expect(await readFile(join(context.dir, 'note-0.md'), 'utf8')).toBe(content)
    expect(await readFile(join(context.dir, 'attachment.bin'))).toEqual(Buffer.from([0, 255, 128, 10]))
    await expect(readFile(journalPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await syncGitVault({ ...context, withLocalAccess: access }, author))
      .toMatchObject({ kind: 'synced', workspaceChanged: false })
    expect(refreshed).toEqual(['note-0.md'])
  } finally {
    await fixture.close()
  }
})
