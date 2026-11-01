import type { TiptapJsonNode } from '../workspace/mobileDocumentContent'
import type { MobileNote } from '../workspace/mobileWorkspaceModel'

type MarkdownContent = string
type MutationLogText = string
type MutationLine = string
type NoteId = string
type FrontmatterKey = string
type FrontmatterValue = string
type ProofFailureId = string
type ProofFailureMessage = string
type MutationTableAlignment = 'left' | 'right'
type MutationTableCell = {
  alignment: MutationTableAlignment
  text: string
}

export type NativeWysiwygMutationProof = {
  attachmentLinkSaved: boolean
  codeBlockSaved: boolean
  codeBlockStructured?: boolean
  complexCodeFenceSourceSaved: boolean
  contentLength: number
  detailsSourceSaved: boolean
  dividerSaved: boolean
  favoritePreserved: boolean
  frontmatterPreserved: boolean
  htmlCommentSourceSaved: boolean
  imageAttachmentSaved: boolean
  indentedDisplayMathSourceSaved: boolean
  indentedImageSourceSaved: boolean
  indentedListSourceSaved: boolean
  indentedTextSourceSaved: boolean
  inlineMarksSaved: boolean
  listBlocksSaved: boolean
  mutationTextSaved: boolean
  noteId: NoteId
  quoteSaved: boolean
  statusPreserved: boolean
  tableAlignmentSaved: boolean
  tagsPreserved: boolean
  tableLinesPreserved: boolean
  tableStructured?: boolean
  titleSaved: boolean
  typePreserved: boolean
  wikilinkSaved: boolean
}

export type NativeWysiwygMutationAssertionFailure = {
  id: string
  message: string
}

type NativeWysiwygMutationProofInput = {
  content: MarkdownContent
  json?: unknown
  noteId: NoteId
}

type NativeWysiwygMutationSeedNote = Pick<MobileNote, 'favorite' | 'snippet' | 'status' | 'tags' | 'title' | 'type'>
type NativeWysiwygMutationBooleanField = Exclude<keyof NativeWysiwygMutationProof, 'contentLength' | 'noteId'>
type VaultRootUri = string | null | undefined

