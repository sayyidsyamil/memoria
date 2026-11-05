import { describe, expect, it } from 'vitest'
import {
  assertNativeWysiwygMarkdownBlockProofs,
  formatNativeWysiwygMarkdownBlockFailures,
  nativeWysiwygMarkdownBlockLogLine,
  nativeWysiwygMarkdownBlockProbeEnabled,
  nativeWysiwygMarkdownBlockProbePlainTextPayload,
  nativeWysiwygMarkdownBlockProbePayloads,
  nativeWysiwygMarkdownBlockProbeTableGrowthJson,
  nativeWysiwygMarkdownBlockProof,
  nativeWysiwygMarkdownBlockStructuredCodeBlock,
  nativeWysiwygMarkdownBlockStructuredTable,
  parseNativeWysiwygMarkdownBlockProofs,
} from './nativeWysiwygMarkdownBlockProbe'

describe('native WYSIWYG markdown block probe', () => {
  it('uses the canonical native markdown block payloads', () => {
    expect(nativeWysiwygMarkdownBlockProbePlainTextPayload()).toEqual({ text: 'Plain\nClipboard' })
    expect(nativeWysiwygMarkdownBlockProbePayloads()).toEqual([
      { action: 'divider' },
      { action: 'codeBlock' },
      { action: 'mathBlock' },
      { action: 'mermaid' },
      { action: 'table' },
      { action: 'whiteboard' },
    ])
  })

  it('builds a passing proof when inserted blocks save as desktop markdown', () => {
    expectPassingMarkdownBlockProof(markdownBlockProofContent(), { dividerSaved: true, noteId: 'note.md' })
  })

  it('does not confuse frontmatter delimiters with an inserted divider', () => {
    expectPassingMarkdownBlockProof(
      markdownBlockProofContent({ divider: false, frontmatter: true }),
      { dividerSaved: false },
    )
  })

  it('parses and asserts simulator log proofs', () => {
    const proof = nativeWysiwygMarkdownBlockProof({
      codeBlockStructured: true,
      content: markdownBlockProofContent({ title: 'Intro' }),
      mathBlockRendered: true,
      noteId: 'note.md',
      tableStructured: true,
    })

    expect(parseNativeWysiwygMarkdownBlockProofs(nativeWysiwygMarkdownBlockLogLine(proof))).toEqual([proof])
    expect(assertNativeWysiwygMarkdownBlockProofs([proof])).toEqual([])
  })

  it('reports missing and failed block proofs', () => {
    expect(formatNativeWysiwygMarkdownBlockFailures(
      assertNativeWysiwygMarkdownBlockProofs([]),
    )).toContain('editor.wysiwyg.markdownBlocks')
    expect(assertNativeWysiwygMarkdownBlockProofs([
      nativeWysiwygMarkdownBlockProof({ content: '# Note', noteId: 'note.md' }),
    ])).toEqual(expectedFailedBlockProofs)
  })

  it.each([
    {
      detect: nativeWysiwygMarkdownBlockStructuredCodeBlock,
      name: 'code-block',
      sourceBackedJson: documentNode(sourceParagraph(['```text', 'code', '```'])),
      structuredJson: documentNode({
        attrs: { language: 'text' },
        content: [{ text: 'code', type: 'text' }],
        type: 'codeBlock',
      }),
    },
    {
      detect: nativeWysiwygMarkdownBlockStructuredTable,
      name: 'table',
      sourceBackedJson: documentNode(sourceParagraph(['| Column | Value |', '| --- | --- |', '| Item | Detail |'])),
      structuredJson: documentNode({
        content: [
          tableRowNode('tableHeader', ['Column', 'Value']),
          tableRowNode('tableCell', ['Item', 'Detail']),
        ],
        type: 'table',
      }),
    },
  ])('detects structured $name nodes in native TenTap JSON', ({ detect, sourceBackedJson, structuredJson }) => {
    expect(detect(structuredJson)).toBe(true)
    expect(detect(sourceBackedJson)).toBe(false)
  })

  it('grows the inserted probe table while keeping it structured', () => {
    const grownJson = nativeWysiwygMarkdownBlockProbeTableGrowthJson(documentNode({
      content: [
        tableRowNode('tableHeader', ['Column', 'Value']),
        tableRowNode('tableCell', ['Item', 'Detail']),
      ],
      type: 'table',
    }))

    expect(nativeWysiwygMarkdownBlockStructuredTable(grownJson)).toBe(true)
    expect(grownJson).toMatchObject(documentNode({
      content: [
        tableRowWithCellTypes('tableHeader', 3),
        tableRowWithCellTypes('tableCell', 3),
        tableRowWithCellTypes('tableCell', 3),
      ],
      type: 'table',
    }))
    expect(JSON.stringify(grownJson)).toContain('Column')
    expect(JSON.stringify(grownJson)).toContain('Value')
    expect(JSON.stringify(grownJson)).toContain('Item')
    expect(JSON.stringify(grownJson)).toContain('Detail')
  })

  it('detects the native QA query flag', () => {
    expect(nativeWysiwygMarkdownBlockProbeEnabled(new globalThis.URLSearchParams('wysiwygMarkdownBlockProbe=1'))).toBe(true)
    expect(nativeWysiwygMarkdownBlockProbeEnabled(new globalThis.URLSearchParams('wysiwygMarkdownBlockProbe=0'))).toBe(false)
  })
})

