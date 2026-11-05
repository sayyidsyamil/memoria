import { describe, expect, it } from 'vitest'
import {
  mobileMarkdownEditableSourceBlockSource,
  readMobileMarkdownEditableSourceBlocks,
  updateMobileMarkdownEditableSourceBlock,
} from './mobileMarkdownSourceBlocksEditing'

describe('mobile markdown source block editing', () => {
  it('reads desktop-compatible code, mermaid, and math blocks', () => {
    const blocks = readMobileMarkdownEditableSourceBlocks({ markdown: [
      '# Source blocks',
      '',
      '```ts',
      'const answer = 42',
      '```',
      '',
      '```mermaid',
      'flowchart LR',
      '  A --> B',
      '```',
      '',
      '$$',
      'a^2 + b^2 = c^2',
      '$$',
    ].join('\n') })

    expect(blocks).toEqual(expectedDesktopSourceBlocks())
  })

  it('updates one source block without rewriting the rest of the note', () => {
    const markdown = [
      'Intro',
      '',
      '~~~js',
      'console.log("old")',
      '~~~',
      '',
      'Tail',
    ].join('\n')

    const result = updateMobileMarkdownEditableSourceBlock({
      markdown,
      update: {
        content: 'console.log("new")',
        key: 'line:2',
        kind: 'codeBlock',
        language: 'ts',
      },
    })

    expect(result.updated).toBe(true)
    expect(result.markdown).toBe([
      'Intro',
      '',
      '~~~ts',
      'console.log("new")',
      '~~~',
      '',
      'Tail',
    ].join('\n'))
  })

  it.each([
    {
      block: {
        infoSuffix: 'title="Mobile editor" {1,3}',
        language: 'ts',
      },
      expectedLines: ['```tsx title="Updated editor" {2}', 'const next = true', '```'],
      name: 'updates desktop code-fence metadata when editing code content or language',
      sourceLines: ['```ts title="Mobile editor" {1,3}', 'const previous = true', '```'],
      update: {
        content: 'const next = true',
        infoSuffix: 'title="Updated editor" {2}',
      },
    },
    {
      block: {
        content: 'const previous = true',
        indent: '  ',
        infoSuffix: 'title="Mobile editor"',
        language: 'ts',
      },
      expectedLines: [
        '  ```tsx title="Updated editor"',
        '  if (next) {',
        '    ship()',
        '  }',
        '  ```',
      ],
      name: 'preserves non-code leading spaces when updating desktop code fences',
      sourceLines: ['  ```ts title="Mobile editor"', '  const previous = true', '  ```'],
      update: {
        content: 'if (next) {\n  ship()\n}',
        infoSuffix: 'title="Updated editor"',
      },
    },
  ])('$name', ({ block, expectedLines, sourceLines, update }) => {
    const markdown = sourceBlockFixture(sourceLines)
    const [sourceBlock] = readMobileMarkdownEditableSourceBlocks({ markdown })
    expect(sourceBlock).toMatchObject(block)

    const result = updateMobileMarkdownEditableSourceBlock({
      markdown,
      update: {
        content: update.content,
        infoSuffix: update.infoSuffix,
        key: 'line:2',
        kind: 'codeBlock',
        language: 'tsx',
      },
    })

    expect(result.updated).toBe(true)
    expect(result.markdown).toBe(sourceBlockFixture(expectedLines))
  })

  it('preserves non-code leading spaces when updating desktop math blocks', () => {
    const markdown = [
      'Intro',
      '',
      '  $$',
      '  a^2 + b^2 = c^2',
      '  $$',
      '',
      'Tail',
    ].join('\n')

    const [block] = readMobileMarkdownEditableSourceBlocks({ markdown })
    expect(block).toMatchObject({
      content: 'a^2 + b^2 = c^2',
      indent: '  ',
      kind: 'mathBlock',
    })

    const result = updateMobileMarkdownEditableSourceBlock({
      markdown,
      update: {
        content: 'E = mc^2',
        key: 'line:2',
        kind: 'mathBlock',
        language: '',
      },
    })

    expect(result.updated).toBe(true)
    expect(result.markdown).toBe([
      'Intro',
      '',
      '  $$',
      '  E = mc^2',
      '  $$',
      '',
      'Tail',
    ].join('\n'))
  })

  it('does not treat code-indented fences as desktop source blocks', () => {
    const blocks = readMobileMarkdownEditableSourceBlocks({ markdown: [
      '    ```ts',
      '    const literalFence = true',
      '    ```',
      '',
      '```ts',
      'const realFence = true',
      '```',
    ].join('\n') })

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      content: 'const realFence = true',
      key: 'line:4',
      language: 'ts',
    })
  })

  it('lengthens source block fences when edited content contains the original fence marker', () => {
    const markdown = [
      'Intro',
      '',
      '~~~md title="Nested fence"',
      'old',
      '~~~',
      '',
      'Tail',
    ].join('\n')

    const result = updateMobileMarkdownEditableSourceBlock({
      markdown,
      update: {
        content: '```ts\nconst nested = true\n```\n~~~',
        infoSuffix: 'title="Nested fence"',
        key: 'line:2',
        kind: 'codeBlock',
        language: 'md',
      },
    })

    expect(result.updated).toBe(true)
    expect(result.markdown).toBe([
      'Intro',
      '',
      '~~~~md title="Nested fence"',
      '```ts',
      'const nested = true',
      '```',
      '~~~',
      '~~~~',
      '',
      'Tail',
    ].join('\n'))
  })

  it('skips tldraw fences so whiteboards keep their dedicated editor', () => {
    const blocks = readMobileMarkdownEditableSourceBlocks({ markdown: [
      '```tldraw id="board"',
      '{}',
      '```',
      '',
      '```mermaid',
      'flowchart TD',
      '```',
    ].join('\n') })

    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.kind).toBe('mermaid')
  })

  it('writes math and mermaid blocks with desktop-compatible fences', () => {
    expect(mobileMarkdownEditableSourceBlockSource({
      content: 'E = mc^2',
      fence: '$$',
      indent: '  ',
      kind: 'mathBlock',
      language: '',
    })).toBe('  $$\n  E = mc^2\n  $$')

    expect(mobileMarkdownEditableSourceBlockSource({
      content: 'flowchart TD\n  A --> B',
      fence: '```',
      infoSuffix: 'title="Flow"',
      kind: 'mermaid',
      language: 'ignored',
    })).toBe('```mermaid title="Flow"\nflowchart TD\n  A --> B\n```')
  })

  it('leaves content unchanged when the target block is missing', () => {
    const content = '# No block\n'

    expect(updateMobileMarkdownEditableSourceBlock({
      markdown: content,
      update: {
        content: 'noop',
        key: 'line:8',
        kind: 'codeBlock',
        language: 'text',
      },
    })).toEqual({ markdown: content, updated: false })
  })
})

function sourceBlockFixture(sourceLines: string[]): string {
  return ['Intro', '', ...sourceLines, '', 'Tail'].join('\n')
}

function expectedDesktopSourceBlocks() {
  return [
      {
        content: 'const answer = 42',
        endLine: 4,
        fence: '```',
        indent: '',
        infoSuffix: '',
        key: 'line:2',
        kind: 'codeBlock',
        language: 'ts',
        startLine: 2,
      },
      {
        content: 'flowchart LR\n  A --> B',
        endLine: 9,
        fence: '```',
        indent: '',
        infoSuffix: '',
        key: 'line:6',
        kind: 'mermaid',
        language: 'mermaid',
        startLine: 6,
      },
      {
        content: 'a^2 + b^2 = c^2',
        endLine: 13,
        fence: '$$',
        indent: '',
        infoSuffix: '',
        key: 'line:11',
        kind: 'mathBlock',
        language: '',
        startLine: 11,
      },
    ]
}
