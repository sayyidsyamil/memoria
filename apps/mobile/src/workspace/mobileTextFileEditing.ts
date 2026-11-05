import type { MobileNote } from './mobileWorkspaceModel'
import { isMobileMarkdownActionNote, mobileNoteActionMode } from './mobileNoteActionMode'

type TextFileContent = string

export type MobileTextFileContentEditInput =
  | { rawContent: TextFileContent; type: 'hydrateTextFileContent' }
  | { content: TextFileContent; type: 'updateTextFileContent' }

const textFileSnippetMaxLength = 140

export function applyMobileTextFileContentEdit(
  note: MobileNote,
  edit: MobileTextFileContentEditInput,
): MobileNote {
  if (mobileNoteActionMode(note) !== 'text-file') return note
  const rawContent = edit.type === 'hydrateTextFileContent' ? edit.rawContent : edit.content
  return mobileTextFileNoteWithContent(note, rawContent)
}

export function canApplyMobileMarkdownEdit(note: Pick<MobileNote, 'fileKind'>): boolean {
  return isMobileMarkdownActionNote(note)
}

export function isMobileTextFileContentEdit(edit: { type: string }): edit is MobileTextFileContentEditInput {
  return edit.type === 'hydrateTextFileContent' || edit.type === 'updateTextFileContent'
}

export function mobileTextFileNoteWithContent(note: MobileNote, rawContent: TextFileContent): MobileNote {
  return {
    ...note,
    editorBlocks: undefined,
    editorBullets: undefined,
    links: 0,
    outgoingLinks: [],
    properties: [],
    rawContent,
    relationships: [],
    snippet: textFileSnippet(rawContent),
    status: '',
    tags: [],
    type: 'File',
  }
}

function textFileSnippet(rawContent: TextFileContent): string {
  const firstLine = rawContent.split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? ''
  if (firstLine.length <= textFileSnippetMaxLength) return firstLine
  return `${firstLine.slice(0, textFileSnippetMaxLength - 3)}...`
}
