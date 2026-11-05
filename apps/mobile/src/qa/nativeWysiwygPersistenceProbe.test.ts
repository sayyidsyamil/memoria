import { describe, expect, it } from 'vitest'
import { nativeWysiwygMutationProof } from './nativeWysiwygMutationProbe'
import {
  assertNativeWysiwygPersistenceProofs,
  nativeWysiwygPersistenceLogLine,
  parseNativeWysiwygPersistenceProofs,
  type NativeWysiwygPersistenceProof,
} from './nativeWysiwygPersistenceProbe'

const probePath = 'Memoria/Mobile UI/WYSIWYG Persistence Probe.md'
const passingMutationContent = [
  '---',
  'type: Essay',
  'Status: Draft',
  'tags:',
  '  - Design',
  '  - AI',
  '_favorite: true',
  '---',
  '# Native WYSIWYG Mutation Probe',
  '',
  'Native bridge mutation saved through TenTap.',
  '',
  'Formatting: **bold**, *italic*, ~~strike~~, `code`, ==highlight==, [[AI Ops Guide]].',
  '',
  '[project brief.pdf](<attachments/project brief.pdf>)',
  '',
  '![mobile diagram.png](<attachments/mobile diagram.png>)',
  '',
  '- Bullet item',
  '',
  '1. Ordered item',
  '',
  '- [x] Task item',
  '',
  '> Quoted desktop parity',
  '',
  '```ts',
  'const parity = "desktop";',
  'ship(parity)',
  '```',
  '',
  '---',
  '',
  '| Surface | Target |',
  '| :--- | ---: |',
  '| Editor | Native WYSIWYG |',
  '',
  '```plain text',
  'prompt: keep [[literal]]',
  '```',
  '',
  '<details><summary>Manufacturing</summary>',
  '',
  'Made in Italy',
  '',
  '</details>',
  '',
  '<!--',
  '{"fold":true}',
  '-->',
  '',
  '    $$',
  '    x^2',
  '    $$',
  '',
  '    ![](https://example.com/agent.png)',
  '',
  '    1. Contextualize: Dump TOC into an LLM.',
  '    2. Summarize major sections.',
  '',
  '    Teach your AI agent the workflow context.',
  '    Then run the task.',
  '',
].join('\n')

describe('native WYSIWYG persistence probe', () => {
  it('passes when the saved native file still has desktop markdown boundaries', () => {
    const proof = passingPersistenceProof()

    expect(assertNativeWysiwygPersistenceProofs([proof])).toEqual([])
  })

  it('parses simulator log lines and reports native repository failures', () => {
    const proof = {
      ...passingPersistenceProof(),
      path: 'Other.md',
      persistedToNativeRepository: false,
    }
    const parsed = parseNativeWysiwygPersistenceProofs(`noise\n${nativeWysiwygPersistenceLogLine(proof)}\n`)

    expect(parsed).toEqual([proof])
    expect(assertNativeWysiwygPersistenceProofs(parsed).map((failure) => failure.id)).toEqual([
      'editor.wysiwyg.persistence.native',
      'editor.wysiwyg.persistence.path',
    ])
  })

  it('keeps mutation/frontmatter failures visible after parsing', () => {
    const proof: NativeWysiwygPersistenceProof = {
      mutation: nativeWysiwygMutationProof({
        content: '# Native WYSIWYG Mutation Probe\n\nNative bridge mutation saved through TenTap.\n',
        noteId: probePath,
      }),
      path: probePath,
      persistedToNativeRepository: true,
    }

    expect(parseNativeWysiwygPersistenceProofs(nativeWysiwygPersistenceLogLine(proof))).toEqual([proof])
    expect(assertNativeWysiwygPersistenceProofs([proof]).map((failure) => failure.id)).toEqual([
      'editor.wysiwyg.persistence.mutation.frontmatter',
      'editor.wysiwyg.persistence.mutation.attachment',
      'editor.wysiwyg.persistence.mutation.imageAttachment',
      'editor.wysiwyg.persistence.mutation.type',
      'editor.wysiwyg.persistence.mutation.status',
      'editor.wysiwyg.persistence.mutation.tags',
      'editor.wysiwyg.persistence.mutation.favorite',
      'editor.wysiwyg.persistence.mutation.inline',
      'editor.wysiwyg.persistence.mutation.wikilink',
      'editor.wysiwyg.persistence.mutation.lists',
      'editor.wysiwyg.persistence.mutation.quote',
      'editor.wysiwyg.persistence.mutation.codeBlock',
      'editor.wysiwyg.persistence.mutation.divider',
      'editor.wysiwyg.persistence.mutation.table',
      'editor.wysiwyg.persistence.mutation.tableAlignment',
      'editor.wysiwyg.persistence.mutation.source.complexCodeFence',
      'editor.wysiwyg.persistence.mutation.source.details',
      'editor.wysiwyg.persistence.mutation.source.htmlComment',
      'editor.wysiwyg.persistence.mutation.source.indentedDisplayMath',
      'editor.wysiwyg.persistence.mutation.source.indentedImage',
      'editor.wysiwyg.persistence.mutation.source.indentedList',
      'editor.wysiwyg.persistence.mutation.source.indentedText',
    ])
  })
})

function passingPersistenceProof(): NativeWysiwygPersistenceProof {
  return {
    mutation: nativeWysiwygMutationProof({
      content: passingMutationContent,
      noteId: probePath,
    }),
    path: probePath,
    persistedToNativeRepository: true,
  }
}
