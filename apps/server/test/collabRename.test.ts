import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { baseRevision } from '../../../packages/markdown-yjs/src/index.ts'
import type { VaultPath } from '../src/paths.ts'
import { codec, createHarness, type Harness, NOTE, settle } from './collabHelpers.ts'

/** A rename's link rewrite reaching documents that are open for collaboration (TOL-22). */

const PERSON = 'people/ada.md'
const PERSON_NOTE = '---\ntype: Person\nrelated: "[[welcome]]"\n---\n\n# Ada\n\nMet at [[welcome|the welcome page]].\n'
const DIAGRAM_NOTE = '# Map\n\nSee [[welcome]].\n\n```mermaid\ngraph TD\n  A["[[welcome]]"]\n```\n'

let harness: Harness

beforeEach(async () => {
  harness = await createHarness()
})

afterEach(async () => {
  await harness.cleanup()
})

function renameWelcome(): Promise<unknown> {
  return harness.vault.rename('welcome.md' as VaultPath, 'archive/hello.md' as VaultPath, { rewriteLinks: true })
}

function wikilinks(doc: Y.Doc): Y.XmlElement[] {
  const walker = doc.getXmlFragment('blocks').createTreeWalker((node) => node instanceof Y.XmlElement && node.nodeName === 'wikilink')
  return [...walker] as Y.XmlElement[]
}

describe('a rename with link rewrite and live documents', () => {
  it('patches the link in an open document without replacing its block', async () => {
    const ada = await harness.client()
    const [link] = wikilinks(ada.doc)
    const paragraph = link.parent

    await renameWelcome()
    await settle()

    expect(await harness.file()).toBe('# Alpha\n\nLinks to [[archive/hello]] and mentions the Heron.\n')
    expect(ada.markdown()).toBe(await codec.canonical(await harness.file()))
    // The same Yjs items, with only the target changed.
    expect(wikilinks(ada.doc)).toEqual([link])
    expect(link.getAttribute('target')).toBe('archive/hello')
    expect(link.parent).toBe(paragraph)
    const session = await harness.session()
    expect(session.dirty).toBe(false)
    expect(baseRevision(ada.doc)).toBe((await harness.vault.read(NOTE as VaultPath)).etag)
    expect(await harness.commits()).toEqual(['Rename welcome.md to archive/hello.md'])
  })

  it('keeps an edit in the same paragraph that is not written yet, out of the rename commit', async () => {
    const ada = await harness.client()
    ada.type('mentions the Heron.', ' Typed live.')
    await settle()

    await renameWelcome()
    await settle()

    expect(ada.markdown()).toContain('Links to [[archive/hello]] and mentions the Heron. Typed live.')
    expect(await harness.file()).not.toContain('Typed live.')
    const session = await harness.session()
    expect(session.dirty).toBe(true)

    await session.flush()

    expect(await harness.file()).toBe('# Alpha\n\nLinks to [[archive/hello]] and mentions the Heron. Typed live.\n')
    expect(await harness.commits()).toEqual(['Update projects/alpha.md', 'Rename welcome.md to archive/hello.md'])
  })

  it('rewrites links in the frontmatter text and keeps an alias, with no drift', async () => {
    await harness.fixture.desktop.commit(PERSON, PERSON_NOTE)
    await harness.vault.syncNow()
    await harness.docs.reconcile([PERSON as VaultPath])
    const ada = await harness.client(PERSON)

    await renameWelcome()
    await settle()

    const file = await harness.file(PERSON)
    expect(file).toBe(PERSON_NOTE.replaceAll('[[welcome', '[[archive/hello'))
    expect(ada.doc.getText('frontmatter').toString()).toBe('---\ntype: Person\nrelated: "[[archive/hello]]"\n---\n')
    expect(ada.markdown()).toBe(await codec.canonical(file))
    expect((await harness.session(PERSON)).dirty).toBe(false)
  })

  it('reconciles the file when a link sits where the patch does not reach', async () => {
    await harness.fixture.desktop.commit('map.md', DIAGRAM_NOTE)
    await harness.vault.syncNow()
    await harness.docs.reconcile(['map.md' as VaultPath])
    const ada = await harness.client('map.md')

    await renameWelcome()
    await settle()

    const file = await harness.file('map.md')
    expect(file).toBe(DIAGRAM_NOTE.replaceAll('[[welcome]]', '[[archive/hello]]'))
    expect(ada.markdown()).toBe(await codec.canonical(file))
    expect(ada.markdown()).not.toContain('[[welcome]]')
    expect((await harness.session('map.md')).dirty).toBe(false)
  })

  it('moves the renamed note’s own document and leaves its links alone', async () => {
    const ada = await harness.client('welcome.md')
    const session = await harness.session('welcome.md')

    await renameWelcome()

    expect(session.path).toBe('archive/hello.md')
    expect(ada.markdown()).toContain('A throwaway vault for tests.')
  })

  it('follows a folder rename: a moved note keeps its document and a linking note is patched live', async () => {
    await harness.fixture.desktop.commit(PERSON, '# Ada\n\nWorks on [[projects/alpha|the alpha]].\n')
    await harness.vault.syncNow()
    await harness.docs.reconcile([PERSON as VaultPath])
    const ada = await harness.client(PERSON)
    const [link] = wikilinks(ada.doc)

    await harness.vault.renameFolder('projects' as VaultPath, 'work' as VaultPath, { rewriteLinks: true })
    await settle()

    expect(wikilinks(ada.doc)).toEqual([link])
    expect(link.getAttribute('target')).toBe('work/alpha|the alpha')
    expect(await harness.file(PERSON)).toBe('# Ada\n\nWorks on [[work/alpha|the alpha]].\n')
    expect((await harness.session(PERSON)).dirty).toBe(false)
    expect((await harness.commits())[0]).toBe('Rename folder projects to work')
  })

  it('moves the documents of the notes in a renamed folder, with their edits', async () => {
    const alpha = await harness.client()
    const session = await harness.session()
    alpha.type('mentions the Heron.', ' Typed live.')
    await settle()

    await harness.vault.renameFolder('projects' as VaultPath, 'work' as VaultPath, { rewriteLinks: true })
    await session.flush()

    expect(session.path).toBe('work/alpha.md')
    expect(await harness.file('work/alpha.md')).toBe('# Alpha\n\nLinks to [[welcome]] and mentions the Heron. Typed live.\n')
  })
})

