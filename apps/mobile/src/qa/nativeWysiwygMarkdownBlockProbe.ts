type MarkdownContent = string
type NoteId = string
type ProbeLogText = string
type ProbeLine = string
type NativeWysiwygMarkdownBlockAction =
  | 'codeBlock'
  | 'divider'
  | 'mathBlock'
  | 'mermaid'
  | 'table'
  | 'whiteboard'
type NativeWysiwygMarkdownBlockPayload = {
  action: NativeWysiwygMarkdownBlockAction
}
type NativeWysiwygPlainTextPayload = {
  text: string
}

export type NativeWysiwygMarkdownBlockProof = {
  codeBlockSaved: boolean
  codeBlockStructured: boolean
  contentLength: number
  dividerSaved: boolean
  mathBlockSaved: boolean
  mathBlockRendered: boolean
  mermaidSaved: boolean
  noteId: NoteId
  plainTextSaved: boolean
  tableGrowthSaved: boolean
  tableSaved: boolean
  tableStructured: boolean
  whiteboardSaved: boolean
}

export type NativeWysiwygMarkdownBlockAssertionFailure = {
  id: string
  message: string
}

export const nativeWysiwygMarkdownBlockLogPrefix = 'MEMORIA_MOBILE_WYSIWYG_MARKDOWN_BLOCK_PROBE'

type ProofFieldName = keyof NativeWysiwygMarkdownBlockProof
type ProofFieldType = 'boolean' | 'number' | 'string'
type ProofFieldMap = {
  [Field in ProofFieldName]: NativeWysiwygMarkdownBlockProof[Field]
}
type TiptapJsonNode = {
  attrs?: Record<string, unknown>
  content?: TiptapJsonNode[]
  text?: string
  type?: string
}
type NativeWysiwygMarkdownBlockProofInput = {
  codeBlockStructured?: boolean
  content: MarkdownContent
  mathBlockRendered?: boolean
  noteId: NoteId
  tableStructured?: boolean
}

const expectedDivider = '---'
const expectedCodeBlock = '```text\ncode\n```'
const expectedMathBlock = '$$\n\\sqrt{a^2 + b^2}\n$$'
const expectedPlainText = 'Plain  \nClipboard'
const expectedMermaid = [
  '```mermaid',
  'flowchart TD',
  '    edit["Switch to the raw editor to edit"]',
  '```',
].join('\n')
const expectedWhiteboardFence = /```tldraw id="[^"]+" height="520"\n\{\}\n```/u

const proofFieldTypes = {
  codeBlockSaved: 'boolean',
  codeBlockStructured: 'boolean',
  contentLength: 'number',
  dividerSaved: 'boolean',
  mathBlockSaved: 'boolean',
  mathBlockRendered: 'boolean',
  mermaidSaved: 'boolean',
  noteId: 'string',
  plainTextSaved: 'boolean',
  tableGrowthSaved: 'boolean',
  tableSaved: 'boolean',
  tableStructured: 'boolean',
  whiteboardSaved: 'boolean',
} as const satisfies Record<ProofFieldName, ProofFieldType>

const proofFields = Object.keys(proofFieldTypes) as ProofFieldName[]

export function nativeWysiwygMarkdownBlockProbePayloads(): NativeWysiwygMarkdownBlockPayload[] {
  return [
    { action: 'divider' },
    { action: 'codeBlock' },
    { action: 'mathBlock' },
    { action: 'mermaid' },
    { action: 'table' },
    { action: 'whiteboard' },
  ]
}

export function nativeWysiwygMarkdownBlockProbePlainTextPayload(): NativeWysiwygPlainTextPayload {
  return { text: 'Plain\nClipboard' }
}

export function nativeWysiwygMarkdownBlockProof({
  codeBlockStructured = false,
  content,
  mathBlockRendered = false,
  noteId,
  tableStructured = false,
}: NativeWysiwygMarkdownBlockProofInput): NativeWysiwygMarkdownBlockProof {
  const normalizedContent = normalizedMarkdown(content)

  return {
    codeBlockSaved: normalizedContent.includes(expectedCodeBlock),
    codeBlockStructured,
    contentLength: content.length,
    dividerSaved: markdownBlocks(normalizedContent).includes(expectedDivider),
    mathBlockSaved: normalizedContent.includes(expectedMathBlock),
    mathBlockRendered,
    mermaidSaved: normalizedContent.includes(expectedMermaid),
    noteId,
    plainTextSaved: normalizedContent.includes(expectedPlainText),
    tableGrowthSaved: hasTableWithAddedRowAndColumn(normalizedContent),
    tableSaved: hasInsertedTable(normalizedContent),
    tableStructured,
    whiteboardSaved: expectedWhiteboardFence.test(normalizedContent),
  }
}

