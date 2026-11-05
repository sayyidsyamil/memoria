import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { baseRevision } from '../../../packages/markdown-yjs/src/index.ts'
import { awarenessMessage, receive, updateMessage } from '../../../packages/protocol/src/collabWire.ts'
import type { VaultPath } from '../src/paths.ts'
import { codec, createHarness, type Harness, NOTE, settle } from './collabHelpers.ts'
import { text } from './helpers.ts'

const SEED = '# Alpha\n\nLinks to [[welcome]] and mentions the Heron.\n'
const LONG_NOTE = '---\ntype: Note\n---\n\n# Plan\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n'

let harness: Harness

beforeEach(async () => {
  harness = await createHarness()
})

afterEach(async () => {
  await harness.cleanup()
})

describe('a room', () => {
  it('gives a client the note as a memoria.blocknote/1 document', async () => {
    const { doc } = await harness.client('welcome.md')

    expect(doc.getText('frontmatter').toString()).toBe('---\ntype: Note\n---\n')
    expect(doc.getXmlFragment('blocks').toString()).toContain('A throwaway vault for tests.')
    expect(doc.getMap('meta').toJSON()).toEqual({
      format: 'memoria.blocknote/1',
      baseRevision: (await harness.vault.read('welcome.md' as VaultPath)).etag,
    })
  })

  it('makes two clients converge on concurrent edits', async () => {
    const ada = await harness.client()
    const luca = await harness.client()

    ada.type('Alpha', ' by Ada')
    luca.type('Heron', ' Luca was here.')
    luca.type('Alpha', ' and Luca')
    await settle()

    expect(ada.markdown()).toBe(luca.markdown())
    expect(ada.markdown()).toContain('Luca was here.')
    expect(ada.markdown()).toMatch(/# Alpha( by Ada| and Luca){2}/)
  })

  it('shows each client the presence and cursor of the other', async () => {
    const ada = await harness.client()
    const luca = await harness.client()

    ada.provider.awareness.setLocalStateField('user', { name: 'Ada', color: '#d33' })
    luca.provider.awareness.setLocalStateField('user', { name: 'Luca', color: '#36c' })
    await settle()

    expect(luca.provider.awareness.getStates().get(ada.doc.clientID)).toEqual({ user: { name: 'Ada', color: '#d33' } })
    expect(ada.provider.awareness.getStates().get(luca.doc.clientID)).toEqual({ user: { name: 'Luca', color: '#36c' } })
  })

  it('withdraws the presence of a client that leaves', async () => {
    const ada = await harness.client()
    const luca = await harness.client()
    ada.provider.awareness.setLocalStateField('user', { name: 'Ada', color: '#d33' })
    await settle()

    ada.provider.destroy()
    await settle()

    expect([...luca.provider.awareness.getStates().keys()]).toEqual([luca.doc.clientID])
  })

  it('does not let a client publish or withdraw the presence of another', async () => {
    const ada = await harness.client()
    const luca = await harness.client()
    const mallory = await harness.client()
    ada.provider.awareness.setLocalStateField('user', { name: 'Ada', color: '#d33' })
    await settle()
    const impostor = new Y.Doc()
    impostor.clientID = ada.doc.clientID
    const forged = new Awareness(impostor)
    for (let clock = 0; clock < 10; clock++) forged.setLocalState({ user: { name: 'Not Ada', color: '#000000' } })

    mallory.sockets[0].send(awarenessMessage(forged, [ada.doc.clientID]))
    forged.setLocalState(null)
    mallory.sockets[0].send(awarenessMessage(forged, [ada.doc.clientID]))
    await settle()

    expect(luca.provider.awareness.getStates().get(ada.doc.clientID)).toEqual({ user: { name: 'Ada', color: '#d33' } })
    expect(mallory.sockets[0].closeCode).toBeNull()
  })

  it('sends a late joiner the presence of who is already there', async () => {
    const ada = await harness.client()
    ada.provider.awareness.setLocalStateField('user', { name: 'Ada', color: '#d33' })
    await settle()

    const luca = await harness.client()

    expect(luca.provider.awareness.getStates().get(ada.doc.clientID)).toEqual({ user: { name: 'Ada', color: '#d33' } })
  })

  it('ignores the edits of a read-only client and still shows it the document', async () => {
    const viewer = await harness.client(NOTE, 'read')
    const editor = await harness.client()

    viewer.type('Alpha', ' defaced')
    editor.type('Alpha', ' edited')
    await settle()

    expect(editor.markdown()).not.toContain('defaced')
    expect(viewer.markdown()).toContain('edited')
  })

  it('puts back the meta map when a client writes to it', async () => {
    const ada = await harness.client()
    const luca = await harness.client()
    const revision = (await harness.vault.read(NOTE as VaultPath)).etag

    ada.doc.getMap<string>('meta').set('baseRevision', 'forged')
    ada.doc.getMap<string>('meta').set('conflictCopy', 'somewhere-else.md')
    await settle()

    expect(luca.doc.getMap('meta').toJSON()).toEqual({ format: 'memoria.blocknote/1', baseRevision: revision })
    expect(ada.doc.getMap('meta').toJSON()).toEqual(luca.doc.getMap('meta').toJSON())
  })

  it.each([
    ['a node type the editor does not have', (doc: Y.Doc) => doc.getXmlFragment('blocks').insert(0, [new Y.XmlElement('script')])],
    [
      'an attribute the node does not have',
      (doc: Y.Doc) => (doc.getXmlFragment('blocks').get(0) as Y.XmlElement).setAttribute('onclick', 'alert(1)'),
    ],
    [
      'a mark the editor does not have',
      (doc: Y.Doc) => {
        const walker = doc.getXmlFragment('blocks').createTreeWalker((node) => node instanceof Y.XmlText)
        ;(walker.next().value as Y.XmlText).format(0, 1, { blink: true })
      },
    ],
    ['a shared type the format does not have', (doc: Y.Doc) => doc.getMap('extra').set('key', 'value')],
  ])('turns down a change that adds %s, and closes that connection', async (_name, deface) => {
    const mallory = await harness.client()
    const ada = await harness.client()
    const before = ada.markdown()

    deface(mallory.doc)
    await settle()
    mallory.provider.destroy()
    ada.type('Alpha', ' still fine')
    await settle()

    expect(mallory.sockets[0].closeCode).toBe(4422)
    expect(ada.sockets[0].closeCode).toBeNull()
    expect(ada.markdown()).toBe(before.replace('# Alpha', '# Alpha still fine'))
    expect([...(await harness.session()).doc.share.keys()].sort()).toEqual(['blocks', 'frontmatter', 'meta'])
  })

  it('closes the connection of a client that sends bytes that are no message', async () => {
    const ada = await harness.client()

    ada.sockets[0].send(new Uint8Array([1, 250]))
    await settle()

    expect(ada.sockets[0].closeCode).toBe(4400)
  })

  it('refuses a document id that names no note', async () => {
    expect(await harness.hub.connect('no-such-doc', { send: () => {}, close: () => {} }, 'write')).toBeNull()
  })
})

/** A client that writes the wire by hand, to send exactly the change a test needs. */
interface RawPeer {
  received: Uint8Array[]
  closeCode: number | null
  send(data: Uint8Array): void
  /** Answers the last sync step 1 the server sent with what `doc` has and the server lacks. */
  answer(doc: Y.Doc): void
}

/** A sync step 1 begins with the sync message type, then the step: both 0. */
function isSyncStep1(data: Uint8Array): boolean {
  return data[0] === 0 && data[1] === 0
}

async function rawPeer(): Promise<RawPeer> {
  const peer: RawPeer = { received: [], closeCode: null, send: () => {}, answer: () => {} }
  const socket = { send: (data: Uint8Array) => peer.received.push(data), close: (code: number) => (peer.closeCode ??= code) }
  const connection = await harness.hub.connect(harness.docId(), socket, 'write')
  if (!connection) throw new Error('no document')
  peer.send = (data) => connection.receive(data)
  peer.answer = (doc) => {
    const step1 = peer.received.findLast(isSyncStep1)
    if (!step1) throw new Error('the server sent no sync step 1')
    const { reply } = receive(step1, { doc, awareness: new Awareness(doc) }, { origin: peer, readOnly: false })
    peer.send(reply as Uint8Array)
  }
  return peer
}

function copyOf(doc: Y.Doc): Y.Doc {
  const copy = new Y.Doc()
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc))
  return copy
}

