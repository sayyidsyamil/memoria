import type { TiptapJsonNode } from '../workspace/mobileDocumentContent'
import type { MobileMarkdownTableAlignment } from '../workspace/mobileMarkdownTables'

type MarkdownContent = string
type NoteId = string
type ProbeLogText = string
type ProbeLine = string
type ProbeTableCell = {
  alignment: MobileMarkdownTableAlignment
  text: string
}

export type NativeWysiwygTableCommandMutationProof = {
  columnCount: number
  contentLength: number
  jsonAlignmentPreserved: boolean
  jsonMutated: boolean
  markdownAlignmentSaved: boolean
  markdownSaved: boolean
  noteId: NoteId
  rowCount: number
}

export type NativeWysiwygTableCommandMutationAssertionFailure = {
  id: string
  message: string
}

type NativeWysiwygTableCommandMutationProofInput = {
  content: MarkdownContent
  json: unknown
  noteId: NoteId
}
type ProofFieldName = keyof NativeWysiwygTableCommandMutationProof
type ProofFieldType = 'boolean' | 'number' | 'string'
type ProofFieldMap = {
  [Field in ProofFieldName]: NativeWysiwygTableCommandMutationProof[Field]
}
type TableDimensions = {
  columns: number
  rows: number
}

export const nativeWysiwygTableCommandMutationLogPrefix = 'MEMORIA_MOBILE_WYSIWYG_TABLE_COMMAND_MUTATION_PROBE'

const proofFieldTypes = {
  columnCount: 'number',
  contentLength: 'number',
  jsonAlignmentPreserved: 'boolean',
  jsonMutated: 'boolean',
  markdownAlignmentSaved: 'boolean',
  markdownSaved: 'boolean',
  noteId: 'string',
  rowCount: 'number',
} as const satisfies Record<ProofFieldName, ProofFieldType>
const proofFields = Object.keys(proofFieldTypes) as ProofFieldName[]

export function nativeWysiwygTableCommandMutationProbeJson(): TiptapJsonNode {
  return {
    content: [
      {
        content: [
          tableRowNode('tableHeader', [
            { alignment: 'left', text: 'Column' },
            { alignment: 'right', text: 'Value' },
          ]),
          tableRowNode('tableCell', [
            { alignment: 'left', text: 'Item' },
            { alignment: 'right', text: 'Detail' },
          ]),
        ],
        type: 'table',
      },
    ],
    type: 'doc',
  }
}

export function nativeWysiwygTableCommandMutationProof({
  content,
  json,
  noteId,
}: NativeWysiwygTableCommandMutationProofInput): NativeWysiwygTableCommandMutationProof {
  const dimensions = firstProbeTableDimensions(json)

  return {
    columnCount: dimensions.columns,
    contentLength: content.length,
    jsonAlignmentPreserved: firstProbeTablePreservesAlignment(json),
    jsonMutated: dimensions.columns >= 3 && dimensions.rows >= 3,
    markdownAlignmentSaved: hasProbeTableAlignment(content),
    markdownSaved: hasCommandMutatedProbeTable(content),
    noteId,
    rowCount: dimensions.rows,
  }
}

export function nativeWysiwygTableCommandMutationLogLine(
  proof: NativeWysiwygTableCommandMutationProof,
): ProbeLine {
  return `${nativeWysiwygTableCommandMutationLogPrefix} ${JSON.stringify(proof)}`
}

export function parseNativeWysiwygTableCommandMutationProofs(
  logText: ProbeLogText,
): NativeWysiwygTableCommandMutationProof[] {
  return logText
    .split('\n')
    .map(parseProofLine)
    .filter((proof): proof is NativeWysiwygTableCommandMutationProof => proof !== null)
}

export function assertNativeWysiwygTableCommandMutationProofs(
  proofs: NativeWysiwygTableCommandMutationProof[],
): NativeWysiwygTableCommandMutationAssertionFailure[] {
  const latest = proofs.at(-1)
  if (!latest) {
    return [{
      id: 'editor.wysiwyg.tableCommandMutation',
      message: 'Native WYSIWYG table command mutation proof was not logged',
    }]
  }

  return [
    proofFailure(
      latest.jsonMutated,
      'editor.wysiwyg.tableCommandMutation.json',
      'Native WYSIWYG table command mutates structured TenTap table JSON',
    ),
    proofFailure(
      latest.markdownSaved,
      'editor.wysiwyg.tableCommandMutation.markdown',
      'Native WYSIWYG table command mutation saves as desktop markdown table lines',
    ),
    proofFailure(
      latest.jsonAlignmentPreserved,
      'editor.wysiwyg.tableCommandMutation.jsonAlignment',
      'Native WYSIWYG table command mutation preserves structured table alignment metadata',
    ),
    proofFailure(
      latest.markdownAlignmentSaved,
      'editor.wysiwyg.tableCommandMutation.markdownAlignment',
      'Native WYSIWYG table command mutation saves desktop markdown table alignment dividers',
    ),
  ].filter((failure): failure is NativeWysiwygTableCommandMutationAssertionFailure => failure !== null)
}