export function nativeWysiwygMarkdownBlockLogLine(
  proof: NativeWysiwygMarkdownBlockProof,
): ProbeLine {
  return `${nativeWysiwygMarkdownBlockLogPrefix} ${JSON.stringify(proof)}`
}

export function publishNativeWysiwygMarkdownBlockProof(input: NativeWysiwygMarkdownBlockProofInput): void {
  console.info(nativeWysiwygMarkdownBlockLogLine(nativeWysiwygMarkdownBlockProof(input)))
}

export function parseNativeWysiwygMarkdownBlockProofs(
  logText: ProbeLogText,
): NativeWysiwygMarkdownBlockProof[] {
  return logText
    .split('\n')
    .map(parseProofLine)
    .filter((proof): proof is NativeWysiwygMarkdownBlockProof => proof !== null)
}

const markdownBlockChecks: ReadonlyArray<(proof: NativeWysiwygMarkdownBlockProof) => NativeWysiwygMarkdownBlockAssertionFailure | null> = [
  (proof) => proofFailure(proof.plainTextSaved, 'editor.wysiwyg.markdownBlocks.plainText', 'Native WYSIWYG paste-as-plain-text insertion saves unformatted clipboard text'),
  (proof) => proofFailure(proof.dividerSaved, 'editor.wysiwyg.markdownBlocks.divider', 'Native WYSIWYG divider insertion saves as desktop horizontal-rule markdown'),
  (proof) => proofFailure(proof.codeBlockSaved, 'editor.wysiwyg.markdownBlocks.codeBlock', 'Native WYSIWYG code-block insertion saves as desktop fenced-code markdown'),
  (proof) => proofFailure(proof.codeBlockStructured, 'editor.wysiwyg.markdownBlocks.codeBlockStructured', 'Native WYSIWYG code-block insertion remains a structured TenTap codeBlock before save'),
  (proof) => proofFailure(proof.mathBlockSaved, 'editor.wysiwyg.markdownBlocks.mathBlock', 'Native WYSIWYG math insertion saves as desktop display-math markdown'),
  (proof) => proofFailure(proof.mathBlockRendered, 'editor.wysiwyg.markdownBlocks.mathBlockRendered', 'Native WYSIWYG math insertion renders as MathML in the TenTap WebView'),
  (proof) => proofFailure(proof.mermaidSaved, 'editor.wysiwyg.markdownBlocks.mermaid', 'Native WYSIWYG Mermaid insertion saves as desktop fenced-diagram markdown'),
  (proof) => proofFailure(proof.tableSaved, 'editor.wysiwyg.markdownBlocks.table', 'Native WYSIWYG table insertion saves as desktop markdown table source lines'),
  (proof) => proofFailure(proof.tableGrowthSaved, 'editor.wysiwyg.markdownBlocks.tableGrowth', 'Native WYSIWYG grown structured tables save as desktop markdown table source lines'),
  (proof) => proofFailure(proof.tableStructured, 'editor.wysiwyg.markdownBlocks.tableStructured', 'Native WYSIWYG table insertion remains a structured TenTap table before save'),
  (proof) => proofFailure(proof.whiteboardSaved, 'editor.wysiwyg.markdownBlocks.whiteboard', 'Native WYSIWYG whiteboard insertion saves as desktop tldraw fenced markdown'),
]

export function assertNativeWysiwygMarkdownBlockProofs(
  proofs: NativeWysiwygMarkdownBlockProof[],
): NativeWysiwygMarkdownBlockAssertionFailure[] {
  const latest = proofs.at(-1)
  if (!latest) {
    return [{
      id: 'editor.wysiwyg.markdownBlocks',
      message: 'Native WYSIWYG markdown block insertion proof was not logged',
    }]
  }

  return markdownBlockChecks
    .map((check) => check(latest))
    .filter((failure): failure is NativeWysiwygMarkdownBlockAssertionFailure => failure !== null)
}

