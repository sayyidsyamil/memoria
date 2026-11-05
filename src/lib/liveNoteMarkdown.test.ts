import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createHeadlessEditor, NoteCodec } from '../../packages/markdown-yjs/src/index'
import { DOC_BLOCKS_FRAGMENT, DOC_FRONTMATTER_FIELD } from '../../packages/protocol/src/index'
import { createLiveMarkdownWriter, RAW_EDIT_ORIGIN } from './liveNoteMarkdown'

const editor = createHeadlessEditor()
const codec = new NoteCodec(editor)

const NOTE = '---\ntype: Project\n---\n# Heron\n\nOwned by Ada.\n'

async function liveDocument(markdown: string): Promise<Y.Doc> {
  const doc = new Y.Doc()
  await codec.write(doc, { markdown, revision: 'r1' })
  return doc
}

function firstBlock(doc: Y.Doc): Y.XmlElement {
  const group = doc.getXmlFragment(DOC_BLOCKS_FRAGMENT).get(0) as Y.XmlElement
  return group.get(0) as Y.XmlElement
}

describe('createLiveMarkdownWriter', () => {
  it('makes the document say what the markdown says, frontmatter included', async () => {
    const doc = await liveDocument(NOTE)
    const edited = '---\ntype: Project\nstatus: Active\n---\n# Heron\n\nOwned by Ada.\n\nA raw edit.\n'

    const blocks = await createLiveMarkdownWriter(doc, editor)(edited)

    expect(doc.getText(DOC_FRONTMATTER_FIELD).toString()).toBe('---\ntype: Project\nstatus: Active\n---\n')
    expect(codec.read(doc)).toBe(await codec.canonical(edited))
    expect(blocks?.map((block) => block.type)).toEqual(['heading', 'paragraph', 'paragraph'])
  })

  it('changes only the blocks that differ, in one transaction with its own origin', async () => {
    const doc = await liveDocument(NOTE)
    const heading = firstBlock(doc)
    const origins: unknown[] = []
    doc.on('afterTransaction', (transaction) => origins.push(transaction.origin))

    await createLiveMarkdownWriter(doc, editor)(`${NOTE}\nA raw edit.\n`)

    expect(firstBlock(doc)).toBe(heading)
    expect(origins).toEqual([RAW_EDIT_ORIGIN])
  })

  it('applies only the last of writes made in a row', async () => {
    const doc = await liveDocument(NOTE)
    const write = createLiveMarkdownWriter(doc, editor)

    const first = write(`${NOTE}\nFirst.\n`)
    const second = write(`${NOTE}\nSecond.\n`)

    expect(await first).toBeNull()
    expect(await second).not.toBeNull()
    expect(codec.read(doc)).toBe(await codec.canonical(`${NOTE}\nSecond.\n`))
  })

  it('empties the frontmatter of a note written without one', async () => {
    const doc = await liveDocument(NOTE)

    await createLiveMarkdownWriter(doc, editor)('# Heron\n\nOwned by Ada.\n')

    expect(doc.getText(DOC_FRONTMATTER_FIELD).toString()).toBe('')
  })

  it('keeps an empty checklist item empty, nested ones too', async () => {
    const doc = await liveDocument(NOTE)
    const edited = `${NOTE}\n- [ ] \n  - [ ] \n`

    const blocks = await createLiveMarkdownWriter(doc, editor)(edited)

    const item = blocks?.at(-1)
    expect(item?.type).toBe('checkListItem')
    expect(item?.content).toEqual([])
    expect(item?.children[0]?.content).toEqual([])
  })
})
