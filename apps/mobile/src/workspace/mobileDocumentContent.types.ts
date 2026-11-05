import type { MobileNote } from './mobileWorkspaceModel'

export type MarkdownContent = string

export type MarkdownBody = string

export type HtmlSnippet = string

export type LinkLabel = string

export type MarkdownLine = string

export type MarkdownLines = MarkdownLine[]

export type MarkdownLineMatcher = (line: MarkdownLine) => boolean

export type CodeFenceSourceMode = 'indented' | 'root'

export type NoteTitleText = string

export type PlainText = string

export type ReadHtmlBlockResult = { html: HtmlSnippet; nextIndex: number }

export type InlineMarkdownSpan = { endIndex: number; html: HtmlSnippet }

export type InlineMarkdownTokenReader = (markdown: MarkdownLine, index: number) => InlineMarkdownSpan | null

export type ReadListSourceLinesResult = {
  baseIndent: number
  hasContinuation: boolean
  hasHardBreak: boolean
  lines: MarkdownLines
  nextIndex: number
}

export type ReadParagraphResult = { lines: MarkdownLines; nextIndex: number }

export type ReadSourceLinesResult = { lines: MarkdownLines; nextIndex: number }

export type ReadQuoteResult = { paragraphs: MarkdownLines[]; nextIndex: number }

export type UrlText = string

export type MarkdownNormalizer = (markdown: MarkdownBody) => MarkdownBody

export type TiptapMarkdownOptions = {
  vaultRootUri?: string | null
}

export type SerializeInlineOptions = TiptapMarkdownOptions & {
  escapePlainText?: boolean
}

export type TiptapJsonMark = {
  attrs?: Record<string, unknown>
  type?: string
}

export type TiptapJsonNode = {
  attrs?: Record<string, unknown>
  content?: TiptapJsonNode[]
  marks?: TiptapJsonMark[]
  props?: Record<string, unknown>
  text?: string
  type?: string
}

export type ListKind = 'bullet' | 'ordered' | 'task'

export type MobileEditableDocumentSource = Pick<MobileNote, 'editorBlocks' | 'rawContent' | 'title'> & {
  editorBullets?: string[]
}