export function formatNativeWysiwygMarkdownBlockFailures(
  failures: NativeWysiwygMarkdownBlockAssertionFailure[],
): string {
  return failures.map((failure) => `${failure.id}: ${failure.message}`).join('\n')
}

export function nativeWysiwygMarkdownBlockProbeEnabled(searchParams: URLSearchParams): boolean {
  return searchParams.get('wysiwygMarkdownBlockProbe') === '1'
}

export function nativeWysiwygMarkdownBlockStructuredCodeBlock(json: unknown): boolean {
  return hasCodeBlockNode(json)
}

export function nativeWysiwygMarkdownBlockStructuredTable(json: unknown): boolean {
  return hasTableNode(json)
}

export function nativeWysiwygMarkdownBlockProbeTableGrowthJson(json: unknown): unknown {
  if (!isTiptapJsonNode(json)) return json

  const state = { grew: false }
  return growFirstProbeTable(json, state)
}

function parseProofLine(line: ProbeLine): NativeWysiwygMarkdownBlockProof | null {
  const prefixIndex = line.indexOf(nativeWysiwygMarkdownBlockLogPrefix)
  if (prefixIndex === -1) return null

  const rawJson = line.slice(prefixIndex + nativeWysiwygMarkdownBlockLogPrefix.length).trim()
  try {
    return parsedProof(JSON.parse(rawJson))
  } catch {
    return null
  }
}

