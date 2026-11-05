import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it } from 'vitest'

describe('installed editor dependency compatibility', () => {
  it('preserves the link when inline code is applied to linked text', () => {
    const editor = BlockNoteEditor.create()
    const tiptap = editor._tiptapEditor

    try {
      const { code, link } = tiptap.schema.marks
      const linkedText = link.create({ href: 'https://example.com/docs' })
      const marks = code.create().addToSet([linkedText])

      expect(marks.map(mark => mark.type.name)).toEqual(expect.arrayContaining(['code', 'link']))
    } finally {
      tiptap.destroy()
    }
  })

  it.each(['bold', 'italic', 'underline', 'strike', 'textColor', 'backgroundColor'])(
    'keeps %s excluded when inline code is applied',
    style => {
      const editor = BlockNoteEditor.create()
      const tiptap = editor._tiptapEditor

      try {
        const styleMark = tiptap.schema.marks[style].create({ stringValue: 'red' })
        const marks = tiptap.schema.marks.code.create().addToSet([styleMark])

        expect(marks.map(mark => mark.type.name)).toEqual(['code'])
      } finally {
        tiptap.destroy()
      }
    },
  )

})
