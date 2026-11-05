import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { noteTitle, slugToTitle } from '../src/noteTitle.ts'
import type { VaultPath } from '../src/paths.ts'
import { linkEdits, renameLinkRewrite, rewriteLinks, withTitle } from '../src/renameLinks.ts'
import type { Vault } from '../src/vault.ts'
import { createFixture, type Fixture, SEED_NOTES } from './helpers.ts'

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

describe('a rename transaction', () => {
  it('rewrites links only when asked, as protocol 1.0 clients expect', async () => {
    const result = await vault.rename(at('welcome.md'), at('hello.md'))

    expect(result).not.toHaveProperty('rewritten')
    expect(await fixture.desktop.read('projects/alpha.md')).toBe(SEED_NOTES['projects/alpha.md'])
  })

  it('retitles a note whose file name already fits, without touching links', async () => {
    const result = await vault.rename(at('welcome.md'), at('welcome.md'), { title: 'Hello', rewriteLinks: true })

    expect(result).toMatchObject({ from: 'welcome.md', path: 'welcome.md', rewritten: [] })
    expect(await fixture.desktop.read('welcome.md')).toBe('---\ntype: Note\ntitle: Hello\n---\n# Welcome\n\nA throwaway vault for tests.\n')
    expect(await fixture.desktop.read('projects/alpha.md')).toBe(SEED_NOTES['projects/alpha.md'])
    expect((await fixture.desktop.log())[0]).toBe('Retitle welcome.md')
  })

  it('makes no commit when the title is the one the note has', async () => {
    const before = await fixture.desktop.log()

    await vault.rename(at('welcome.md'), at('welcome.md'), { title: ' Welcome ' })

    expect(await fixture.desktop.log()).toEqual(before)
  })

  it('refuses an empty title and a rename onto itself without one', async () => {
    await expect(vault.rename(at('welcome.md'), at('hello.md'), { title: '  ' })).rejects.toMatchObject({
      status: 400,
      code: 'invalid_request',
    })
    await expect(vault.rename(at('welcome.md'), at('welcome.md'))).rejects.toMatchObject({ status: 409 })
  })

  it('moves a file that is not a note as it is, and leaves notes that are not UTF-8 out of the rewrite', async () => {
    await mkdir(join(fixture.desktop.dir, 'notes'), { recursive: true })
    await writeFile(join(fixture.desktop.dir, 'notes/binary.md'), Buffer.from([0xff, 0xfe, 0x5b, 0x5b]))
    await writeFile(join(fixture.desktop.dir, 'notes/link.md'), '[[welcome]]\n')
    await fixture.desktop.run(['add', '-A'])
    await fixture.desktop.run(['commit', '-q', '-m', 'desktop: notes'])
    await fixture.desktop.run(['push', '-q', 'hub', 'HEAD:refs/heads/main'])

    const moved = await vault.rename(at('attachments/pixel.bin'), at('attachments/dot.bin'), { title: 'Dot', rewriteLinks: true })
    const renamed = await vault.rename(at('notes/binary.md'), at('notes/raw.md'), { title: 'Raw', rewriteLinks: true })
    await vault.rename(at('welcome.md'), at('hello.md'), { rewriteLinks: true })

    expect(moved.rewritten).toEqual([])
    expect(renamed.rewritten).toEqual([])
    expect(await fixture.desktop.read('attachments/dot.bin')).toBe(SEED_NOTES['attachments/pixel.bin'])
    expect([...(await readFile(join(fixture.vaultDir, 'notes/raw.md')))]).toEqual([0xff, 0xfe, 0x5b, 0x5b])
    expect(await fixture.desktop.read('notes/link.md')).toBe('[[hello]]\n')
  })
})

describe('the link rewrite', () => {
  const rewrite = renameLinkRewrite({ from: 'note/weekly-review.md', to: 'note/retro.md', oldTitle: 'Weekly Review' })

  it('targets the title, the path stem and the file stem, once each', () => {
    expect(rewrite).toEqual({ targets: ['Weekly Review', 'note/weekly-review', 'weekly-review'], replacement: 'note/retro' })
    expect(renameLinkRewrite({ from: 'plan.md', to: 'roadmap.md', oldTitle: '' }).targets).toEqual(['plan'])
  })

  it('reports each edit where it is', () => {
    expect(linkEdits('a [[weekly-review|x]] b', rewrite)).toEqual([{ start: 2, end: 21, text: '[[note/retro|x]]' }])
    expect(rewriteLinks('no links here [[', rewrite)).toBe('no links here [[')
  })

  it('keeps content whose frontmatter cannot be edited', () => {
    expect(withTitle('---\ntitle: Old\nno closing delimiter\n', 'New')).toBe('---\ntitle: Old\nno closing delimiter\n')
  })
})

describe('the title a rename starts from', () => {
  it.each([
    ['# **Bold** _plan_\n', 'Bold plan'],
    ['---\ntitle: " Spaced "\n---\nBody\n', 'Spaced'],
    ['#Not a heading\n', 'Weekly Review'],
    ['# \n', 'Weekly Review'],
  ])('reads %j as %j', (content, title) => {
    expect(noteTitle(content, 'note/weekly-review.md')).toBe(title)
  })

  it('turns a file stem into words, by code point', () => {
    expect(slugToTitle('éte--plan-2.md')).toBe('Éte Plan 2')
  })
})
