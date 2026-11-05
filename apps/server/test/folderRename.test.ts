import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { VaultPath } from '../src/paths.ts'
import { folderLinkRewrites, rewriteLinks } from '../src/renameLinks.ts'
import type { Vault } from '../src/vault.ts'
import { createFixture, type Fixture, SEED_NOTES } from './helpers.ts'

/** A folder rename moves every file in it in one commit and its path links follow (TOL-227). */

const at = (path: string) => path as VaultPath

let fixture: Fixture
let vault: Vault

beforeEach(async () => {
  fixture = await createFixture()
  vault = await fixture.openVault()
})

afterEach(async () => {
  await vault.idle()
  await fixture.cleanup()
})

async function desktopCommit(files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(fixture.desktop.dir, path, '..'), { recursive: true })
    await writeFile(join(fixture.desktop.dir, path), content)
  }
  await fixture.desktop.run(['add', '-A'])
  await fixture.desktop.run(['commit', '-q', '-m', 'desktop: notes'])
  await fixture.desktop.run(['push', '-q', 'hub', 'HEAD:refs/heads/main'])
}

describe('a folder rename', () => {
  it('moves every file and rewrites the path links to them in one commit', async () => {
    await desktopCommit({
      'projects/deep/beta.md': '# Beta\n\nSee [[projects/alpha|Alpha]], [[alpha]] and [[Alpha]].\n',
      'index.md': '# Index\n\n[[projects/alpha]] and [[projects/deep/beta]] and [[projects/alphabet]].\n',
    })
    const before = (await fixture.desktop.log()).length

    const result = await vault.renameFolder(at('projects'), at('work'), { rewriteLinks: true })

    expect(result).toMatchObject({
      from: 'projects',
      path: 'work',
      pushed: true,
      moved: [
        { from: 'projects/alpha.md', to: 'work/alpha.md' },
        { from: 'projects/deep/beta.md', to: 'work/deep/beta.md' },
      ],
      rewritten: ['index.md', 'work/deep/beta.md'],
    })
    const log = await fixture.desktop.log()
    expect(log).toHaveLength(before + 1)
    expect(log[0]).toBe('Rename folder projects to work')
    expect(await fixture.desktop.read('index.md')).toBe('# Index\n\n[[work/alpha]] and [[work/deep/beta]] and [[projects/alphabet]].\n')
    expect(await fixture.desktop.read('work/deep/beta.md')).toBe('# Beta\n\nSee [[work/alpha|Alpha]], [[alpha]] and [[Alpha]].\n')
    expect(await fixture.desktop.read('work/alpha.md')).toBe(SEED_NOTES['projects/alpha.md'])
  })

  it('only moves when links are not asked for, and moves files that are not notes', async () => {
    await desktopCommit({ 'index.md': '[[attachments/pixel]]\n' })

    const result = await vault.renameFolder(at('attachments'), at('media/files'))

    expect(result).not.toHaveProperty('rewritten')
    expect(result.moved).toEqual([{ from: 'attachments/pixel.bin', to: 'media/files/pixel.bin' }])
    expect(await fixture.desktop.read('media/files/pixel.bin')).toBe(SEED_NOTES['attachments/pixel.bin'])
    expect(await fixture.desktop.read('index.md')).toBe('[[attachments/pixel]]\n')
  })

  it('refuses a missing folder, a taken destination and a destination inside the folder', async () => {
    await expect(vault.renameFolder(at('nowhere'), at('work'))).rejects.toMatchObject({ status: 404 })
    await expect(vault.renameFolder(at('projects'), at('attachments'))).rejects.toMatchObject({ status: 409, code: 'destination_exists' })
    await expect(vault.renameFolder(at('projects'), at('welcome.md'))).rejects.toMatchObject({ status: 409 })
    await expect(vault.renameFolder(at('projects'), at('projects/inner'))).rejects.toMatchObject({ status: 400, code: 'invalid_request' })
    await expect(vault.renameFolder(at('projects'), at('projects'))).rejects.toMatchObject({ status: 400 })
  })
})

describe('the link rewrite of a folder rename', () => {
  const rewrites = folderLinkRewrites([
    { from: 'a/one.md', to: 'b/one.md' },
    { from: 'a/two.md', to: 'b/two.md' },
    { from: 'a/pic.png', to: 'b/pic.png' },
  ])

  it('targets each moved note by its path stem only', () => {
    expect(rewrites).toEqual([
      { targets: ['a/one'], replacement: 'b/one' },
      { targets: ['a/two'], replacement: 'b/two' },
    ])
  })

  it('rewrites the links to every moved note in one pass', () => {
    expect(rewriteLinks('[[a/one]] [[a/two|Two]] [[one]] [[a/three]]', rewrites)).toBe('[[b/one]] [[b/two|Two]] [[one]] [[a/three]]')
  })
})
