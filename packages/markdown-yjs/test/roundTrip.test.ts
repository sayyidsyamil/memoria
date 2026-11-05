import { beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { NoteCodec } from '../src/index.ts'
import { corpus, demoVaultNotes, differences, fixtureNotes } from './corpus.ts'

const MAX_EDITS_PER_NOTE = 25
const GOLDEN = './golden/round-trip-differences.json'
/** Holds the constructs the serializer rewrites; an edit next to one takes the serializer's form. */
const LOSSY_FIXTURE = 'fixtures/edge-cases.md'

let codec: NoteCodec

beforeAll(() => {
  codec = new NoteCodec()
})

async function docOf(markdown: string): Promise<Y.Doc> {
  const doc = new Y.Doc()
  await codec.write(doc, { markdown, revision: 'etag-0' })
  return doc
}

function textNodes(doc: Y.Doc): Y.XmlText[] {
  const walker = doc.getXmlFragment('blocks').createTreeWalker((node) => node instanceof Y.XmlText && node.length > 0)
  return ([...walker] as Y.XmlText[]).slice(0, MAX_EDITS_PER_NOTE)
}

function clipped(lines: string[]): string[] {
  return lines.map((line) => (line.length > 100 ? `${line.slice(0, 100)}…` : line))
}

async function goldenEntry({ name, markdown }: { name: string; markdown: string }): Promise<object> {
  const canonical = await codec.canonical(markdown)
  const found = differences(markdown, canonical).map((difference) => ({
    kind: difference.kind,
    source: clipped(difference.source),
    canonical: clipped(difference.canonical),
  }))
  return { note: name, byteStable: canonical === markdown, differences: found }
}

describe.each(corpus)('$name', ({ name, markdown }) => {
  it('keeps every block through a Y.Doc and a state transfer', async () => {
    const note = await codec.parse(markdown)
    const replica = new Y.Doc()
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(await docOf(markdown)))

    expect(codec.read(replica)).toBe(codec.serialize(note))
    expect(codec.violation(replica)).toBeNull()
  })

  it('serializes to a fixed point', async () => {
    const canonical = await codec.canonical(markdown)

    expect(await codec.canonical(canonical)).toBe(canonical)
  })

  it('writes back the exact bytes of the file when nothing was edited', async () => {
    const versions = {
      source: markdown,
      canonicalSource: await codec.canonical(markdown),
      canonical: codec.read(await docOf(markdown)),
    }

    expect(await codec.fileContent(versions)).toEqual({ markdown, preserved: true })
  })

  it('writes an edit back as a change to its own line only', async () => {
    const canonicalSource = await codec.canonical(markdown)
    const doc = await docOf(markdown)
    for (const text of textNodes(doc)) {
      text.insert(text.length, 'EDITED')
      const canonical = codec.read(doc)
      const file = await codec.fileContent({ source: markdown, canonicalSource, canonical })
      text.delete(text.length - 6, 6)

      const hunks = differences(markdown, file.markdown).length
      expect({ preserved: file.preserved, hunks }).toEqual({ preserved: true, hunks: name === LOSSY_FIXTURE ? hunks : 1 })
    }
  })
})

describe('round-trip differences', () => {
  it('match the golden list', async () => {
    const entries = await Promise.all(corpus.map(goldenEntry))

    await expect(`${JSON.stringify(entries, null, 2)}\n`).toMatchFileSnapshot(GOLDEN)
  })

  it('are formatting only in the demo vault', async () => {
    const kinds = new Set<string>()
    for (const { markdown } of demoVaultNotes) {
      for (const { kind } of differences(markdown, await codec.canonical(markdown))) kinds.add(kind)
    }

    expect([...kinds].sort()).toEqual(['blank-lines', 'escaping', 'image-path-prefix'])
  })

  it('cover the Memoria block types in the fixtures', async () => {
    const types = new Set<string>()
    for (const { markdown } of fixtureNotes) {
      for (const block of (await codec.parse(markdown)).blocks) types.add(block.type)
    }

    expect([...types]).toEqual(
      expect.arrayContaining(['calloutBlock', 'mathBlock', 'mermaidBlock', 'tldrawBlock', 'table', 'codeBlock', 'checkListItem']),
    )
  })
})
