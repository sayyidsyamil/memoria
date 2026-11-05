import { invoke } from '@tauri-apps/api/core'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api'

export interface PreparedSource {
  id: string
  filename: string
  title: string
  sha256: string
  bytes: Uint8Array
  pages: string[]
  originalPath?: string
  importedAt?: string
}

const MAX_ATTACHMENT_NAME_BYTES = 150

// The vault prefixes a 13-digit timestamp to the attachment name; macOS limits one name to 255 bytes.
export function attachmentFilename(name: string): string {
  const encoder = new TextEncoder()
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot) : ''
  let base = dot > 0 ? name.slice(0, dot) : name
  if (encoder.encode(base).length <= MAX_ATTACHMENT_NAME_BYTES) return name
  while (encoder.encode(base).length > MAX_ATTACHMENT_NAME_BYTES) base = Array.from(base).slice(0, -1).join('')
  return `${base}${extension}`
}

function decodeText(bytes: Uint8Array): string {
  const label = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8'
  try { return new TextDecoder(label, { fatal: true }).decode(bytes) }
  catch { throw new Error('This text file is not valid UTF-8. Re-save it as UTF-8 and import it again.') }
}

export async function prepareSource(file: File): Promise<PreparedSource> {
  if (!/\.(pdf|txt|md|vtt|srt)$/i.test(file.name)) throw new Error('Choose a PDF, text, Markdown, VTT, or SRT file.')
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose a file smaller than 20 MB.')
  const buffer = await file.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  const sha256 = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
  const bytes = new Uint8Array(buffer)
  const pages: string[] = []
  if (/\.pdf$/i.test(file.name)) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    const task = pdfjs.getDocument({ data: bytes.slice() })
    const document = await task.promise
    try {
      for (let number = 1; number <= document.numPages; number++) {
        const page = await document.getPage(number)
        // WKWebView lacks ReadableStream's async iterator on some supported
        // macOS versions. PDF.js getTextContent uses `for await` internally;
        // consume its public text stream through the widely supported reader.
        const reader = page.streamTextContent().getReader()
        const chunks: string[] = []
        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            chunks.push(...value.items.map((item: TextItem | TextMarkedContent) => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
          }
        } finally { reader.releaseLock() }
        pages.push(chunks.join('').trim())
      }
    } finally { await task.destroy() }
  } else pages.push(decodeText(bytes))
  if (!pages.some(page => page.trim())) throw new Error(/\.pdf$/i.test(file.name) ? 'No readable text found. Scanned PDFs need OCR, which is not connected yet.' : 'This file has no readable text.')
  return { id: crypto.randomUUID(), filename: file.name, title: file.name.replace(/\.[^.]+$/, ''), sha256, bytes, pages }
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(binary)
}

export async function applySource(source: PreparedSource, vaultPath: string, checkpoint?: () => Promise<void>): Promise<string> {
  const original = source.originalPath ?? await invoke<string>('save_image', { vaultPath, filename: attachmentFilename(source.filename), data: base64(source.bytes) })
  source.originalPath = original
  source.importedAt ??= new Date().toISOString()
  await checkpoint?.()
  const relative = original.slice(vaultPath.replace(/\/$/, '').length + 1)
  const slug = source.title.normalize('NFKD').replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'source'
  const filename = `source-${slug}-${source.id}.md`
  const content = [
    '---', 'type: Source', '_organized: true', `title: ${JSON.stringify(source.title)}`,
    `source_filename: ${JSON.stringify(source.filename)}`, `sha256: ${source.sha256}`,
    'extraction: text-only', `imported_at: ${JSON.stringify(source.importedAt)}`, '---',
    `# ${source.title.replace(/[\r\n]/g, ' ')}`, '',
    `[Open original](<${relative}>)`, '',
    ...source.pages.flatMap((page, index) => [`## Page ${index + 1}`, '', page, '']),
  ].join('\n')
  try {
    await invoke('create_note_content', { vaultPath, path: `${vaultPath}/${filename}`, content })
  } catch (error) {
    // A restart can happen after the file was committed but before the receipt.
    // Only accept that retry when the existing file is byte-for-byte identical.
    const existing = await invoke<string>('get_note_content', { path: `${vaultPath}/${filename}`, vaultPath }).catch(() => null)
    if (existing !== content) throw error
  }
  return filename
}