const mutationLogPrefix = 'MEMORIA_MOBILE_WYSIWYG_MUTATION_PROBE'
const mutationTitle = 'Native WYSIWYG Mutation Probe'
const mutationText = 'Native bridge mutation saved through TenTap.'
const mutationAttachmentLink = '[project brief.pdf](<attachments/project brief.pdf>)'
const mutationImageAttachment = '![mobile diagram.png](<attachments/mobile diagram.png>)'
const mutationInlineSamples = ['**bold**', '*italic*', '~~strike~~', '`code`', '==highlight=='] as const
const mutationListSamples = ['- Bullet item', '1. Ordered item', '- [x] Task item'] as const
const mutationQuote = '> Quoted desktop parity'
const mutationCodeFenceLines = ['```ts', 'const parity = "desktop";', 'ship(parity)', '```'] as const
const mutationCodeFence = mutationCodeFenceLines.join('\n')
const mutationComplexCodeFenceLines = ['```plain text', 'prompt: keep [[literal]]', '```'] as const
const mutationComplexCodeFenceSource = mutationComplexCodeFenceLines.join('\n')
const mutationDetailsSourceLines = [
  '<details><summary>Manufacturing</summary>',
  '',
  'Made in Italy',
  '',
  '</details>',
] as const
const mutationDetailsSource = mutationDetailsSourceLines.join('\n')
const mutationHtmlCommentSourceLines = ['<!--', '{"fold":true}', '-->'] as const
const mutationHtmlCommentSource = mutationHtmlCommentSourceLines.join('\n')
const mutationIndentedDisplayMathLines = ['    $$', '    x^2', '    $$'] as const
const mutationIndentedDisplayMathSource = mutationIndentedDisplayMathLines.join('\n')
const mutationIndentedImageLines = ['    ![](https://example.com/agent.png)'] as const
const mutationIndentedImageSource = mutationIndentedImageLines.join('\n')
const mutationIndentedListLines = [
  '    1. Contextualize: Dump TOC into an LLM.',
  '    2. Summarize major sections.',
] as const
const mutationIndentedListSource = mutationIndentedListLines.join('\n')
const mutationIndentedTextLines = [
  '    Teach your AI agent the workflow context.',
  '    Then run the task.',
] as const
const mutationIndentedTextSource = mutationIndentedTextLines.join('\n')
const mutationTableLines = ['| Surface | Target |', '| :--- | ---: |', '| Editor | Native WYSIWYG |'] as const
const mutationDividerBeforeTable = `\n---\n\n${mutationTableLines[0]}`
const mutationWikilink = '[[AI Ops Guide]]'
const mutationProofBooleanFields: readonly NativeWysiwygMutationBooleanField[] = [
  'attachmentLinkSaved',
  'codeBlockSaved',
  'complexCodeFenceSourceSaved',
  'detailsSourceSaved',
  'dividerSaved',
  'favoritePreserved',
  'frontmatterPreserved',
  'htmlCommentSourceSaved',
  'imageAttachmentSaved',
  'indentedDisplayMathSourceSaved',
  'indentedImageSourceSaved',
  'indentedListSourceSaved',
  'indentedTextSourceSaved',
  'inlineMarksSaved',
  'listBlocksSaved',
  'mutationTextSaved',
  'quoteSaved',
  'statusPreserved',
  'tableAlignmentSaved',
  'tagsPreserved',
  'tableLinesPreserved',
  'titleSaved',
  'typePreserved',
  'wikilinkSaved',
]
const mutationBulletListNode: TiptapJsonNode = {
  content: [{ content: [paragraphNode('Bullet item')], type: 'listItem' }],
  type: 'bulletList',
}
const mutationOrderedListNode: TiptapJsonNode = {
  attrs: { start: 1 },
  content: [{ content: [paragraphNode('Ordered item')], type: 'listItem' }],
  type: 'orderedList',
}
const mutationTaskListNode: TiptapJsonNode = {
  content: [{ attrs: { checked: true }, content: [paragraphNode('Task item')], type: 'taskItem' }],
  type: 'taskList',
}
const mutationQuoteNode: TiptapJsonNode = {
  content: [paragraphNode('Quoted desktop parity')],
  type: 'blockquote',
}
const mutationCodeBlockNode: TiptapJsonNode = {
  attrs: { language: 'ts' },
  content: [{ text: 'const parity = "desktop";\nship(parity)', type: 'text' }],
  type: 'codeBlock',
}
const mutationTableNode: TiptapJsonNode = {
  content: [
    tableRowNode('tableHeader', [
      { alignment: 'left', text: 'Surface' },
      { alignment: 'right', text: 'Target' },
    ]),
    tableRowNode('tableCell', [
      { alignment: 'left', text: 'Editor' },
      { alignment: 'right', text: 'Native WYSIWYG' },
    ]),
  ],
  type: 'table',
}

export function nativeWysiwygMutationProbeContent(vaultRootUri?: VaultRootUri): TiptapJsonNode {
  return {
    content: [
      headingNode(mutationTitle),
      paragraphNode(mutationText),
      mutationRichInlineParagraphNode(vaultRootUri),
      mutationImageNode(vaultRootUri),
      mutationBulletListNode,
      mutationOrderedListNode,
      mutationTaskListNode,
      mutationQuoteNode,
      mutationCodeBlockNode,
      paragraphNode('---'),
      mutationTableNode,
      paragraphNode(...mutationComplexCodeFenceLines),
      paragraphNode(...mutationDetailsSourceLines),
      paragraphNode(...mutationHtmlCommentSourceLines),
      paragraphNode(...mutationIndentedDisplayMathLines),
      paragraphNode(...mutationIndentedImageLines),
      paragraphNode(...mutationIndentedListLines),
      paragraphNode(...mutationIndentedTextLines),
    ],
    type: 'doc',
  }
}

export function nativeWysiwygMutationProbeInitialContent(note: NativeWysiwygMutationSeedNote): MarkdownContent {
  const frontmatter = mutationProbeFrontmatter(note)
  const body = mutationProbeInitialBody(note)

  return `---\n${frontmatter.join('\n')}\n---\n${body}`
}