/** Makes a change to `doc` and returns it as an update, without sending it anywhere. */
function changeOf(doc: Y.Doc, change: (blocks: Y.XmlElement) => void): Uint8Array {
  const before = Y.encodeStateVector(doc)
  change(doc.getXmlFragment('blocks').get(0) as Y.XmlElement)
  return Y.encodeStateAsUpdate(doc, before)
}

describe('a change that builds on what the server has not seen (TOL-235)', () => {
  it('is kept out of the document unchecked, and cannot get the editor who sends what it builds on closed', async () => {
    const ada = await harness.client()
    ada.type('Alpha', ' by Ada')
    await settle()
    // Ada's other tab adds a paragraph the server has not seen yet...
    const adaTab = copyOf(ada.doc)
    const fromTab = changeOf(adaTab, (blocks) => {
      const paragraph = (blocks.get(1) as Y.XmlElement).clone()
      paragraph.setAttribute('id', 'from-the-other-tab')
      blocks.insert(2, [paragraph])
    })
    // ...and Mallory, who has it, puts a script after it and sends only her own change.
    const malloryDoc = copyOf(adaTab)
    const script = changeOf(malloryDoc, (blocks) => blocks.insert(3, [new Y.XmlElement('script')]))
    const mallory = await rawPeer()
    const { doc } = await harness.session()

    mallory.send(updateMessage(script))
    expect(doc.store.pendingStructs).toBeNull()
    Y.applyUpdate(ada.doc, fromTab)
    await settle()

    expect(ada.sockets[0].closeCode).toBeNull()
    expect(doc.getXmlFragment('blocks').toString()).toContain('from-the-other-tab')
    expect(doc.getXmlFragment('blocks').toString()).not.toContain('script')
    // The server asked Mallory for what it lacked: her answer is checked, and turned down.
    mallory.answer(malloryDoc)
    await settle()
    expect(mallory.closeCode).toBe(4422)
    expect(ada.sockets[0].closeCode).toBeNull()
    ada.type('Alpha', ' again')
    await settle()
    expect(codec.read(doc)).toBe(ada.markdown())
    expect(ada.markdown()).toContain('# Alpha by Ada again')
  })

  it('reaches the document once the client answers the sync step 1 the server sends it', async () => {
    const bea = await rawPeer()
    const ada = await harness.client()
    const { doc } = await harness.session()
    const beaDoc = copyOf(doc)
    changeOf(beaDoc, (blocks) => blocks.insert(2, [(blocks.get(1) as Y.XmlElement).clone()]))
    const second = changeOf(beaDoc, (blocks) => (blocks.get(2) as Y.XmlElement).setAttribute('id', 'from-bea'))

    bea.send(updateMessage(second))
    bea.send(updateMessage(second))
    expect(doc.getXmlFragment('blocks').toString()).not.toContain('from-bea')
    expect(bea.received.filter(isSyncStep1)).toHaveLength(2)
    bea.answer(beaDoc)
    await settle()

    expect(bea.closeCode).toBeNull()
    expect(Y.encodeStateVector(doc)).toEqual(Y.encodeStateVector(beaDoc))
    expect(ada.doc.getXmlFragment('blocks').toString()).toContain('from-bea')
  })
})

