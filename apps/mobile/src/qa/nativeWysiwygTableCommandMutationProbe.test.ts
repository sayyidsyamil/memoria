import { describe, expect, it } from 'vitest'
import { tiptapJsonToMobileMarkdown, type TiptapJsonNode } from '../workspace/mobileDocumentContent'
import type { MobileMarkdownTableAlignment } from '../workspace/mobileMarkdownTables'
import {
  assertNativeWysiwygTableCommandMutationProofs,
  formatNativeWysiwygTableCommandMutationFailures,
  nativeWysiwygTableCommandMutationLogLine,
  nativeWysiwygTableCommandMutationProbeEnabled,
  nativeWysiwygTableCommandMutationProbeJson,
  nativeWysiwygTableCommandMutationProof,
  parseNativeWysiwygTableCommandMutationProofs,
} from './nativeWysiwygTableCommandMutationProbe'

describe('native WYSIWYG table command mutation probe', () => {
  it('starts from a structured probe table', () => {
    expect(nativeWysiwygTableCommandMutationProbeJson()).toMatchObject({
      content: [{
        content: [
          tableRowWithCells('tableHeader', [
            { alignment: 'left', text: 'Column' },
            { alignment: 'right', text: 'Value' },
          ]),
          tableRowWithCells('tableCell', [
            { alignment: 'left', text: 'Item' },
            { alignment: 'right', text: 'Detail' },
          ]),
        ],
        type: 'table',
      }],
      type: 'doc',
    })
  })

  it('builds a passing proof when a native table command adds a row and column', () => {
    const json = mutatedProbeJson()
    const content = `${tiptapJsonToMobileMarkdown(json)}\n`

    expect(nativeWysiwygTableCommandMutationProof({ content, json, noteId: 'note.md' })).toEqual({
      columnCount: 3,
      contentLength: content.length,
      jsonAlignmentPreserved: true,
      jsonMutated: true,
      markdownAlignmentSaved: true,
      markdownSaved: true,
      noteId: 'note.md',
      rowCount: 3,
    })
  })

  it('parses and asserts simulator log proofs', () => {
    const json = mutatedProbeJson()
    const proof = nativeWysiwygTableCommandMutationProof({
      content: `${tiptapJsonToMobileMarkdown(json)}\n`,
      json,
      noteId: 'note.md',
    })

    expect(parseNativeWysiwygTableCommandMutationProofs(
      nativeWysiwygTableCommandMutationLogLine(proof),
    )).toEqual([proof])
    expect(assertNativeWysiwygTableCommandMutationProofs([proof])).toEqual([])
  })

  it('reports missing and failed table command mutation proofs', () => {
    expect(formatNativeWysiwygTableCommandMutationFailures(
      assertNativeWysiwygTableCommandMutationProofs([]),
    )).toContain('editor.wysiwyg.tableCommandMutation')

    expect(assertNativeWysiwygTableCommandMutationProofs([
      nativeWysiwygTableCommandMutationProof({
        content: `${tiptapJsonToMobileMarkdown(nativeWysiwygTableCommandMutationProbeJson())}\n`,
        json: nativeWysiwygTableCommandMutationProbeJson(),
        noteId: 'note.md',
      }),
    ])).toEqual([
      {
        id: 'editor.wysiwyg.tableCommandMutation.json',
        message: 'Native WYSIWYG table command mutates structured TenTap table JSON',
      },
      {
        id: 'editor.wysiwyg.tableCommandMutation.markdown',
        message: 'Native WYSIWYG table command mutation saves as desktop markdown table lines',
      },
    ])
  })

  it('reports native table command mutations that strip alignment metadata', () => {
    const json = mutatedUnalignedProbeJson()
    const proof = nativeWysiwygTableCommandMutationProof({
      content: `${tiptapJsonToMobileMarkdown(json)}\n`,
      json,
      noteId: 'note.md',
    })

    expect(proof).toMatchObject({
      jsonAlignmentPreserved: false,
      jsonMutated: true,
      markdownAlignmentSaved: false,
      markdownSaved: true,
    })
    expect(assertNativeWysiwygTableCommandMutationProofs([proof])).toEqual([
      {
        id: 'editor.wysiwyg.tableCommandMutation.jsonAlignment',
        message: 'Native WYSIWYG table command mutation preserves structured table alignment metadata',
      },
      {
        id: 'editor.wysiwyg.tableCommandMutation.markdownAlignment',
        message: 'Native WYSIWYG table command mutation saves desktop markdown table alignment dividers',
      },
    ])
  })

  it('detects the native QA query flag', () => {
    expect(nativeWysiwygTableCommandMutationProbeEnabled(
      new globalThis.URLSearchParams('wysiwygTableCommandMutationProbe=1'),
    )).toBe(true)
    expect(nativeWysiwygTableCommandMutationProbeEnabled(
      new globalThis.URLSearchParams('wysiwygTableCommandMutationProbe=0'),
    )).toBe(false)
  })
})

function mutatedProbeJson(): TiptapJsonNode {
  return {
    content: [{
      content: [
        tableRowNode('tableHeader', [
          { alignment: 'left', text: 'Column' },
          { text: '' },
          { alignment: 'right', text: 'Value' },
        ]),
        tableRowNode('tableCell', [
          { alignment: 'left', text: 'Item' },
          { text: '' },
          { alignment: 'right', text: 'Detail' },
        ]),
        tableRowNode('tableCell', [
          { text: '' },
          { text: '' },
          { text: '' },
        ]),
      ],
      type: 'table',
    }],
    type: 'doc',
  }
}

function mutatedUnalignedProbeJson(): TiptapJsonNode {
  return {
    content: [{
      content: [
        tableRowNode('tableHeader', [{ text: 'Column' }, { text: '' }, { text: 'Value' }]),
        tableRowNode('tableCell', [{ text: 'Item' }, { text: '' }, { text: 'Detail' }]),
        tableRowNode('tableCell', [{ text: '' }, { text: '' }, { text: '' }]),
      ],
      type: 'table',
    }],
    type: 'doc',
  }
}

type TestTableCell = {
  alignment?: MobileMarkdownTableAlignment
  text: string
}

function tableRowNode(cellType: 'tableCell' | 'tableHeader', cells: TestTableCell[]): TiptapJsonNode {
  return {
    content: cells.map((cell) => ({
      ...(cell.alignment ? { attrs: { memoriaAlignment: cell.alignment } } : {}),
      content: cell.text ? [{ content: [{ text: cell.text, type: 'text' }], type: 'paragraph' }] : [{ type: 'paragraph' }],
      type: cellType,
    })),
    type: 'tableRow',
  }
}

function tableRowWithCells(cellType: 'tableCell' | 'tableHeader', cells: TestTableCell[]) {
  return {
    content: cells.map((cell) => ({
      attrs: { memoriaAlignment: cell.alignment },
      type: cellType,
    })),
    type: 'tableRow',
  }
}