export function nativeWysiwygMutationProof({
  content,
  json,
  noteId,
}: NativeWysiwygMutationProofInput): NativeWysiwygMutationProof {
  return {
    attachmentLinkSaved: content.includes(mutationAttachmentLink),
    codeBlockSaved: content.includes(mutationCodeFence),
    ...mutationStructuredProof(json),
    complexCodeFenceSourceSaved: content.includes(mutationComplexCodeFenceSource),
    contentLength: content.length,
    detailsSourceSaved: content.includes(mutationDetailsSource),
    dividerSaved: content.includes(mutationDividerBeforeTable),
    favoritePreserved: content.includes('\n_favorite: true\n'),
    frontmatterPreserved: content.startsWith('---\n'),
    htmlCommentSourceSaved: content.includes(mutationHtmlCommentSource),
    imageAttachmentSaved: content.includes(mutationImageAttachment),
    indentedDisplayMathSourceSaved: content.includes(mutationIndentedDisplayMathSource),
    indentedImageSourceSaved: content.includes(mutationIndentedImageSource),
    indentedListSourceSaved: content.includes(mutationIndentedListSource),
    indentedTextSourceSaved: content.includes(mutationIndentedTextSource),
    inlineMarksSaved: mutationInlineSamples.every((sample) => content.includes(sample)),
    listBlocksSaved: mutationListSamples.every((sample) => content.includes(sample)),
    mutationTextSaved: content.includes(mutationText),
    noteId,
    quoteSaved: content.includes(mutationQuote),
    statusPreserved: content.includes('\nStatus: Draft\n'),
    tableAlignmentSaved: hasMutationTableAlignment(content),
    tagsPreserved: content.includes('\ntags:\n  - Design\n  - AI\n'),
    tableLinesPreserved: mutationTableLines.every((line) => content.includes(line)),
    titleSaved: content.includes(`# ${mutationTitle}\n`),
    typePreserved: content.includes('\ntype: Essay\n'),
    wikilinkSaved: content.includes(mutationWikilink),
  }
}

export function nativeWysiwygMutationLogLine(proof: NativeWysiwygMutationProof): MutationLine {
  return `${mutationLogPrefix} ${JSON.stringify(proof)}`
}

export function parseNativeWysiwygMutationProofs(logText: MutationLogText): NativeWysiwygMutationProof[] {
  return logText
    .split('\n')
    .map(parseMutationProofLine)
    .filter((proof): proof is NativeWysiwygMutationProof => proof !== null)
}

export function nativeWysiwygMutationPreProofLogText(logText: MutationLogText): MutationLogText {
  const proofIndex = logText.lastIndexOf(mutationLogPrefix)
  return proofIndex === -1 ? logText : logText.slice(0, proofIndex)
}

export function assertNativeWysiwygMutationProofs(
  proofs: NativeWysiwygMutationProof[],
): NativeWysiwygMutationAssertionFailure[] {
  const latest = proofs.at(-1)
  if (!latest) {
    return [{ id: 'editor.wysiwyg.mutation', message: 'Native WYSIWYG mutation proof was not logged' }]
  }

  return [
    proofFailure(latest.frontmatterPreserved, 'editor.wysiwyg.mutation.frontmatter', 'Frontmatter boundary survives native WYSIWYG saves'),
    proofFailure(latest.attachmentLinkSaved, 'editor.wysiwyg.mutation.attachment', 'Native file attachment links serialize back to portable desktop markdown'),
    proofFailure(latest.imageAttachmentSaved, 'editor.wysiwyg.mutation.imageAttachment', 'Native image attachments serialize back to portable desktop markdown images'),
    proofFailure(latest.typePreserved, 'editor.wysiwyg.mutation.type', 'Desktop type frontmatter survives native WYSIWYG saves'),
    proofFailure(latest.statusPreserved, 'editor.wysiwyg.mutation.status', 'Desktop status frontmatter survives native WYSIWYG saves'),
    proofFailure(latest.tagsPreserved, 'editor.wysiwyg.mutation.tags', 'Desktop tag frontmatter survives native WYSIWYG saves'),
    proofFailure(latest.favoritePreserved, 'editor.wysiwyg.mutation.favorite', 'Desktop boolean frontmatter survives native WYSIWYG saves'),
    proofFailure(latest.titleSaved, 'editor.wysiwyg.mutation.title', 'Optional H1 title is saved as document content'),
    proofFailure(latest.mutationTextSaved, 'editor.wysiwyg.mutation.body', 'TenTap body mutation reaches the markdown save pipeline'),
    proofFailure(latest.inlineMarksSaved, 'editor.wysiwyg.mutation.inline', 'Native WYSIWYG inline marks serialize to desktop markdown syntax'),
    proofFailure(latest.wikilinkSaved, 'editor.wysiwyg.mutation.wikilink', 'Native WYSIWYG links can preserve Memoria wikilink markdown'),
    proofFailure(latest.listBlocksSaved, 'editor.wysiwyg.mutation.lists', 'Native WYSIWYG list blocks serialize to desktop markdown syntax'),
    proofFailure(latest.quoteSaved, 'editor.wysiwyg.mutation.quote', 'Native WYSIWYG quote blocks serialize to desktop markdown syntax'),
    proofFailure(latest.codeBlockSaved, 'editor.wysiwyg.mutation.codeBlock', 'Native WYSIWYG structured codeBlock serializes to desktop fenced-code markdown'),
    proofFailure(latest.codeBlockStructured === true, 'editor.wysiwyg.mutation.codeBlockStructured', 'Native WYSIWYG mutation proof keeps code fences as structured TenTap codeBlock JSON before save'),
    proofFailure(latest.dividerSaved, 'editor.wysiwyg.mutation.divider', 'Unsupported divider content remains editable desktop markdown'),
    proofFailure(latest.tableLinesPreserved, 'editor.wysiwyg.mutation.table', 'Native WYSIWYG structured tables serialize to desktop markdown table lines'),
    proofFailure(latest.tableAlignmentSaved, 'editor.wysiwyg.mutation.tableAlignment', 'Native WYSIWYG structured tables preserve desktop markdown alignment dividers'),
    proofFailure(latest.tableStructured === true, 'editor.wysiwyg.mutation.tableStructured', 'Native WYSIWYG mutation proof keeps tables as structured TenTap table JSON before save'),
    proofFailure(latest.complexCodeFenceSourceSaved, 'editor.wysiwyg.mutation.source.complexCodeFence', 'Complex code-fence metadata stays as editable desktop markdown source'),
    proofFailure(latest.detailsSourceSaved, 'editor.wysiwyg.mutation.source.details', 'Unsupported details blocks stay as editable desktop markdown source'),
    proofFailure(latest.htmlCommentSourceSaved, 'editor.wysiwyg.mutation.source.htmlComment', 'Unsupported HTML comment blocks stay as editable desktop markdown source'),
    proofFailure(latest.indentedDisplayMathSourceSaved, 'editor.wysiwyg.mutation.source.indentedDisplayMath', 'Code-indented display math stays as editable desktop markdown source'),
    proofFailure(latest.indentedImageSourceSaved, 'editor.wysiwyg.mutation.source.indentedImage', 'Code-indented markdown images stay as editable desktop markdown source'),
    proofFailure(latest.indentedListSourceSaved, 'editor.wysiwyg.mutation.source.indentedList', 'Code-indented lists stay as editable desktop markdown source'),
    proofFailure(latest.indentedTextSourceSaved, 'editor.wysiwyg.mutation.source.indentedText', 'Indented text blocks stay as editable desktop markdown source'),
  ].filter((failure): failure is NativeWysiwygMutationAssertionFailure => failure !== null)
}