describe('flushing a document to its file', () => {
  it('writes an edit as one commit that changes only the edited line', async () => {
    await harness.fixture.desktop.commit('plan.md', LONG_NOTE)
    await harness.vault.syncNow()
    const ada = await harness.client('plan.md')

    ada.type('Second', ' Edited.')
    await settle()
    const outcome = await (await harness.session('plan.md')).flush()

    expect(outcome).toBe('written')
    expect(await harness.fixture.desktop.read('plan.md')).toBe(LONG_NOTE.replace('Second paragraph.', 'Second paragraph. Edited.'))
    expect(await harness.commits()).toEqual(['Update plan.md', 'desktop: plan.md'])
  })

  it('tells clients the revision the document is now in step with', async () => {
    const ada = await harness.client()
    ada.type('Alpha', '!')
    await settle()

    await (await harness.session()).flush()
    await settle()

    expect(baseRevision(ada.doc)).toBe((await harness.vault.read(NOTE as VaultPath)).etag)
  })

  it('makes no commit when the document says what the file says', async () => {
    await harness.client()

    expect(await (await harness.session()).flush()).toBe('skipped')
    expect(await harness.commits()).toEqual([])
  })

  it('makes no commit for an edit that was undone', async () => {
    const ada = await harness.client()
    ada.type('Alpha', '!')
    const heading = ada.doc.getXmlFragment('blocks').createTreeWalker((node) => node instanceof Y.XmlText).next().value as Y.XmlText
    heading.delete(heading.length - 1, 1)
    await settle()

    expect(await (await harness.session()).flush()).toBe('skipped')
    expect(await harness.file()).toBe(SEED)
  })

  it('writes what is pending when the last client has left and the room closes', async () => {
    const ada = await harness.client()
    ada.type('Alpha', ' closing')
    await settle()

    ada.provider.destroy()
    await harness.hub.close()

    expect(await harness.file()).toBe(SEED.replace('# Alpha', '# Alpha closing'))
  })
})

