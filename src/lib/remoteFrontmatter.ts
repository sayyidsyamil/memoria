import { assertVaultPath } from '../../packages/collab-client/src/remoteHttp'
import { patchText } from '../../packages/markdown-yjs/src/textPatch'
import { DOC_FRONTMATTER_FIELD } from '../../packages/protocol/src/index'
import { splitFrontmatter } from '../utils/wikilinks'
import { assertSafeFrontmatterEdit, type FrontmatterTextValue, updateFrontmatterContent } from './frontmatterText'
import { type LiveNoteDocument, liveNoteDocument } from './liveNoteDocuments'
import type { VaultFileOps } from './vaultBackend/types'

/**
 * Property edits on the web with a Memoria remote. A note open as a live document gets the
 * edit as one transaction on its `frontmatter` text, so it merges with concurrent edits and
 * the server writes it to the file with the body; any other note is rewritten through the
 * files API, only if it is still at the revision the edit was made on. Either way the
 * frontmatter changes exactly as the desktop writer would change it.
 */

type NotePath = string
type NoteText = string

export interface RemoteFrontmatterEdit {
  path: NotePath
  key: string
  /** `undefined` deletes the key. */
  value: FrontmatterTextValue | undefined
}

/** Transaction origin of a property edit, for observers that tell edits apart. */
export const FRONTMATTER_EDIT_ORIGIN = 'memoria:frontmatter-edit'

export class RemoteFrontmatterConflictError extends Error {
  constructor(path: NotePath) {
    super(`${path} changed on the server while its properties were being edited`)
    this.name = 'RemoteFrontmatterConflictError'
  }
}

export class NotAMarkdownNoteError extends Error {
  constructor(path: NotePath) {
    super(`Frontmatter can only be updated on Markdown notes: ${path}`)
    this.name = 'NotAMarkdownNoteError'
  }
}

/** A vault path (relative, no `.` or `..` segments) to a Markdown note, as the desktop requires. */
function assertEditableNotePath(path: NotePath): void {
  assertVaultPath(path)
  if (!/\.(md|markdown)$/i.test(path)) throw new NotAMarkdownNoteError(path)
}

function noteBody(content: NoteText): NoteText {
  return splitFrontmatter(content)[1]
}

function editDocumentFrontmatter(live: LiveNoteDocument, { key, value }: RemoteFrontmatterEdit): NoteText {
  const text = live.doc.getText(DOC_FRONTMATTER_FIELD)
  const frontmatter = updateFrontmatterContent(text.toString(), key, value)
  live.doc.transact(() => patchText(text, frontmatter), FRONTMATTER_EDIT_ORIGIN)
  return frontmatter
}

/**
 * Edits the document's frontmatter. The body of the returned content comes from the file:
 * the document holds the body as blocks, and the caller only needs the note's properties.
 * A document closed while the file was read (the note was left) leaves the edit to the file.
 */
async function editLiveFrontmatter(files: VaultFileOps, edit: RemoteFrontmatterEdit): Promise<NoteText> {
  const body = noteBody((await files.read(edit.path)).content)
  const live = liveNoteDocument(edit.path)
  if (!live) return editFileFrontmatter(files, edit)
  return `${editDocumentFrontmatter(live, edit)}${body}`
}

async function editFileFrontmatter(files: VaultFileOps, { path, key, value }: RemoteFrontmatterEdit): Promise<NoteText> {
  const file = await files.read(path)
  const content = updateFrontmatterContent(file.content, key, value)
  if (content === file.content) return content
  const result = await files.write(path, content, { baseRevision: file.revision })
  if (result.status === 'conflict') throw new RemoteFrontmatterConflictError(path)
  return content
}

/**
 * Applies a property edit and returns the note's content with it. The path, key and value
 * are checked before anything is read or written.
 */
export async function editRemoteFrontmatter(files: VaultFileOps, edit: RemoteFrontmatterEdit): Promise<NoteText> {
  assertEditableNotePath(edit.path)
  assertSafeFrontmatterEdit(edit.key, edit.value)
  return liveNoteDocument(edit.path) ? editLiveFrontmatter(files, edit) : editFileFrontmatter(files, edit)
}
