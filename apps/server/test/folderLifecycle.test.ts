import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { VaultPath } from '../src/paths.ts'
import type { Vault } from '../src/vault.ts'
import { createHarness, type Harness, NOTE, settle } from './collabHelpers.ts'
import { createFixture, type Fixture } from './helpers.ts'

/** Creating and deleting a folder: one commit each, nothing outside the folder touched (TOL-233). */

const at = (path: string) => path as VaultPath

let fixture: Fixture
let vault: Vault

async function desktopCommit(files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(fixture.desktop.dir, path, '..'), { recursive: true })
    await writeFile(join(fixture.desktop.dir, path), content)
  }
  await fixture.desktop.run(['add', '-A'])
  await fixture.desktop.run(['commit', '-q', '-m', 'desktop: notes'])
  await fixture.desktop.run(['push', '-q', 'hub', 'HEAD:refs/heads/main'])
}

async function trackedFiles(): Promise<string[]> {
  return (await vault.list()).files.map((file) => file.path)
}

describe('folders on the server', () => {
  beforeEach(async () => {
    fixture = await createFixture()
    vault = await fixture.openVault()
  })

  afterEach(async () => {
    await vault.idle()
    await fixture.cleanup()
  })

  it('creates an empty folder in one commit, kept in git by its .keep file', async () => {
    const before = (await fixture.desktop.log()).length

    const result = await vault.createFolder(at('projects/drafts'))

    expect(result).toMatchObject({ path: 'projects/drafts', pushed: true })
    const log = await fixture.desktop.log()
    expect(log).toHaveLength(before + 1)
    expect(log[0]).toBe('Create folder projects/drafts')
    expect(await fixture.desktop.read('projects/drafts/.keep')).toBe('')
    expect(await trackedFiles()).toContain('projects/drafts/.keep')
  })

  it.each([
    ['projects', 'a folder with files'],
    ['welcome.md', 'a file'],
    ['welcome.md/inner', 'a path under a file'],
  ])('refuses to create %s, %s, without a commit', async (path) => {
    const before = await fixture.desktop.log()

    await expect(vault.createFolder(at(path))).rejects.toMatchObject({ status: 409, code: 'destination_exists' })

    expect(await fixture.desktop.log()).toEqual(before)
  })

  it('deletes every file of a folder in one commit and leaves the rest alone', async () => {
    await desktopCommit({
      'projects/deep/beta.md': '# Beta\n',
      'projects-old/kept.md': '# Kept\n',
    })
    const before = (await fixture.desktop.log()).length

    const result = await vault.deleteFolder(at('projects'))

    expect(result).toMatchObject({ path: 'projects', pushed: true, deleted: ['projects/alpha.md', 'projects/deep/beta.md'] })
    const log = await fixture.desktop.log()
    expect(log).toHaveLength(before + 1)
    expect(log[0]).toBe('Delete folder projects')
    expect(await trackedFiles()).toEqual(['attachments/pixel.bin', 'projects-old/kept.md', 'welcome.md'])
    expect(await fixture.desktop.read('projects-old/kept.md')).toBe('# Kept\n')
  })

  it('deletes a folder it created, .keep file and all', async () => {
    await vault.createFolder(at('ideas'))

    const result = await vault.deleteFolder(at('ideas'))

    expect(result.deleted).toEqual(['ideas/.keep'])
    expect(await trackedFiles()).not.toContain('ideas/.keep')
  })

  it.each(['nowhere', 'welcome.md'])('answers not found for %s, without a commit', async (path) => {
    const before = await fixture.desktop.log()

    await expect(vault.deleteFolder(at(path))).rejects.toMatchObject({ status: 404, code: 'not_found' })

    expect(await fixture.desktop.log()).toEqual(before)
  })
})

describe('a folder delete and live documents', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  it('closes the rooms of the notes it deleted', async () => {
    const alpha = await harness.client(NOTE)

    await harness.vault.deleteFolder(at('projects'))
    await settle()

    expect(alpha.sockets[0].closeCode).toBe(4410)
    expect((await harness.commits())[0]).toBe('Delete folder projects')
  })

  it('restores a note that had unwritten edits, so nothing typed is lost', async () => {
    const alpha = await harness.client(NOTE)
    alpha.type('mentions the Heron.', ' Typed live.')
    await settle()

    await harness.vault.deleteFolder(at('projects'))
    await harness.vault.idle()

    expect(await harness.file(NOTE)).toBe('# Alpha\n\nLinks to [[welcome]] and mentions the Heron. Typed live.\n')
  })
})