describe('the layout of a file around its body (TOL-222)', () => {
  const SPACED = '---\ntype: Note\n---\n\n# Plan\n\nFirst paragraph.\n\n'

  beforeEach(async () => {
    await harness.fixture.desktop.commit('plan.md', SPACED)
    await harness.vault.syncNow()
  })

  it('is not rewritten when a note is opened and closed without an edit', async () => {
    const ada = await harness.client('plan.md')
    ada.provider.destroy()
    await harness.hub.close()

    expect(await harness.file('plan.md')).toBe(SPACED)
    expect(await harness.commits()).toEqual(['desktop: plan.md'])
  })

  it('keeps the blank line after the frontmatter and the trailing blank line through edits at both ends', async () => {
    const ada = await harness.client('plan.md')
    const edited = ada.markdown().replace('# Plan', 'On top.\n\n# Plan').replace('First paragraph.', 'First paragraph.\n\nAt the end.')
    await codec.write(ada.doc, { markdown: edited, revision: baseRevision(ada.doc) ?? '' })
    await settle()

    expect(await (await harness.session('plan.md')).flush()).toBe('written')
    expect(await harness.file('plan.md')).toBe('---\ntype: Note\n---\n\nOn top.\n\n# Plan\n\nFirst paragraph.\n\nAt the end.\n\n')
  })
})

describe('flushing on a cadence', () => {
  it('writes shortly after the typing stops', async () => {
    await harness.cleanup()
    harness = await createHarness({ policy: { idleMs: 20, maxWaitMs: 10_000 } })
    const ada = await harness.client()

    ada.type('Alpha', ' one')
    await settle()
    ada.type('Alpha', ' two')
    await new Promise((resolve) => setTimeout(resolve, 60))
    await (await harness.session()).settled()

    expect(await harness.commits()).toEqual([`Update ${NOTE}`])
    expect(await harness.file()).toContain('# Alpha one two')
  })

  it('closes a room nobody is connected to, after writing it', async () => {
    await harness.cleanup()
    harness = await createHarness({ lingerMs: 5 })
    const ada = await harness.client()
    ada.type('Alpha', ' bye')
    await settle()
    const session = await harness.session()

    ada.provider.destroy()
    await new Promise((resolve) => setTimeout(resolve, 30))
    await harness.hub.idle()
    await session.settled()

    expect(await harness.hub.session(harness.docId())).toBeUndefined()
    expect(await harness.file()).toContain('# Alpha bye')
  })

  it('keeps a room open for a client that comes back within the linger time', async () => {
    const ada = await harness.client()
    const session = await harness.session()

    ada.provider.destroy()
    await settle()
    await harness.client()

    expect(await harness.session()).toBe(session)
  })
})

