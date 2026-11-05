import type { FilePrintOptions, FilePrintResult } from 'expo-print'
import type { SharingOptions } from 'expo-sharing'
import {
  mobileDocumentBody,
  mobileMarkdownBodyToTentapHtml,
  mobileNoteEditableContent,
} from './mobileDocumentContent'
import type { MobileNote } from './mobileWorkspaceModel'

export const MOBILE_PDF_EXPORT_ATTEMPTS_GLOBAL_KEY = '__MEMORIA_MOBILE_PDF_EXPORT_ATTEMPTS__'
export const MOBILE_PDF_EXPORTS_GLOBAL_KEY = '__MEMORIA_MOBILE_PDF_EXPORTS__'

export type MobilePdfExportPayload = {
  fileName: PdfFileName
  html: HtmlDocument
  noteId: NoteId
  title: NoteTitle
}

export type MobilePdfExportResult =
  | {
    fileName: string
    ok: true
    shared: boolean
    uri: string | null
  }
  | {
    ok: false
    reason: 'missingNote'
  }

export type MobilePdfExporter = (payload: MobilePdfExportPayload) => Promise<MobilePdfExporterResult>
export type MobilePdfExporterResult = string | null | undefined | {
  shared?: boolean
  uri?: string | null
}

type ExpoPrintModule = {
  printToFileAsync: (options?: FilePrintOptions) => Promise<FilePrintResult>
}
type ExpoSharingModule = {
  isAvailableAsync: () => Promise<boolean>
  shareAsync: (url: string, options?: SharingOptions) => Promise<void>
}
type FileNameCharacter = string
type FileNameStem = string
type FilePath = string
type GlobalEvidenceKey = string
type HtmlBody = string
type HtmlDocument = string
type NoteId = string
type NoteTitle = string
type PdfFileName = string

declare const require: (moduleName: string) => unknown

export async function exportMobileNoteAsPdf(
  note: MobileNote | null,
  exporter: MobilePdfExporter = exportNativeMobilePdf,
): Promise<MobilePdfExportResult> {
  const payload = mobilePdfPayloadForNote(note)
  if (!payload) return { ok: false, reason: 'missingNote' }

  recordGlobalValue(MOBILE_PDF_EXPORT_ATTEMPTS_GLOBAL_KEY, exportEvidence(payload))
  if (isBrowserRuntime()) return { fileName: payload.fileName, ok: true, shared: false, uri: null }

  const nativeResult = await exporter(payload)
  const result = exportedMobilePdfResult(payload.fileName, nativeResult)
  recordGlobalValue(MOBILE_PDF_EXPORTS_GLOBAL_KEY, result)
  return result
}

export function mobilePdfPayloadForNote(note: MobileNote | null): MobilePdfExportPayload | null {
  if (!note) return null

  const body = mobileDocumentBody(mobileNoteEditableContent(note))
  return {
    fileName: mobilePdfFileNameForNote(note),
    html: mobilePdfHtmlDocument({
      bodyHtml: mobileMarkdownBodyToTentapHtml(body),
      title: note.title,
    }),
    noteId: note.id,
    title: note.title,
  }
}

function exportNativeMobilePdf(payload: MobilePdfExportPayload): Promise<MobilePdfExporterResult> {
  const print = require('expo-print') as ExpoPrintModule
  const sharing = require('expo-sharing') as ExpoSharingModule

  return print.printToFileAsync({ html: payload.html }).then(async ({ uri }) => {
    const shared = await sharing.isAvailableAsync()
    if (shared) {
      await sharing.shareAsync(uri, {
        UTI: 'com.adobe.pdf',
        dialogTitle: payload.fileName,
        mimeType: 'application/pdf',
      })
    }

    return { shared, uri }
  })
}

function exportedMobilePdfResult(
  fileName: PdfFileName,
  nativeResult: MobilePdfExporterResult,
): Extract<MobilePdfExportResult, { ok: true }> {
  if (typeof nativeResult === 'string') return { fileName, ok: true, shared: false, uri: nativeResult }
  if (nativeResult && typeof nativeResult === 'object') {
    return {
      fileName,
      ok: true,
      shared: nativeResult.shared === true,
      uri: nativeResult.uri ?? null,
    }
  }

  return { fileName, ok: true, shared: false, uri: null }
}

function mobilePdfHtmlDocument({
  bodyHtml,
  title,
}: {
  bodyHtml: HtmlBody
  title: NoteTitle
}): HtmlDocument {
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${mobilePdfDocumentStyles}</style>`,
    '</head>',
    '<body>',
    `<main>${bodyHtml || '<p></p>'}</main>`,
    '</body>',
    '</html>',
  ].join('')
}

function mobilePdfFileNameForNote(note: MobileNote): PdfFileName {
  const stem = note.path ? fileNameStem(note.path) : note.title
  return `${safeFileNameStem(stem || note.id || 'note')}.pdf`
}

function fileNameStem(path: FilePath): FileNameStem {
  const fileName = path.split('/').at(-1) ?? path
  return fileName.replace(/\.(?:md|markdown)$/iu, '')
}

function safeFileNameStem(value: FileNameStem): FileNameStem {
  const stem = value
    .split('')
    .map((character) => isUnsafeFileNameCharacter(character) ? ' ' : character)
    .join('')
    .replace(/\s+/gu, ' ')
    .trim()
  return (stem || 'note').slice(0, 96)
}

function isUnsafeFileNameCharacter(character: FileNameCharacter): boolean {
  return character.charCodeAt(0) < 32 || /[<>:"/\\|?*]/u.test(character)
}

function isBrowserRuntime(): boolean {
  return typeof document !== 'undefined'
}

function exportEvidence(payload: MobilePdfExportPayload) {
  return {
    fileName: payload.fileName,
    noteId: payload.noteId,
    title: payload.title,
  }
}

function recordGlobalValue(key: GlobalEvidenceKey, value: unknown) {
  const target = globalThis as Record<string, unknown>
  const current = target[key]
  const values = Array.isArray(current) ? current : []
  values.push(value)
  target[key] = values
}

function escapeHtml(value: NoteTitle): HtmlBody {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
}

const mobilePdfDocumentStyles = `
body {
  color: #2f302f;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 15px;
  line-height: 1.55;
  margin: 40px;
}
main {
  margin: 0 auto;
  max-width: 760px;
}
h1 {
  border-bottom: 1px solid #e8e5e1;
  font-size: 32px;
  line-height: 1.18;
  margin: 0 0 24px;
  padding-bottom: 16px;
}
h2 {
  font-size: 22px;
  margin: 32px 0 12px;
}
h3 {
  font-size: 18px;
  margin: 24px 0 8px;
}
p,
ul,
ol,
blockquote,
pre,
table {
  margin: 0 0 16px;
}
blockquote {
  border-left: 3px solid #2f6fed;
  color: #6f6f6a;
  padding-left: 14px;
}
code {
  background: #f4f1ec;
  border-radius: 4px;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 0.9em;
  padding: 1px 4px;
}
pre {
  background: #f7f4ee;
  border-radius: 8px;
  overflow-wrap: anywhere;
  padding: 12px;
  white-space: pre-wrap;
}
pre code {
  background: transparent;
  padding: 0;
}
table {
  border-collapse: collapse;
  width: 100%;
}
td,
th {
  border: 1px solid #e8e5e1;
  padding: 8px 10px;
  text-align: left;
}
a {
  color: #2f6fed;
}
`