export function formatNativeWysiwygTableCommandMutationFailures(
  failures: NativeWysiwygTableCommandMutationAssertionFailure[],
): string {
  return failures.map((failure) => `${failure.id}: ${failure.message}`).join('\n')
}

export function nativeWysiwygTableCommandMutationProbeEnabled(searchParams: URLSearchParams): boolean {
  return searchParams.get('wysiwygTableCommandMutationProbe') === '1'
}

function parseProofLine(line: ProbeLine): NativeWysiwygTableCommandMutationProof | null {
  const prefixIndex = line.indexOf(nativeWysiwygTableCommandMutationLogPrefix)
  if (prefixIndex === -1) return null

  const rawJson = line.slice(prefixIndex + nativeWysiwygTableCommandMutationLogPrefix.length).trim()
  try {
    return parsedProof(JSON.parse(rawJson))
  } catch {
    return null
  }
}

function parsedProof(value: unknown): NativeWysiwygTableCommandMutationProof | null {
  if (!isRecord(value)) return null
  if (!isNativeWysiwygTableCommandMutationProof(value)) return null

  return {
    columnCount: value.columnCount,
    contentLength: value.contentLength,
    jsonAlignmentPreserved: value.jsonAlignmentPreserved,
    jsonMutated: value.jsonMutated,
    markdownAlignmentSaved: value.markdownAlignmentSaved,
    markdownSaved: value.markdownSaved,
    noteId: value.noteId,
    rowCount: value.rowCount,
  }
}

function isNativeWysiwygTableCommandMutationProof(
  value: Record<string, unknown>,
): value is ProofFieldMap {
  return proofFields.every((field) => typeof value[field] === proofFieldTypes[field])
}

function firstProbeTableDimensions(json: unknown): TableDimensions {
  const table = firstProbeTable(json)
  if (!table) return { columns: 0, rows: 0 }

  const rows = tiptapChildNodes(table)
  const columns = Math.max(0, ...rows.map((row) => tiptapChildNodes(row).length))
  return { columns, rows: rows.length }
}

function firstProbeTable(value: unknown): TiptapJsonNode | null {
  if (!isTiptapJsonNode(value)) return null
  if (isProbeTableNode(value)) return value

  for (const child of tiptapChildNodes(value)) {
    const table = firstProbeTable(child)
    if (table) return table
  }

  return null
}

function isProbeTableNode(node: TiptapJsonNode): boolean {
  if (node.type !== 'table') return false

  const text = plainText(tiptapChildNodes(node))
  return text.includes('Column')
    && text.includes('Value')
    && text.includes('Item')
    && text.includes('Detail')
}

function hasCommandMutatedProbeTable(markdown: MarkdownContent): boolean {
  return markdownTables(normalizedMarkdown(markdown)).some((table) => tableHasCommandMutation(table))
}

function hasProbeTableAlignment(markdown: MarkdownContent): boolean {
  return markdownTables(normalizedMarkdown(markdown)).some(tablePreservesProbeAlignment)
}

function tableHasCommandMutation(table: string[][]): boolean {
  const [header, , ...bodyRows] = table
  if (!header?.includes('Column') || !header.includes('Value')) return false
  if (header.length < 3 || bodyRows.length < 2) return false

  return bodyRows.some((row) => row.length >= 3 && row.includes('Item') && row.includes('Detail'))
}

function tablePreservesProbeAlignment(table: string[][]): boolean {
  const [header, divider] = table
  if (!header || !divider) return false

  const columnIndex = header.indexOf('Column')
  const valueIndex = header.indexOf('Value')
  return isLeftMarkdownDivider(divider[columnIndex]) && isRightMarkdownDivider(divider[valueIndex])
}