export function formatNativeWysiwygMutationFailures(
  failures: NativeWysiwygMutationAssertionFailure[],
): string {
  return failures.map((failure) => `${failure.id}: ${failure.message}`).join('\n')
}

export function nativeWysiwygMutationProbeEnabled(searchParams: URLSearchParams): boolean {
  return searchParams.get('wysiwygMutationProbe') === '1'
}

function mutationStructuredProof(json: unknown): Partial<NativeWysiwygMutationProof> {
  if (json === undefined) return {}

  return {
    codeBlockStructured: hasNodeType(json, 'codeBlock'),
    tableStructured: hasNodeType(json, 'table'),
  }
}

function hasNodeType(value: unknown, type: string): boolean {
  if (!isTiptapJsonNode(value)) return false
  if (value.type === type) return true
  return (value.content ?? []).some((child) => hasNodeType(child, type))
}

function hasMutationTableAlignment(content: MarkdownContent): boolean {
  return content.includes('| :--- | ---: |')
}

function headingNode(text: FrontmatterValue): TiptapJsonNode {
  return {
    attrs: { level: 1 },
    content: [{ text, type: 'text' }],
    type: 'heading',
  }
}

function mutationRichInlineParagraphNode(vaultRootUri?: VaultRootUri): TiptapJsonNode {
  return {
    content: [
      { text: 'Formatting: ', type: 'text' },
      { marks: [{ type: 'bold' }], text: 'bold', type: 'text' },
      { text: ', ', type: 'text' },
      { marks: [{ type: 'italic' }], text: 'italic', type: 'text' },
      { text: ', ', type: 'text' },
      { marks: [{ type: 'strike' }], text: 'strike', type: 'text' },
      { text: ', ', type: 'text' },
      { marks: [{ type: 'code' }], text: 'code', type: 'text' },
      { text: ', ', type: 'text' },
      { marks: [{ type: 'highlight' }], text: 'highlight', type: 'text' },
      { text: ', ', type: 'text' },
      {
        marks: [{ attrs: { href: 'memoria://wikilink/AI%20Ops%20Guide' }, type: 'link' }],
        text: 'AI Ops Guide',
        type: 'text',
      },
      { text: ', ', type: 'text' },
      {
        marks: [{ attrs: { href: mutationAttachmentHref(vaultRootUri) }, type: 'link' }],
        text: 'project brief.pdf',
        type: 'text',
      },
      { text: '.', type: 'text' },
    ],
    type: 'paragraph',
  }
}

