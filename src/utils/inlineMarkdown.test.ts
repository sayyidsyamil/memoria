import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import inlineMarkdownContract from '../shared/inlineMarkdownContract.json'
import { extractSnippet } from './wikilinks'
import { readableSnippet } from './inlineMarkdown'

describe('inline markdown contract', () => {
  it.each(inlineMarkdownContract.fixtures)('matches snippet behavior: $name', ({ input, expected }) => {
    expect(extractSnippet(`# Contract\n\n${input}`)).toBe(expected)
  })

  it('keeps the Safari 13 production build usable when WebKit rejects lookbehind', async () => {
    const BrowserUint8Array = globalThis.Uint8Array
    globalThis.Uint8Array = new TextEncoder().encode('').constructor as Uint8ArrayConstructor
    let output = ''
    try {
      const { build } = await import('esbuild')
      const bundle = await build({
        bundle: true,
        entryPoints: [resolve('src/utils/inlineMarkdown.ts')],
        format: 'iife',
        globalName: 'InlineMarkdown',
        target: 'safari13',
        write: false,
      })
      output = bundle.outputFiles[0]?.text ?? ''
    } finally {
      globalThis.Uint8Array = BrowserUint8Array
    }
    const NativeRegExp = RegExp
    class RejectingRegExp extends NativeRegExp {
      constructor(pattern?: string | RegExp, flags?: string) {
        const source = pattern instanceof NativeRegExp ? pattern.source : String(pattern ?? '')
        if (source.includes('(?<')) {
          throw new SyntaxError('Invalid regular expression: invalid group specifier name')
        }
        super(pattern, flags)
      }
    }
    const inlineMarkdown = runInNewContext(`${output}\nInlineMarkdown`, {
      RegExp: RejectingRegExp,
    }) as { stripInlineMarkdown: (value: string) => string }

    expect(() => inlineMarkdown.stripInlineMarkdown('Escaped \\*star\\* and foo_bar')).not.toThrow()
  })
})

describe('readableSnippet', () => {
  it.each([
    ['a link with an address in angle brackets', 'Transcript reviewed - [Recording](<../.memoria-recordings/006296a4/original.wav>) - [Reviewed transcript](<../source-pilot.md>)', 'Transcript reviewed - Recording - Reviewed transcript'],
    ['a link cut off by shortening', '[Open original](<attachments/transcript-006296a4-1afe-5a9f-b6b3-...', 'Open original'],
    ['a plain link and a titled one', 'Read [the guide](https://example.com/guide) and [notes](notes.md "Notes")', 'Read the guide and notes'],
    ['an image', 'Chart ![Budget by month](attachments/chart.png) above', 'Chart Budget by month above'],
    ['wikilinks', 'See [[meetings/kick-off|Kick-off]] and [[Budget]]', 'See Kick-off and Budget'],
    ['an address with spaces and brackets', '[Notes](<Meeting notes (final).md>) follow', 'Notes follow'],
  ])('shows only the words of %s', (_name, input, expected) => {
    expect(readableSnippet(input)).toBe(expected)
  })

  it.each([['[26Q2] roadmap'], ['Plain words only.'], ['Costs (RM) rose']])('leaves %j as written', input => {
    expect(readableSnippet(input)).toBe(input)
  })

  it('ends a preview the vault index cut short on a whole word, with an ellipsis', () => {
    // The index cuts at 160 bytes ("…and numbers are i..."); the browser preview cut "Reviewed by the fa" with no mark at all.
    const indexed = 'Fictional steering committee used for user acceptance testing. Three meetings were recorded and their transcripts reviewed. All names, vendors and numbers are i...'
    expect(readableSnippet(indexed)).toBe('Fictional steering committee used for user acceptance testing. Three meetings were recorded and their transcripts reviewed. All names, vendors and numbers are…')
    const raw = '[Open original](<attachments/transcript-974c0b51-61b4-53d4-9324-a24c194be887.txt>) [Listen to meeting audio](<.memoria-recordings/974c0b51-61b4-53d4-9324-a24c194be887/original.wav>) Reviewed by the fa...'
    expect(readableSnippet(raw)).toBe('Open original Listen to meeting audio Reviewed by the…')
    // Cut inside a link's address, the link's words are whole and stay.
    const inLink = 'Transcript reviewed · Recorded 14 Sep 2026, 09:30 - [Recording](<../.memoria-recordings/974c0b51/original.wav>) - [Reviewed transcript](<../source-Procurement-pil...'
    expect(readableSnippet(inLink)).toBe('Transcript reviewed · Recorded 14 Sep 2026, 09:30 - Recording - Reviewed transcript…')
  })

  it('keeps a short preview that ends in dots as written', () => {
    expect(readableSnippet('To be continued...')).toBe('To be continued...')
  })
})
