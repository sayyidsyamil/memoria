import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const require = createRequire(import.meta.url)
const { createGitFetchFixture, requestText }: typeof import('../../apps/mobile/src/workspace/git/gitFetchTestFixture') =
  require('../../apps/mobile/src/workspace/git/gitFetchTestFixture')
const { syncGitVault }: typeof import('../../apps/mobile/src/workspace/git/gitRemote') =
  require('../../apps/mobile/src/workspace/git/gitRemote')
const { gitTestEnvironment }: typeof import('../../apps/mobile/src/workspace/git/gitTestServer') =
  require('../../apps/mobile/src/workspace/git/gitTestServer')

test('@smoke mobile commit and push avoid re-downloading the unchanged vault', async () => {
  const fixture = await createGitFetchFixture()
  try {
    const { context, meter, base, cloneBytes, remote } = fixture
    const content = '---\ncustom: preserved\n---\n# Local edit\n'
    await writeFile(join(context.dir, 'note-0.md'), content)
    const result = await syncGitVault(context, { name: 'Test', email: 'qa@example.invalid' })
    expect(result).toMatchObject({ kind: 'synced', changedFiles: 1 })
    expect(meter.exchanges).toHaveLength(1)
    expect(requestText(meter.exchanges[0])).toContain(`have ${base}\n`)
    expect(meter.exchanges[0].receivedBytes).toBeLessThan(cloneBytes / 8)
    const pushed = execFileSync('git', ['--git-dir', remote, 'show', 'main:note-0.md'], {
      env: gitTestEnvironment(), encoding: 'utf8',
    })
    expect(pushed).toBe(content)
    expect(await readFile(join(context.dir, 'note-0.md'), 'utf8')).toBe(content)
    expect(await readFile(join(context.dir, 'attachment.bin'))).toEqual(Buffer.from([0, 255, 128, 10]))
  } finally {
    await fixture.close()
  }
})