describe('a desktop commit that lands on a live document', () => {
  beforeEach(async () => {
    await harness.fixture.desktop.commit('plan.md', LONG_NOTE)
    await harness.vault.syncNow()
  })

  it('reaches the clients when the document has no edits of its own', async () => {
    const ada = await harness.client('plan.md')

    await harness.fixture.desktop.commit('plan.md', LONG_NOTE.replace('Third paragraph.', 'Third paragraph, from the desktop.'))
    await harness.vault.syncNow()
    await settle()

    expect(ada.markdown()).toContain('Third paragraph, from the desktop.')
    expect(await (await harness.session('plan.md')).flush()).toBe('skipped')
  })

  it('is merged with unwritten edits elsewhere in the note, and neither is lost', async () => {
    const ada = await harness.client('plan.md')
    ada.type('First', ' From the web.')
    await settle()

    await harness.fixture.desktop.commit('plan.md', LONG_NOTE.replace('Third paragraph.', 'Third paragraph, from the desktop.'))
    await harness.vault.syncNow()
    await settle()
    await (await harness.session('plan.md')).flush()

    const merged = LONG_NOTE.replace('First paragraph.', 'First paragraph. From the web.').replace(
      'Third paragraph.',
      'Third paragraph, from the desktop.',
    )
    expect(await harness.fixture.desktop.read('plan.md')).toBe(merged)
    expect(ada.markdown()).toContain('Third paragraph, from the desktop.')
    expect(harness.logs).toEqual([])
  })

  it('is merged when it arrives in the pull of the flush itself', async () => {
    const ada = await harness.client('plan.md')
    ada.type('First', ' From the web.')
    await settle()
    await harness.fixture.desktop.commit('plan.md', LONG_NOTE.replace('Third paragraph.', 'Third, desktop.'))

    expect(await (await harness.session('plan.md')).flush()).toBe('written')

    const file = await harness.fixture.desktop.read('plan.md')
    expect(file).toContain('First paragraph. From the web.')
    expect(file).toContain('Third, desktop.')
    expect((await harness.vault.list()).files.map((entry) => entry.path).filter((path) => path.includes('conflict'))).toEqual([])
  })

  it('keeps a cursor in an untouched paragraph where it was', async () => {
    const ada = await harness.client('plan.md')
    const walker = ada.doc.getXmlFragment('blocks').createTreeWalker((node) => node instanceof Y.XmlText)
    const first = ([...walker] as Y.XmlText[]).find((node) => node.toString().startsWith('First')) as Y.XmlText
    const cursor = Y.createRelativePositionFromTypeIndex(first, 5)

    await harness.fixture.desktop.commit('plan.md', LONG_NOTE.replace('Third paragraph.', 'Third, desktop.'))
    await harness.vault.syncNow()
    await settle()

    const resolved = Y.createAbsolutePositionFromRelativePosition(cursor, ada.doc)
    expect({ text: resolved?.type.toString(), index: resolved?.index }).toEqual({ text: 'First paragraph.', index: 5 })
  })

  it('keeps the live edits and saves the desktop version as a conflict copy when both changed the same line', async () => {
    const ada = await harness.client('plan.md')
    ada.type('Second', ' Web version.')
    await settle()
    const desktopVersion = LONG_NOTE.replace('Second paragraph.', 'Second paragraph. Desktop version.')

    await harness.fixture.desktop.commit('plan.md', desktopVersion)
    await harness.vault.syncNow()
    await (await harness.session('plan.md')).settled()
    await settle()

    const copy = ada.doc.getMap<string>('meta').get('conflictCopy') as string
    expect(copy).toMatch(/^plan \(conflict .+\)\.md$/)
    expect(await harness.fixture.desktop.read(copy)).toBe(desktopVersion)
    expect(await harness.fixture.desktop.read('plan.md')).toBe(LONG_NOTE.replace('Second paragraph.', 'Second paragraph. Web version.'))
    expect(ada.markdown()).toContain('Second paragraph. Web version.')
    expect(ada.markdown()).not.toContain('Desktop version.')
  })

  it('keeps typing that arrives after the fork in the note, not in the copy', async () => {
    const ada = await harness.client('plan.md')
    ada.type('Second', ' Web version.')
    await settle()
    const session = await harness.session('plan.md')

    await harness.fixture.desktop.commit('plan.md', LONG_NOTE.replace('Second paragraph.', 'Second paragraph. Desktop version.'))
    await harness.vault.syncNow()
    ada.type('First', ' Typed after the fork.')
    await settle()
    await session.settled()
    await session.flush()

    const copy = ada.doc.getMap<string>('meta').get('conflictCopy') as string
    const file = await harness.fixture.desktop.read('plan.md')
    expect(file).toContain('First paragraph. Typed after the fork.')
    expect(file).toContain('Second paragraph. Web version.')
    expect(await harness.fixture.desktop.read(copy)).toContain('Second paragraph. Desktop version.')
  })

  it('saves the conflict copy when the desktop commit arrives in the pull of the flush itself', async () => {
    const ada = await harness.client('plan.md')
    ada.type('Second', ' Web version.')
    await settle()
    const session = await harness.session('plan.md')
    await harness.fixture.desktop.commit('plan.md', LONG_NOTE.replace('Second paragraph.', 'Second, desktop.'))

    await session.flush()
    await session.settled()
    await settle()

    const copy = ada.doc.getMap<string>('meta').get('conflictCopy') as string
    expect(await harness.fixture.desktop.read(copy)).toContain('Second, desktop.')
    expect(await harness.fixture.desktop.read('plan.md')).toContain('Second paragraph. Web version.')
  })

  it('follows a rename made on the desktop', async () => {
    const ada = await harness.client('plan.md')
    ada.type('First', ' Renamed underneath.')
    await settle()
    const session = await harness.session('plan.md')

    await harness.fixture.desktop.rename('plan.md', 'roadmap.md')
    await harness.vault.syncNow()
    await session.flush()

    expect(session.path).toBe('roadmap.md')
    expect(await harness.fixture.desktop.read('roadmap.md')).toContain('First paragraph. Renamed underneath.')
  })

  it('closes the room of a note deleted on the desktop', async () => {
    const ada = await harness.client('plan.md')

    await harness.fixture.desktop.commit('plan.md', null)
    await harness.vault.syncNow()

    expect(ada.sockets[0].closeCode).toBe(4410)
    expect(await harness.hub.session(harness.docId('plan.md'))).toBeUndefined()
  })

  it('restores a note deleted on the desktop while it had unwritten edits', async () => {
    const ada = await harness.client('plan.md')
    ada.type('First', ' Still being written.')
    await settle()

    await harness.fixture.desktop.commit('plan.md', null)
    await harness.vault.syncNow()
    await harness.vault.idle()

    expect(await harness.fixture.desktop.read('plan.md')).toBe(LONG_NOTE.replace('First paragraph.', 'First paragraph. Still being written.'))
  })

  it('leaves documents of other notes alone', async () => {
    const ada = await harness.client()

    await harness.fixture.desktop.commit('plan.md', `${LONG_NOTE}\nMore.\n`)
    await harness.vault.syncNow()

    expect(ada.markdown()).toContain('# Alpha')
    expect(await (await harness.session()).flush()).toBe('skipped')
  })
})

