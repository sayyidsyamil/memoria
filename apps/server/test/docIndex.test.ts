import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DocIndex } from '../src/docIndex.ts'
import { vaultPath as at } from '../src/paths.ts'
import { LocalDiskStore } from '../src/store.ts'
import { text } from './helpers.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('DocIndex', () => {
  let root: string
  let store: LocalDiskStore
  let docs: DocIndex

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'memoria-docs-test-'))
    store = new LocalDiskStore(root)
    docs = await DocIndex.open(store)
    await docs.reconcile([at('a.md'), at('b.md')])
  })

  afterEach(() => rm(root, { recursive: true, force: true }))

  it('gives every note its own id and attachments none', async () => {
    await docs.apply([{ kind: 'upsert', path: at('image.png') }])
    expect(docs.docId('a.md')).toMatch(UUID)
    expect(docs.docId('a.md')).not.toBe(docs.docId('b.md'))
    expect(docs.docId('image.png')).toBeUndefined()
  })

  it('keeps the id when a note is edited or renamed', async () => {
    const id = docs.docId('a.md')
    await docs.apply([{ kind: 'upsert', path: at('a.md') }])
    await docs.apply([
      { kind: 'rename', from: at('a.md'), to: at('archive/a.md') },
      { kind: 'upsert', path: at('archive/a.md') },
    ])
    expect(docs.docId('archive/a.md')).toBe(id)
    expect(docs.docId('a.md')).toBeUndefined()
  })

  it('finds the note of a document id, wherever it moved', async () => {
    const id = docs.docId('a.md') as string
    await docs.apply([{ kind: 'rename', from: at('a.md'), to: at('archive/a.md') }])

    expect(docs.pathOf(id)).toBe('archive/a.md')
    expect(docs.pathOf('unknown')).toBeUndefined()
  })

  it('drops the id when a note is deleted or stops being a note', async () => {
    await docs.apply([{ kind: 'delete', path: at('a.md') }])
    await docs.apply([{ kind: 'rename', from: at('b.md'), to: at('b.txt') }])
    expect(docs.docId('a.md')).toBeUndefined()
    expect(docs.docId('b.txt')).toBeUndefined()
  })

  it('gives an id to a file that becomes a note by rename', async () => {
    await docs.apply([{ kind: 'rename', from: at('draft.txt'), to: at('draft.md') }])
    expect(docs.docId('draft.md')).toMatch(UUID)
  })

  it('persists across restarts and forgets notes that vanished meanwhile', async () => {
    const id = docs.docId('a.md')
    const reopened = await DocIndex.open(store)
    expect(reopened.docId('a.md')).toBe(id)

    await reopened.reconcile([at('a.md'), at('c.md')])
    expect(reopened.docId('a.md')).toBe(id)
    expect(reopened.docId('b.md')).toBeUndefined()
    expect(reopened.docId('c.md')).toMatch(UUID)
  })

  it('adds ids to a listing', () => {
    const files = [
      { path: 'a.md', size: 1, etag: 'x' },
      { path: 'image.png', size: 2, etag: 'y' },
    ]
    expect(docs.withDocIds(files)).toEqual([{ ...files[0], docId: docs.docId('a.md') }, files[1]])
  })

  it.each([
    ['text that is not JSON', 'not json'],
    ['a value that is not an object', '[]'],
    ['a missing list', JSON.stringify({ version: 1 })],
    ['an entry that is not a pair', JSON.stringify({ version: 1, docs: [['a.md']] })],
    ['an entry with a non-string id', JSON.stringify({ version: 1, docs: [['a.md', 7]] })],
    ['an entry with an empty id', JSON.stringify({ version: 1, docs: [['a.md', '']] })],
    ['a path outside the vault', JSON.stringify({ version: 1, docs: [['../a.md', 'id']] })],
  ])('refuses stored state with %s instead of trusting it', async (_label, stored) => {
    await store.put('doc-index.json', text(stored))
    await expect(DocIndex.open(store)).rejects.toThrowError(/doc index is malformed/)
  })

  it('refuses an index written by a newer server', async () => {
    await store.put('doc-index.json', text(JSON.stringify({ version: 2, docs: [] })))
    await expect(DocIndex.open(store)).rejects.toThrowError(/unsupported doc index version: 2/)
  })
})