function mutationAttachmentHref(vaultRootUri?: VaultRootUri): string {
  return vaultRootUri?.trim()
    ? `${ensureTrailingSlash(vaultRootUri.trim())}attachments/project%20brief.pdf`
    : 'attachments/project brief.pdf'
}

function mutationImageNode(vaultRootUri?: VaultRootUri): TiptapJsonNode {
  return {
    attrs: {
      alt: 'mobile diagram.png',
      src: mutationImageSrc(vaultRootUri),
    },
    type: 'image',
  }
}

function mutationImageSrc(vaultRootUri?: VaultRootUri): string {
  return vaultRootUri?.trim()
    ? `${ensureTrailingSlash(vaultRootUri.trim())}attachments/mobile%20diagram.png`
    : 'attachments/mobile diagram.png'
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

function paragraphNode(...lines: readonly FrontmatterValue[]): TiptapJsonNode {
  return {
    content: lines.flatMap((line, index): TiptapJsonNode[] => [
      ...(index > 0 ? [{ type: 'hardBreak' }] : []),
      ...(line ? [{ text: line, type: 'text' }] : []),
    ]),
    type: 'paragraph',
  }
}

function tableRowNode(cellType: 'tableCell' | 'tableHeader', cells: MutationTableCell[]): TiptapJsonNode {
  return {
    content: cells.map((cell) => ({
      attrs: { memoriaAlignment: cell.alignment },
      content: [paragraphNode(cell.text)],
      type: cellType,
    })),
    type: 'tableRow',
  }
}

function mutationProbeFrontmatter(note: NativeWysiwygMutationSeedNote): FrontmatterValue[] {
  return [
    scalarFrontmatterLine('type', note.type),
    scalarFrontmatterLine('Status', note.status),
    listFrontmatterLines('tags', note.tags),
    booleanFrontmatterLine('_favorite', note.favorite),
  ].flat().filter((line): line is string => line !== null)
}

function mutationProbeInitialBody(note: NativeWysiwygMutationSeedNote): MarkdownContent {
  const body = [optionalHeading(note.title), note.snippet.trim()].filter(Boolean).join('\n\n')
  return body ? `${body}\n` : ''
}

function optionalHeading(title: FrontmatterValue): string | null {
  const text = title.trim()
  return text ? `# ${text.replace(/\r?\n/gu, ' ')}` : null
}

function scalarFrontmatterLine(key: FrontmatterKey, value: FrontmatterValue): string | null {
  const text = value.trim()
  return text ? `${key}: ${text}` : null
}

function listFrontmatterLines(key: FrontmatterKey, values: readonly FrontmatterValue[]): string[] | null {
  const items = values.map((value) => value.trim()).filter(Boolean)
  if (items.length === 0) return null

  return [`${key}:`, ...items.map((item) => `  - ${item}`)]
}

function booleanFrontmatterLine(key: FrontmatterKey, value: boolean): string | null {
  return value ? `${key}: true` : null
}

function parseMutationProofLine(line: MutationLine): NativeWysiwygMutationProof | null {
  const prefixIndex = line.indexOf(mutationLogPrefix)
  if (prefixIndex === -1) return null

  const rawJson = line.slice(prefixIndex + mutationLogPrefix.length).trim()
  try {
    const parsed: unknown = JSON.parse(rawJson)
    return isNativeWysiwygMutationProof(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isNativeWysiwygMutationProof(value: unknown): value is NativeWysiwygMutationProof {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Partial<NativeWysiwygMutationProof>
  return typeof candidate.noteId === 'string'
    && typeof candidate.contentLength === 'number'
    && mutationProofBooleanFields.every((field) => typeof candidate[field] === 'boolean')
    && optionalBooleanField(candidate.codeBlockStructured)
    && optionalBooleanField(candidate.tableStructured)
}

function isTiptapJsonNode(value: unknown): value is TiptapJsonNode {
  if (!value || typeof value !== 'object') return false

  const candidate = value as TiptapJsonNode
  return typeof candidate.type === 'string' || Array.isArray(candidate.content)
}

function optionalBooleanField(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean'
}

function proofFailure(
  passed: boolean,
  id: ProofFailureId,
  message: ProofFailureMessage,
): NativeWysiwygMutationAssertionFailure | null {
  return passed ? null : { id, message }
}