describe('a restart', () => {
  it('reopens a document from its snapshot, so a reconnecting client merges instead of duplicating', async () => {
    const ada = await harness.client()
    ada.type('Alpha', ' before')
    await settle()

    await harness.restart()
    ada.type('Alpha', ' offline')
    await ada.provider.whenSynced()
    await settle()
    const luca = await harness.client()

    expect(luca.markdown()).toBe(ada.markdown())
    expect(luca.markdown().match(/# Alpha before offline/g)).toHaveLength(1)
  })

  it('reconciles a snapshot with a file that changed while the server was down', async () => {
    const ada = await harness.client()
    ada.type('Alpha', ' kept')
    await settle()
    await harness.hub.close()
    await harness.vault.write(NOTE as VaultPath, text(`${SEED}\nAdded while down.\n`.replace('# Alpha', '# Alpha kept')), { kind: 'any' })

    await harness.restart()
    const luca = await harness.client()

    expect(luca.markdown()).toContain('Added while down.')
    expect(luca.markdown()).toContain('# Alpha kept')
  })

  it('rebuilds a document from the file when its snapshot cannot be read', async () => {
    await harness.client()
    await harness.hub.close()
    const store = (harness.hub as unknown as { options: { store: { put(key: string, bytes: Uint8Array): Promise<void> } } }).options.store
    await store.put(`collab/${harness.docId()}/base.json`, text('not json'))

    await harness.restart()

    expect((await harness.client()).markdown()).toContain('# Alpha')
  })
})
