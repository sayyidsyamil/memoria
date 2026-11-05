import { beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { NoteCodec } from '../src/index.ts'

const NOTE = '# Title\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n'
const REWRITTEN = NOTE.replace('Second paragraph.', 'Second paragraph, rewritten on the desktop.')

let codec: NoteCodec

beforeAll(() => {
  codec = new NoteCodec()
})

async function docOf(markdown: string): Promise<Y.Doc> {
  const doc = new Y.Doc()
  await codec.write(doc, { markdown, revision: 'etag-1' })
  return doc
}

function textOf(doc: Y.Doc, content: string): Y.XmlText {
  const walker = doc.getXmlFragment('blocks').createTreeWalker((node) => node instanceof Y.XmlText)
  const found = [...walker].find((node) => node.toString() === content)
  if (!(found instanceof Y.XmlText)) throw new Error(`no text ${content}`)
  return found
}

function sync(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)))
}

async function expectRewrite(before: string, after: string): Promise<void> {
  const doc = await docOf(before)
  await codec.write(doc, { markdown: after, revision: 'etag-2' })
  expect(codec.read(doc)).toBe(await codec.canonical(after))
}

describe('patchBlocks on a block the file rewrote (TOL-236)', () => {
  it('keeps a cursor at the end of the rewritten paragraph at its end', async () => {
    const doc = await docOf(NOTE)
    const second = textOf(doc, 'Second paragraph.')
    const cursor = Y.createRelativePositionFromTypeIndex(second, second.length)

    await codec.write(doc, { markdown: REWRITTEN, revision: 'etag-2' })

    const resolved = Y.createAbsolutePositionFromRelativePosition(cursor, doc)
    const text = 'Second paragraph, rewritten on the desktop.'
    expect({ type: resolved?.type.toString(), index: resolved?.index }).toEqual({ type: text, index: text.length })
  })

  it('keeps what was typed in the paragraph while the file rewrote it', async () => {
    const server = await docOf(NOTE)
    const browser = new Y.Doc()
    sync(server, browser)

    textOf(browser, 'Second paragraph.').insert('Second paragraph.'.length, ' Typed')
    await codec.write(server, { markdown: REWRITTEN, revision: 'etag-2' })
    sync(browser, server)
    sync(server, browser)

    const merged = REWRITTEN.replace('desktop.', 'desktop. Typed')
    expect(codec.read(server)).toBe(merged)
    expect(codec.read(browser)).toBe(merged)
  })

  it('keeps the blocks the rewrite did not touch, ids included', async () => {
    const doc = await docOf(NOTE)
    const ids = () => (doc.getXmlFragment('blocks').get(0) as Y.XmlElement).toArray().map((node) => (node as Y.XmlElement).getAttribute('id'))
    const before = ids()

    await codec.write(doc, { markdown: REWRITTEN, revision: 'etag-2' })

    expect(ids()).toEqual(before)
  })

  it.each([
    ['formatting', 'Second **bold** paragraph.', 'Second **bold** and *new* paragraph.'],
    ['an emoji', 'Second 🙂 paragraph.', 'Second 🙃 paragraph.'],
    ['a wikilink target', 'See [[alpha]] here.', 'See [[beta]] here.'],
    ['the block type', 'Second paragraph.', '## Second paragraph.'],
    ['nested blocks', '- item\n  - nested', '- item\n  - nested, edited\n  - another'],
    ['several blocks', 'One.\n\nTwo.', 'One, edited.\n\nTwo, edited.'],
    ['the block count', 'One.\n\nTwo.', 'One and two.'],
  ])('reads back exactly after a rewrite of %s', async (_change, before, after) => {
    await expectRewrite(NOTE.replace('Second paragraph.', before), NOTE.replace('Second paragraph.', after))
  })
})
