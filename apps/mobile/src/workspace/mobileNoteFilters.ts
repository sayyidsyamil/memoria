import type { MobileAllNotesFileVisibility, MobileNote } from './mobileWorkspaceModel'

export type MobileNoteListFilter = 'archived' | 'open'

type MobileMarkdownCandidate = Pick<MobileNote, 'fileKind'>
type MobileAllNotesCandidate = Pick<MobileNote, 'fileKind' | 'id' | 'path' | 'title'>
type MobileInboxCandidate = Pick<MobileNote, 'archived' | 'fileKind' | 'organized' | 'type'>
type MobileFilePreviewKind = 'image' | 'pdf'

const attachmentsFolder = 'attachments'
const imagePreviewExtensions = new Set([
  'apng',
  'avif',
  'bmp',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'tif',
  'tiff',
  'webp',
])
const pdfPreviewExtensions = new Set(['pdf'])

export const DEFAULT_MOBILE_ALL_NOTES_FILE_VISIBILITY: MobileAllNotesFileVisibility = {
  images: false,
  pdfs: false,
  unsupported: false,
}

export function isMobileMarkdownNote(note: MobileMarkdownCandidate): boolean {
  return (note.fileKind ?? 'markdown') === 'markdown'
}

export function isMobileAllNotesEntry(
  note: MobileAllNotesCandidate,
  visibility: MobileAllNotesFileVisibility = DEFAULT_MOBILE_ALL_NOTES_FILE_VISIBILITY,
): boolean {
  if (isMobileMarkdownNote(note)) return !mobileNotePathIsInsideFolder(notePath(note), attachmentsFolder)

  return isOptionalMobileAllNotesFileVisible(note, visibility)
}

export function isMobileInboxNote(note: MobileInboxCandidate): boolean {
  return isMobileMarkdownNote(note) && !note.archived && !note.organized && note.type !== 'Type'
}

function isOptionalMobileAllNotesFileVisible(
  note: MobileAllNotesCandidate,
  visibility: MobileAllNotesFileVisibility,
): boolean {
  const previewKind = mobileFilePreviewKind(note)
  if (previewKind === 'pdf') return visibility.pdfs
  if (previewKind === 'image') return visibility.images
  return visibility.unsupported
}

export function mobileFilePreviewKind(note: MobileAllNotesCandidate): MobileFilePreviewKind | null {
  if (note.fileKind && note.fileKind !== 'binary') return null

  const extension = extensionFromPath(note.path ?? note.id) ?? extensionFromPath(note.title)
  if (!extension) return null
  return previewKindForExtension(extension)
}

function previewKindForExtension(extension: string): MobileFilePreviewKind | null {
  if (imagePreviewExtensions.has(extension)) return 'image'
  if (pdfPreviewExtensions.has(extension)) return 'pdf'
  return null
}

function extensionFromPath(path: string): string | null {
  const lastSegment = path.split(/[\\/]/u).pop() ?? path
  const dotIndex = lastSegment.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === lastSegment.length - 1) return null
  return lastSegment.slice(dotIndex + 1).toLowerCase()
}

function notePath(note: Pick<MobileNote, 'id' | 'path'>): string {
  return note.path ?? note.id
}

function mobileNotePathIsInsideFolder(path: string, folder: string): boolean {
  const normalizedPath = normalizePath(path)
  const normalizedFolder = normalizePath(folder)
  return normalizedPath.startsWith(`${normalizedFolder}/`) || normalizedPath.includes(`/${normalizedFolder}/`)
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '').toLowerCase()
}
