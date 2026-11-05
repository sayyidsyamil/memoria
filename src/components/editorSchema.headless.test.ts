import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it } from 'vitest'
import { headlessSchema } from '../../packages/markdown-yjs/src/schema'
import { schema } from './editorSchema'

/**
 * The server builds collaborative documents with `headlessSchema`, the editor edits them
 * with `schema`. Both must describe the same ProseMirror nodes and marks, or a block written
 * by one side cannot be read by the other.
 */

interface Shape {
  content: string | undefined
  group: string | undefined
  attrs: Record<string, unknown>
}

function shape(spec: object): Shape {
  const { content, group, attrs = {} } = spec as { content?: string; group?: string; attrs?: Record<string, { default?: unknown }> }
  return { content, group, attrs: Object.fromEntries(Object.entries(attrs).map(([key, attr]) => [key, attr.default])) }
}

function shapes(specs: { forEach(visit: (name: string, spec: object) => void): void }): Map<string, Shape> {
  const found = new Map<string, Shape>()
  specs.forEach((name, spec) => {
    found.set(name, shape(spec))
  })
  return found
}

describe('headless editor schema', () => {
  const app = BlockNoteEditor.create({ schema }).pmSchema.spec
  const headless = BlockNoteEditor.create({ schema: headlessSchema }).pmSchema.spec

  it('has the nodes of the app schema, with the same content and attributes', () => {
    expect(shapes(headless.nodes)).toEqual(shapes(app.nodes))
  })

  it('has the marks of the app schema', () => {
    expect(shapes(headless.marks)).toEqual(shapes(app.marks))
  })
})
