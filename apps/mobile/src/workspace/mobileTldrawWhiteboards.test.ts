import { describe, expect, it } from 'vitest'
import {
  mobileTldrawFenceSource,
  readMobileTldrawWhiteboards,
  updateMobileTldrawWhiteboard,
} from './mobileTldrawWhiteboards'
import {
  addMobileTldrawTextShapeToSnapshot,
  canAddMobileTldrawTextShapeToSnapshot,
  readMobileTldrawTextShapesFromSnapshot,
  removeMobileTldrawTextShapeFromSnapshot,
  updateMobileTldrawTextShapeInSnapshot,
} from './mobileTldrawSnapshot'

describe('mobile tldraw whiteboards', () => {
  it('reads desktop durable tldraw fences with dimensions and snapshots', () => {
    const boards = readMobileTldrawWhiteboards({ markdown: [
      '# Planning',
      '',
      '```tldraw id="map" height="640" width="900"',
      '{ "store": { "shape": true } }',
      '```',
      '',
      'Done',
    ].join('\n') })

    expect(boards).toEqual([{
      boardId: 'map',
      endLine: 4,
      height: '640',
      indent: '',
      key: 'map',
      metadataSuffix: '',
      snapshot: '{ "store": { "shape": true } }',
      startLine: 2,
      width: '900',
    }])
  })

  it('updates one whiteboard without rewriting the rest of the note', () => {
    const content = [
      '---',
      'type: Essay',
      '---',
      '# Planning',
      '',
      '```tldraw id="map" height="640"',
      '{}',
      '```',
      '',
      'Tail',
    ].join('\n')

    const result = updateMobileTldrawWhiteboard({
      markdown: content,
      update: {
        height: '720',
        key: 'map',
        snapshot: '{ "document": { "shape": true } }',
        width: '980',
      },
    })

    expect(result.updated).toBe(true)
    expect(result.markdown).toBe([
      '---',
      'type: Essay',
      '---',
      '# Planning',
      '',
      '```tldraw id="map" height="720" width="980"',
      '{ "document": { "shape": true } }',
      '```',
      '',
      'Tail',
    ].join('\n'))
  })

  it('preserves extra desktop tldraw fence metadata when editing dimensions and snapshot', () => {
    const content = [
      '# Planning',
      '',
      '```tldraw id="map" height="640" width="900" compact="true" data-owner="desktop"',
      '{}',
      '```',
    ].join('\n')

    const [board] = readMobileTldrawWhiteboards({ markdown: content })
    expect(board?.metadataSuffix).toBe('compact="true" data-owner="desktop"')

    const result = updateMobileTldrawWhiteboard({
      markdown: content,
      update: {
        height: '720',
        key: 'map',
        snapshot: '{ "document": true }',
      },
    })

    expect(result.updated).toBe(true)
    expect(result.markdown).toBe([
      '# Planning',
      '',
      '```tldraw id="map" height="720" width="900" compact="true" data-owner="desktop"',
      '{ "document": true }',
      '```',
    ].join('\n'))
  })

  it('preserves leading-space tldraw fence indentation when editing from mobile', () => {
    const content = [
      '# Planning',
      '',
      '  ```tldraw id="map" height="640"',
      '  { "store": true }',
      '  ```',
      '',
      'Tail',
    ].join('\n')

    const [board] = readMobileTldrawWhiteboards({ markdown: content })
    expect(board?.indent).toBe('  ')
    expect(board?.snapshot).toBe('{ "store": true }')

    const result = updateMobileTldrawWhiteboard({
      markdown: content,
      update: {
        height: '720',
        key: 'map',
        snapshot: '{ "store": { "shape": true } }',
        width: '900',
      },
    })

    expect(result.updated).toBe(true)
    expect(result.markdown).toBe([
      '# Planning',
      '',
      '  ```tldraw id="map" height="720" width="900"',
      '  { "store": { "shape": true } }',
      '  ```',
      '',
      'Tail',
    ].join('\n'))
  })

  it('does not treat code-indented tldraw fences as desktop whiteboards', () => {
    const content = [
      '# Planning',
      '',
      '    ```tldraw id="map" height="640"',
      '    {}',
      '    ```',
    ].join('\n')

    expect(readMobileTldrawWhiteboards({ markdown: content })).toEqual([])
    expect(updateMobileTldrawWhiteboard({
      markdown: content,
      update: {
        height: '720',
        key: 'map',
        snapshot: '{}',
      },
    })).toEqual({ markdown: content, updated: false })
  })

  it('uses a longer fence when the snapshot contains backticks', () => {
    expect(mobileTldrawFenceSource({
      boardId: 'quoted',
      height: '520',
      metadataSuffix: 'compact="true"',
      snapshot: '{ "text": "```" }',
      width: '',
    })).toBe([
      '````tldraw id="quoted" height="520" compact="true"',
      '{ "text": "```" }',
      '````',
    ].join('\n'))
  })

  it('leaves content unchanged when the target board is missing', () => {
    const content = '# No board\n'

    expect(updateMobileTldrawWhiteboard({
      markdown: content,
      update: {
        key: 'missing',
        snapshot: '{}',
      },
    })).toEqual({ markdown: content, updated: false })
  })

  it('adds a desktop-compatible text shape to an existing store snapshot', () => {
    const result = addMobileTldrawTextShapeToSnapshot({
      snapshot: JSON.stringify({
        schema: {
          schemaVersion: 2,
          sequences: {},
        },
        store: {
          'document:document': {
            gridSize: 20,
            id: 'document:document',
            meta: {},
            name: 'Board',
            typeName: 'document',
          },
          'page:page': {
            id: 'page:page',
            index: 'a1',
            meta: {},
            name: 'Page 1',
            typeName: 'page',
          },
        },
      }),
      text: 'Draft next plan',
    })

    expect(result.added).toBe(true)
    expect(JSON.parse(result.snapshot)).toMatchObject(expectedAddedDesktopTextShape())
  })

  it('leaves incompatible snapshots unchanged instead of inventing a non-loading store', () => {
    expect(canAddMobileTldrawTextShapeToSnapshot({ snapshot: '{}' })).toBe(false)
    expect(addMobileTldrawTextShapeToSnapshot({ snapshot: '{}', text: 'Draft next plan' })).toEqual({
      added: false,
      snapshot: '{}',
    })
  })

  it('preserves existing desktop records when adding a mobile text shape', () => {
    const result = addMobileTldrawTextShapeToSnapshot({
      snapshot: JSON.stringify({
        records: {
          'document:document': {
            gridSize: 20,
            id: 'document:document',
            meta: { owner: 'desktop' },
            name: 'Board',
            typeName: 'document',
          },
          'page:existing': {
            id: 'page:existing',
            index: 'a1',
            meta: {},
            name: 'Desktop page',
            typeName: 'page',
          },
          'shape:desktop': {
            id: 'shape:desktop',
            index: 'a1',
            parentId: 'page:existing',
            typeName: 'shape',
          },
        },
      }),
      text: 'Mobile note',
    })

    const snapshot = JSON.parse(result.snapshot)
    expect(snapshot.records['document:document'].meta).toEqual({ owner: 'desktop' })
    expect(snapshot.records['shape:desktop']).toMatchObject({ parentId: 'page:existing' })
    expect(snapshot.records['shape:mobile-text-2']).toMatchObject({
      index: 'a2',
      parentId: 'page:existing',
      type: 'text',
    })
  })

  it('reads existing desktop text shapes from rich text and legacy text props', () => {
    const snapshot = JSON.stringify({
      store: {
        'shape:rich': {
          id: 'shape:rich',
          props: {
            richText: {
              content: [{
                content: [
                  { text: 'First line', type: 'text' },
                  { type: 'hardBreak' },
                  { text: 'continued', type: 'text' },
                ],
                type: 'paragraph',
              }, {
                content: [{ text: 'Second paragraph', type: 'text' }],
                type: 'paragraph',
              }],
              type: 'doc',
            },
          },
          type: 'text',
          typeName: 'shape',
        },
        'shape:legacy': {
          id: 'shape:legacy',
          props: { text: 'Legacy label' },
          type: 'text',
          typeName: 'shape',
        },
        'shape:geo': {
          id: 'shape:geo',
          props: {},
          type: 'geo',
          typeName: 'shape',
        },
      },
    })

    expect(readMobileTldrawTextShapesFromSnapshot({ snapshot })).toEqual([
      { id: 'shape:rich', text: 'First line\ncontinued\nSecond paragraph' },
      { id: 'shape:legacy', text: 'Legacy label' },
    ])
  })

  it('updates an existing desktop text shape without replacing its record geometry', () => {
    const result = updateMobileTldrawTextShapeInSnapshot({
      shapeId: 'shape:desktop-text',
      snapshot: JSON.stringify({
        records: {
          'shape:desktop-text': {
            id: 'shape:desktop-text',
            index: 'a3',
            meta: { owner: 'desktop' },
            parentId: 'page:existing',
            props: {
              color: 'blue',
              richText: {
                content: [{
                  content: [{ text: 'Old label', type: 'text' }],
                  type: 'paragraph',
                }],
                type: 'doc',
              },
              w: 320,
            },
            rotation: 0.2,
            type: 'text',
            typeName: 'shape',
            x: 210,
            y: 144,
          },
          'shape:geo': {
            id: 'shape:geo',
            props: {},
            type: 'geo',
            typeName: 'shape',
          },
        },
      }),
      text: 'Updated mobile label',
    })

    expect(result.updated).toBe(true)
    expect(JSON.parse(result.snapshot)).toMatchObject(expectedUpdatedDesktopTextGeometry())
  })

  it('removes a text shape and its bindings while preserving unrelated records', () => {
    const result = removeMobileTldrawTextShapeFromSnapshot({
      shapeId: 'shape:desktop-text',
      snapshot: JSON.stringify({
        store: {
          'binding:arrow-text': {
            fromId: 'shape:arrow',
            id: 'binding:arrow-text',
            toId: 'shape:desktop-text',
            typeName: 'binding',
          },
          'binding:other': {
            fromId: 'shape:arrow',
            id: 'binding:other',
            toId: 'shape:geo',
            typeName: 'binding',
          },
          'shape:keyed-record': {
            id: 'shape:desktop-text',
            props: { text: 'Remove me' },
            type: 'text',
            typeName: 'shape',
          },
          'shape:geo': {
            id: 'shape:geo',
            props: {},
            type: 'geo',
            typeName: 'shape',
          },
        },
      }),
    })

    const snapshot = JSON.parse(result.snapshot)
    expect(result.removed).toBe(true)
    expect(snapshot.store['shape:keyed-record']).toBeUndefined()
    expect(snapshot.store['binding:arrow-text']).toBeUndefined()
    expect(snapshot.store['binding:other']).toMatchObject({ toId: 'shape:geo' })
    expect(snapshot.store['shape:geo']).toMatchObject({ type: 'geo' })
  })

  it('leaves snapshots unchanged when editing a missing or non-text shape', () => {
    const snapshot = JSON.stringify({
      store: {
        'shape:geo': {
          id: 'shape:geo',
          props: {},
          type: 'geo',
          typeName: 'shape',
        },
      },
    })

    expect(updateMobileTldrawTextShapeInSnapshot({
      shapeId: 'shape:geo',
      snapshot,
      text: 'No-op',
    })).toEqual({ snapshot, updated: false })
    expect(removeMobileTldrawTextShapeFromSnapshot({ shapeId: 'shape:missing', snapshot })).toEqual({
      removed: false,
      snapshot,
    })
  })
})

function expectedAddedDesktopTextShape() {
  return {
      schema: {
        schemaVersion: 2,
      },
      store: {
        'document:document': {
          id: 'document:document',
          typeName: 'document',
        },
        'page:page': {
          id: 'page:page',
          typeName: 'page',
        },
        'shape:mobile-text-1': {
          index: 'a1',
          parentId: 'page:page',
          props: {
            richText: {
              content: [{
                content: [{ text: 'Draft next plan', type: 'text' }],
                type: 'paragraph',
              }],
              type: 'doc',
            },
          },
          type: 'text',
          typeName: 'shape',
        },
      },
    }
}

function expectedUpdatedDesktopTextGeometry() {
  return {
      records: {
        'shape:desktop-text': {
          index: 'a3',
          meta: { owner: 'desktop' },
          parentId: 'page:existing',
          props: {
            color: 'blue',
            richText: {
              content: [{
                content: [{ text: 'Updated mobile label', type: 'text' }],
                type: 'paragraph',
              }],
              type: 'doc',
            },
            w: 320,
          },
          rotation: 0.2,
          type: 'text',
          x: 210,
          y: 144,
        },
        'shape:geo': {
          id: 'shape:geo',
          type: 'geo',
        },
      },
    }
}
