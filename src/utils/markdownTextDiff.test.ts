import { describe, expect, it } from 'vitest'
import { markdownTextEdits } from './markdownTextDiff'

describe('Markdown text edits', () => {
  it('reconstructs edits deterministically across repeated characters and Unicode', () => {
    const alphabet = ['a', 'b', ' ', '\n', '&', '😀']
    let seed = 1234
    const randomText = () => {
      let result = ''
      for (let i = 0; i < 30; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0
        result += alphabet[seed % alphabet.length]
      }
      return result
    }
    for (let i = 0; i < 150; i++) {
      const before = randomText()
      const after = randomText()
      let result = before
      for (const edit of markdownTextEdits(before, after).reverse()) {
        result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to)
      }
      expect(result).toBe(after)
    }
  })

  it('isolates a small edit in a large note', () => {
    const prefix = 'paragraph\n\n'.repeat(10_000)
    const suffix = '\n\nending'.repeat(10_000)
    expect(markdownTextEdits(`${prefix}hello${suffix}`, `${prefix}hallo${suffix}`))
      .toEqual([{ from: prefix.length + 1, to: prefix.length + 2, insert: 'a' }])
  })
})