function isLeftMarkdownDivider(value: string | undefined): boolean {
  return Boolean(value && /^:-{3,}$/u.test(value.trim()))
}

function isRightMarkdownDivider(value: string | undefined): boolean {
  return Boolean(value && /^-{3,}:$/u.test(value.trim()))
}

function markdownTables(markdown: MarkdownContent): string[][][] {
  const lines = markdown.split('\n')
  const tables: string[][][] = []
  let index = 0

  while (index < lines.length) {
    const parsed = markdownTableAt(lines, index)
    if (parsed) tables.push(parsed.table)
    index = parsed?.nextIndex ?? index + 1
  }

  return tables
}

function markdownTableAt(lines: string[], index: number): { table: string[][]; nextIndex: number } | null {
  const current = markdownTableLine(lines, index)
  const next = markdownTableLine(lines, index + 1)
  if (!isMarkdownTableRow(current) || !isMarkdownTableDivider(next)) return null
  const table = [markdownTableCells(current), markdownTableCells(next)]
  let nextIndex = index + 2
  while (nextIndex < lines.length && isMarkdownTableRow(markdownTableLine(lines, nextIndex))) {
    table.push(markdownTableCells(markdownTableLine(lines, nextIndex)))
    nextIndex += 1
  }
  return { table, nextIndex }
}

function markdownTableLine(lines: string[], index: number): string {
  return lines[index] ?? ''
}

function isMarkdownTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/u.test(line)
}

function isMarkdownTableDivider(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(line)
}

function markdownTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/u, '')
    .replace(/\|$/u, '')
    .split('|')
    .map((cell) => cell.trim())
}

function firstProbeTablePreservesAlignment(json: unknown): boolean {
  const table = firstProbeTable(json)
  if (!table) return false

  return tableCellPreservesAlignment(table, 'Column', 'left')
    && tableCellPreservesAlignment(table, 'Value', 'right')
    && tableCellPreservesAlignment(table, 'Item', 'left')
    && tableCellPreservesAlignment(table, 'Detail', 'right')
}

function tableCellPreservesAlignment(
  table: TiptapJsonNode,
  text: string,
  alignment: MobileMarkdownTableAlignment,
): boolean {
  const cell = tableCellContainingText(table, text)
  return Boolean(cell && probeCellAlignment(cell) === alignment)
}

function tableCellContainingText(node: TiptapJsonNode, text: string): TiptapJsonNode | null {
  if (node.type === 'tableCell' || node.type === 'tableHeader') {
    return plainText(tiptapChildNodes(node)).includes(text) ? node : null
  }

  for (const child of tiptapChildNodes(node)) {
    const cell = tableCellContainingText(child, text)
    if (cell) return cell
  }

  return null
}

function probeCellAlignment(node: TiptapJsonNode): MobileMarkdownTableAlignment {
  return mobileTableAlignment(node.attrs?.memoriaAlignment)
    ?? mobileTableAlignment(node.attrs?.align)
    ?? mobileTableAlignment(node.attrs?.textAlign)
    ?? 'default'
}

function mobileTableAlignment(value: unknown): MobileMarkdownTableAlignment | null {
  return value === 'center' || value === 'default' || value === 'left' || value === 'right' ? value : null
}

function tableRowNode(cellType: 'tableCell' | 'tableHeader', cells: ProbeTableCell[]): TiptapJsonNode {
  return {
    content: cells.map(({ alignment, text }) => ({
      attrs: { memoriaAlignment: alignment },
      content: [{ content: [{ text, type: 'text' }], type: 'paragraph' }],
      type: cellType,
    })),
    type: 'tableRow',
  }
}

function plainText(nodes: TiptapJsonNode[]): string {
  return nodes.map((node) => (
    node.type === 'text' ? node.text ?? '' : plainText(tiptapChildNodes(node))
  )).join(' ')
}

function tiptapChildNodes(node: TiptapJsonNode): TiptapJsonNode[] {
  return Array.isArray(node.content) ? node.content : []
}

function isTiptapJsonNode(value: unknown): value is TiptapJsonNode {
  return Boolean(value && typeof value === 'object')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function normalizedMarkdown(content: MarkdownContent): MarkdownContent {
  return content.replace(/\r\n/g, '\n')
}

function proofFailure(
  passed: boolean,
  id: string,
  message: string,
): NativeWysiwygTableCommandMutationAssertionFailure | null {
  return passed ? null : { id, message }
}
