import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { EditorView } from '@tiptap/pm/view'
import { describe, expect, it, vi } from 'vitest'

function createInlineAtomState(): EditorState {
  const schema = new Schema({
    nodes: {
      atom: {
        atom: true,
        group: 'inline',
        inline: true,
        toDOM: () => ['span', { 'data-atom': 'true' }],
      },
      doc: { content: 'block+' },
      paragraph: {
        content: 'inline*',
        group: 'block',
        toDOM: () => ['p', 0],
      },
      text: { group: 'inline' },
    },
  })
  const paragraph = schema.node('paragraph', null, [schema.node('atom')])
  const doc = schema.node('doc', null, [paragraph])

  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, 2),
  })
}

describe('ProseMirror selection synchronization', () => {
  it('normalizes a removed child boundary to the live parent end', () => {
    const mount = document.createElement('div')
    document.body.append(mount)
    const view = new EditorView(mount, { state: createInlineAtomState() })
    const paragraph = view.dom.querySelector('p')

    expect(paragraph).not.toBeNull()
    if (!paragraph) throw new Error('Expected ProseMirror to render the paragraph fixture')

    vi.spyOn(view, 'domSelectionRange').mockImplementation(() => {
      paragraph.replaceChildren()
      return {
        anchorNode: paragraph,
        anchorOffset: 0,
        focusNode: paragraph,
        focusOffset: 0,
      }
    })

    try {
      expect(() => view.focus()).not.toThrow()
    } finally {
      view.destroy()
      mount.remove()
    }
  })
})
