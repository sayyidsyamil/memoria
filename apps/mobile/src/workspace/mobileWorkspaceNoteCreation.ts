import { cleanTypeName, deriveEditableNote, type EditableNoteInput } from './mobileEditableNote'
import type { LocalVaultFrontmatter } from './localVaultFrontmatter'
import type { MobileCreateNoteDefaults, MobileWorkspaceSnapshot } from './mobileWorkspaceModel'
import { mobileCreateNotePathTitle } from './mobileCreateNoteTitles'
import { normalizedMobileFolderPath } from './mobileWorkspaceFolders'
import { uniqueMobileNotePath } from './mobileNotePaths'
import type { FrontmatterKey, MarkdownContent, NoteId, NoteTitle, FolderPath, WikilinkRef, MobileWorkspaceEditResult } from './mobileWorkspaceEditing.types'
import { rebuildSnapshot, workspaceNotePool, createNoteWrites } from './mobileWorkspaceSnapshotEdits'
import { mergeFrontmatter, addFrontmatterValue, serializeDocument, slugifyTitle, absoluteDate } from './mobileWorkspaceNoteContent'

type NewNoteFallback = {
  defaults: MobileCreateNoteDefaults
  id: NoteId
  now: number
  pathTitle: NoteTitle
  rawContent: MarkdownContent
  snapshot: MobileWorkspaceSnapshot
  type: NoteTitle
}

export function createMobileNote(
  snapshot: MobileWorkspaceSnapshot,
  title: NoteTitle,
  defaults: MobileCreateNoteDefaults = {},
): MobileWorkspaceSnapshot {
  const trimmedTitle = title.trim()

  const notePool = workspaceNotePool(snapshot)
  const type = cleanTypeName(defaults.type ?? 'Note') || 'Note'
  const now = Date.now()
  const pathTitle = mobileCreateNotePathTitle({ now, title: trimmedTitle, type })
  const basePath = createNotePath(pathTitle, defaults.folderPath)
  const id = uniqueMobileNotePath(notePool, basePath)
  if (id !== basePath && trimmedTitle) return snapshot

  const rawContent = createNoteRawContent(trimmedTitle, type, defaults)
  const note = deriveEditableNote({
    fallback: createNoteFallback({ defaults, id, now, pathTitle, rawContent, snapshot, type }),
    rawContent,
    typeDefinitions: snapshot.typeDefinitions,
  }).note

  return rebuildSnapshot(
    { ...snapshot, selectedNoteId: id },
    [note, ...snapshot.notes],
    [note, ...notePool],
  )
}

function createNoteFallback({ defaults, id, now, pathTitle, rawContent, snapshot, type }: NewNoteFallback): EditableNoteInput {
  return {
    created: '0m ago',
    date: absoluteDate(now),
    favorite: defaults.favorite === true,
    id,
    icon: null,
    links: 0,
    modified: '0m ago',
    outgoingLinks: [],
    path: id,
    rawContent,
    relationships: [],
    status: defaults.status ?? '',
    snippet: '',
    tags: defaults.tags ?? [],
    title: pathTitle,
    type,
    typeTone: 'gray',
    workspace: snapshot.source?.label ?? 'Memoria Vault',
    workspaceAlias: workspaceAliasForNewNote(snapshot),
  }
}

function workspaceAliasForNewNote(snapshot: MobileWorkspaceSnapshot) {
  return snapshot.source?.kind === 'localVault'
    ? snapshot.source.alias ?? snapshot.notes[0]?.workspaceAlias ?? null
    : null
}

export function createMobileNoteResult(
  snapshot: MobileWorkspaceSnapshot,
  title: NoteTitle,
  defaults?: MobileCreateNoteDefaults,
): MobileWorkspaceEditResult {
  const nextSnapshot = createMobileNote(snapshot, title, defaults)
  if (nextSnapshot === snapshot) return { snapshot, writes: [] }
  return { snapshot: nextSnapshot, writes: createNoteWrites(nextSnapshot) }
}

export function createNotePath(title: NoteTitle, folderPath: FolderPath | undefined): NoteId {
  const filename = `${slugifyTitle(title)}.md`
  const folder = folderPath ? normalizedMobileFolderPath(folderPath) : ''
  return folder ? `${folder}/${filename}` : filename
}

export function createNoteRawContent(
  title: NoteTitle,
  type: NoteTitle,
  defaults: MobileCreateNoteDefaults,
): MarkdownContent {
  return serializeDocument(createNoteFrontmatter(title, type, defaults), createNoteBody(title, defaults.template))
}

export function createNoteBody(title: NoteTitle, template?: MarkdownContent): MarkdownContent {
  if (title) return template ? `\n${template}` : ''
  if (template?.trimStart().startsWith('# ') ?? false) return `\n${template}`
  return template ? `\n# \n\n${template}` : '\n# \n\n'
}

export function createNoteFrontmatter(
  title: NoteTitle,
  type: NoteTitle,
  defaults: MobileCreateNoteDefaults,
): LocalVaultFrontmatter {
  const frontmatter: LocalVaultFrontmatter = {}

  addFrontmatterValue(frontmatter, 'title', title)
  addFrontmatterValue(frontmatter, 'type', type)
  addFrontmatterValue(frontmatter, 'status', defaults.status)
  addFrontmatterValue(frontmatter, 'tags', defaults.tags && defaults.tags.length > 0 ? defaults.tags : undefined)
  addFrontmatterValue(frontmatter, '_favorite', defaults.favorite === true ? true : undefined)
  addFrontmatterValue(frontmatter, '_archived', defaults.archived === true ? true : undefined)
  addFrontmatterValue(frontmatter, '_organized', defaults.organized === true ? true : undefined)
  mergeFrontmatter(frontmatter, defaults.properties ?? {})
  mergeRelationshipDefaultFrontmatter(frontmatter, defaults.relationships ?? {})

  return frontmatter
}

export function mergeRelationshipDefaultFrontmatter(
  frontmatter: LocalVaultFrontmatter,
  relationships: Record<FrontmatterKey, WikilinkRef[]>,
) {
  for (const [key, refs] of Object.entries(relationships)) {
    const value = refs.length === 0 ? undefined : refs.length === 1 ? refs[0] : refs
    addFrontmatterValue(frontmatter, key, value)
  }
}