function expectPassingMarkdownBlockProof(
  content: string,
  expected: { dividerSaved: boolean; noteId?: string },
): void {
  expect(nativeWysiwygMarkdownBlockProof({
    codeBlockStructured: true,
    content,
    mathBlockRendered: true,
    noteId: 'note.md',
    tableStructured: true,
  })).toMatchObject({
    codeBlockSaved: true,
    codeBlockStructured: true,
    mathBlockSaved: true,
    mathBlockRendered: true,
    mermaidSaved: true,
    plainTextSaved: true,
    tableGrowthSaved: true,
    tableSaved: true,
    tableStructured: true,
    whiteboardSaved: true,
    ...expected,
  })
}

function tableRowNode(cellType: 'tableCell' | 'tableHeader', cells: string[]) {
  return {
    content: cells.map((text) => ({
      content: [{ content: [{ text, type: 'text' }], type: 'paragraph' }],
      type: cellType,
    })),
    type: 'tableRow',
  }
}

function tableRowWithCellTypes(cellType: 'tableCell' | 'tableHeader', count: number) {
  return {
    content: Array.from({ length: count }, () => ({ type: cellType })),
    type: 'tableRow',
  }
}

function documentNode(...content: unknown[]) {
  return { content, type: 'doc' }
}

function sourceParagraph(lines: string[]) {
  return {
    content: lines.flatMap((line, index) => [
      ...(index > 0 ? [{ type: 'hardBreak' }] : []),
      { text: line, type: 'text' },
    ]),
    type: 'paragraph',
  }
}

function markdownBlockProofContent({
  divider = true,
  frontmatter = false,
  title = '# Note',
}: {
  divider?: boolean
  frontmatter?: boolean
  title?: string
} = {}): string {
  return [
    ...(frontmatter ? ['---', 'title: Note', '---'] : [title]),
    '',
    'Plain  ',
    'Clipboard',
    '',
    ...(divider ? ['---', ''] : []),
    '```text',
    'code',
    '```',
    '',
    '$$',
    '\\sqrt{a^2 + b^2}',
    '$$',
    '',
    '```mermaid',
    'flowchart TD',
    '    edit["Switch to the raw editor to edit"]',
    '```',
    '',
    '## Insert later',
    '',
    '- [ ] Ship later',
    '',
    '| Column |  | Value |',
    '| --- | --- | --- |',
    '| Item |  | Detail |',
    '|  |  |  |',
    '',
    '```tldraw id="board-1" height="520"',
    '{}',
    '```',
  ].join('\n')
}

const expectedFailedBlockProofs = [
      {
        id: 'editor.wysiwyg.markdownBlocks.plainText',
        message: 'Native WYSIWYG paste-as-plain-text insertion saves unformatted clipboard text',
      },
      {
        id: 'editor.wysiwyg.markdownBlocks.divider',
        message: 'Native WYSIWYG divider insertion saves as desktop horizontal-rule markdown',
      },
      {
        id: 'editor.wysiwyg.markdownBlocks.codeBlock',
        message: 'Native WYSIWYG code-block insertion saves as desktop fenced-code markdown',
      },
      {
        id: 'editor.wysiwyg.markdownBlocks.codeBlockStructured',
        message: 'Native WYSIWYG code-block insertion remains a structured TenTap codeBlock before save',
      },
      {
        id: 'editor.wysiwyg.markdownBlocks.mathBlock',
        message: 'Native WYSIWYG math insertion saves as desktop display-math markdown',
      },
      {
        id: 'editor.wysiwyg.markdownBlocks.mathBlockRendered',
        message: 'Native WYSIWYG math insertion renders as MathML in the TenTap WebView',
      },
      {
        id: 'editor.wysiwyg.markdownBlocks.mermaid',
        message: 'Native WYSIWYG Mermaid insertion saves as desktop fenced-diagram markdown',
      },
      {
        id: 'editor.wysiwyg.markdownBlocks.table',
        message: 'Native WYSIWYG table insertion saves as desktop markdown table source lines',
      },
      {
        id: 'editor.wysiwyg.markdownBlocks.tableGrowth',
        message: 'Native WYSIWYG grown structured tables save as desktop markdown table source lines',
      },
      {
        id: 'editor.wysiwyg.markdownBlocks.tableStructured',
        message: 'Native WYSIWYG table insertion remains a structured TenTap table before save',
      },
      {
        id: 'editor.wysiwyg.markdownBlocks.whiteboard',
        message: 'Native WYSIWYG whiteboard insertion saves as desktop tldraw fenced markdown',
      },
    ]