function parsedProof(value: unknown): NativeWysiwygMarkdownBlockProof | null {
  if (!isRecord(value)) return null
  if (!isNativeWysiwygMarkdownBlockProof(value)) return null

  return {
    codeBlockSaved: value.codeBlockSaved,
    codeBlockStructured: value.codeBlockStructured,
    contentLength: value.contentLength,
    dividerSaved: value.dividerSaved,
    mathBlockSaved: value.mathBlockSaved,
    mathBlockRendered: value.mathBlockRendered,
    mermaidSaved: value.mermaidSaved,
    noteId: value.noteId,
    plainTextSaved: value.plainTextSaved,
    tableGrowthSaved: value.tableGrowthSaved,
    tableSaved: value.tableSaved,
    tableStructured: value.tableStructured,
    whiteboardSaved: value.whiteboardSaved,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isNativeWysiwygMarkdownBlockProof(
  value: Record<string, unknown>,
): value is ProofFieldMap {
  return proofFields.every((field) => typeof value[field] === proofFieldTypes[field])
}

function growFirstProbeTable(
  node: TiptapJsonNode,
  state: { grew: boolean },
): TiptapJsonNode {
  if (!state.grew && isProbeTableNode(node)) {
    state.grew = true
    return tableNodeWithAddedRowAndColumn(node)
  }

  if (!Array.isArray(node.content)) return cloneTiptapJsonNode(node)

  return cloneTiptapJsonNodeWithContent(
    node,
    node.content.map((child) => growFirstProbeTable(child, state)),
  )
}

function tableNodeWithAddedRowAndColumn(table: TiptapJsonNode): TiptapJsonNode {
  const rows = tiptapChildNodes(table)
  const columnCount = Math.max(0, ...rows.map((row) => tiptapChildNodes(row).length)) + 1
  const grownRows = rows.map((row) => tableRowWithAddedCell(row, columnCount))

  grownRows.push(blankTableRow(columnCount))
  return cloneTiptapJsonNodeWithContent(table, grownRows)
}

function tableRowWithAddedCell(row: TiptapJsonNode, columnCount: number): TiptapJsonNode {
  const cells = tiptapChildNodes(row)
  const [firstCell, ...remainingCells] = cells
  const cellType = tableCellType(firstCell) ?? 'tableCell'
  const grownCells = [
    ...(firstCell ? [cloneTiptapJsonNode(firstCell)] : []),
    blankTableCell(cellType),
    ...remainingCells.map(cloneTiptapJsonNode),
  ]

  while (grownCells.length < columnCount) {
    grownCells.push(blankTableCell(cellType))
  }

  return cloneTiptapJsonNodeWithContent(row, grownCells)
}

function blankTableRow(columnCount: number): TiptapJsonNode {
  return {
    content: Array.from({ length: columnCount }, () => blankTableCell('tableCell')),
    type: 'tableRow',
  }
}

function blankTableCell(type: 'tableCell' | 'tableHeader'): TiptapJsonNode {
  return {
    content: [{ type: 'paragraph' }],
    type,
  }
}

function tableCellType(node: TiptapJsonNode | undefined): 'tableCell' | 'tableHeader' | null {
  if (node?.type === 'tableCell' || node?.type === 'tableHeader') return node.type
  return null
}

function cloneTiptapJsonNode(node: TiptapJsonNode): TiptapJsonNode {
  const content = Array.isArray(node.content) ? node.content.map(cloneTiptapJsonNode) : undefined
  return cloneTiptapJsonNodeWithContent(node, content)
}

function cloneTiptapJsonNodeWithContent(
  node: TiptapJsonNode,
  content: TiptapJsonNode[] | undefined,
): TiptapJsonNode {
  const nextNode: TiptapJsonNode = {
    ...node,
    ...(node.attrs ? { attrs: { ...node.attrs } } : {}),
  }

  if (content) nextNode.content = content
  return nextNode
}

function hasTableWithAddedRowAndColumn(markdown: MarkdownContent): boolean {
  return markdownTables(markdown).some((table) => tableHasAddedRowAndColumn(table))
}

function hasInsertedTable(markdown: MarkdownContent): boolean {
  return markdownTables(markdown).some((table) => tableHasProbeValues(table))
}

function tableHasProbeValues(table: string[][]): boolean {
  const [header, , ...bodyRows] = table
  if (!header?.includes('Column') || !header.includes('Value')) return false

  return bodyRows.some((row) => row.includes('Item') && row.includes('Detail'))
}

function tableHasAddedRowAndColumn(table: string[][]): boolean {
  const [header, , ...bodyRows] = table
  if (!header || bodyRows.length < 2) return false
  if (header.length < 3 || !tableHasProbeValues(table)) return false

  return bodyRows.some((row) => row.length >= 3 && row.includes('Item') && row.includes('Detail'))
}

function markdownTables(markdown: MarkdownContent): string[][][] {
  const lines = markdown.split('\n')
  const tables: string[][][] = []
  let index = 0

  while (index < lines.length) {
    if (!isMarkdownTableStart(lines, index)) {
      index += 1
      continue
    }

    const result = readMarkdownTable(lines, index)
    tables.push(result.table)
    index = result.nextIndex
  }

  return tables
}

function isMarkdownTableStart(lines: string[], index: number): boolean {
  const current = lines[index] ?? ''
  const next = lines[index + 1] ?? ''
  return isMarkdownTableRow(current) && isMarkdownTableDivider(next)
}

function readMarkdownTable(lines: string[], start: number) {
  const table = lines.slice(start, start + 2).map(markdownTableCells)
  let index = start + 2
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!isMarkdownTableRow(line)) break
    table.push(markdownTableCells(line))
    index += 1
  }
  return { table, nextIndex: index }
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

function hasCodeBlockNode(value: unknown): boolean {
  if (!isTiptapJsonNode(value)) return false
  if (isProbeCodeBlockNode(value)) return true

  return tiptapChildNodes(value).some(hasCodeBlockNode)
}

function hasTableNode(value: unknown): boolean {
  if (!isTiptapJsonNode(value)) return false
  if (isProbeTableNode(value)) return true

  return tiptapChildNodes(value).some(hasTableNode)
}

function isProbeCodeBlockNode(node: TiptapJsonNode): boolean {
  return node.type === 'codeBlock'
    && node.attrs?.language === 'text'
    && tiptapChildNodes(node).some(isProbeCodeTextNode)
}

function isProbeCodeTextNode(node: TiptapJsonNode): boolean {
  return node.type === 'text' && node.text === 'code'
}

function isProbeTableNode(node: TiptapJsonNode): boolean {
  if (node.type !== 'table') return false

  const text = plainText(tiptapChildNodes(node))
  return text.includes('Column')
    && text.includes('Value')
    && text.includes('Item')
    && text.includes('Detail')
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

function normalizedMarkdown(content: MarkdownContent): MarkdownContent {
  return content.replace(/\r\n/g, '\n')
}

function markdownBlocks(content: MarkdownContent): string[] {
  return content
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
}

function proofFailure(
  passed: boolean,
  id: string,
  message: string,
): NativeWysiwygMarkdownBlockAssertionFailure | null {
  return passed ? null : { id, message }
}
