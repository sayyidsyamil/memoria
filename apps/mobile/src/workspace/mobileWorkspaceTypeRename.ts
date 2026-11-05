import {
  parseLocalVaultDocument,
} from './localVaultFrontmatter'
import {
  mobileTypeDefinitionContent,
  mobileTypeDefinitionPath,
} from './mobileTypeDefinitions'
import {
  serializeMobileLocalVaultDocument,
  writeMobileFrontmatterContentValue,
} from './mobileFrontmatterWrites'
import type { MobileWorkspaceEdit, MobileWorkspaceEditResult, MobileWorkspaceWrite } from './mobileWorkspaceEditing'
import {
  mobileTypeDefinitionWikilinkWritesForWorkspaceWrites,
  rewriteMobileTypeDefinitionWikilinks,
} from './mobileTypeDefinitionPathRewrites'
import type {
  MobileNote,
  MobileTypeDefinition,
  MobileTypeDefinitions,
  MobileWorkspaceSnapshot,
} from './mobileWorkspaceModel'
import {
  noteWithWritePath,
  noteWritePath,
  movedNoteWikilinkRewrite,
  rewriteMovedNoteWikilinks,
  type MovedNoteWikilinkRewrite,
} from './mobileWorkspacePathRewrites'

type RenameTypeEdit = Extract<MobileWorkspaceEdit, { type: 'renameTypeDefinition' }>
type MarkdownContent = string
type TypeName = string
type TypeNameInput = string
type RebuildMobileWorkspaceSnapshot = (
  snapshot: MobileWorkspaceSnapshot,
  notes: MobileNote[],
  allNotes?: MobileNote[],
) => MobileWorkspaceSnapshot
type TypeRenameContext = {
  nextTypeName: TypeName
  sourceDefinition: MobileTypeDefinition
  sourceTypeName: TypeName
}
type TypeRenameWithDefinitions = TypeRenameContext & {
  rewrite: MovedNoteWikilinkRewrite
  typeDefinitions: MobileTypeDefinitions
}

const defaultTypeCanonicalCase = new Map([
  ['event', 'Event'],
  ['note', 'Note'],
  ['person', 'Person'],
  ['project', 'Project'],
])
const typeRenameAliases = new Map([['notes', 'Note']])

export function renameMobileTypeDefinition(
  snapshot: MobileWorkspaceSnapshot,
  edit: RenameTypeEdit,
  rebuildSnapshot: RebuildMobileWorkspaceSnapshot,
): MobileWorkspaceEditResult {
  const renameContext = typeRenameContext(snapshot, edit)
  if (!renameContext) return { snapshot, writes: [] }

  const baseRenamedDefinition = renamedMobileTypeDefinition(renameContext)
  const rewrite = typeDocumentWikilinkRewrite(renameContext, baseRenamedDefinition)
  const typeDefinitions = rewrittenRenamedTypeDefinitions(snapshot.typeDefinitions, {
    definition: baseRenamedDefinition,
    rewrite,
    ...renameContext,
  })
  const renamedDefinition = typeDefinitions[renameContext.nextTypeName] ?? baseRenamedDefinition
  const renameWithDefinitions = { ...renameContext, rewrite, typeDefinitions }
  const notes = renameTypeInNotes(snapshot.notes, renameWithDefinitions)
  const allNotes = snapshot.allNotes
    ? notesWithDetailedNotes(renameTypeInNotes(snapshot.allNotes, renameWithDefinitions), notes)
    : undefined

  return {
    snapshot: rebuildSnapshot({ ...snapshot, typeDefinitions }, notes, allNotes),
    writes: renameTypeWrites(snapshot, {
      notes: allNotes ?? notes,
      renamedDefinition,
      typeDefinitions,
      ...renameContext,
    }),
  }
}

export function canRenameMobileTypeDefinition(
  definitions: MobileTypeDefinitions | undefined,
  sourceTypeName: TypeNameInput,
  nextTypeName: TypeNameInput,
): boolean {
  const sourceName = existingTypeDefinitionName(definitions, sourceTypeName)
  const normalizedNextTypeName = normalizeRenameTypeName(nextTypeName)
  if (!sourceName || !normalizedNextTypeName || sourceName === normalizedNextTypeName) return true

  return !conflictingTargetTypeName(definitions, {
    nextTypeName: normalizedNextTypeName,
    sourceTypeName: sourceName,
  })
}

export function mobileTypeRenameTargetName(value: TypeNameInput): TypeName {
  return normalizeRenameTypeName(value)
}

function typeRenameContext(
  snapshot: MobileWorkspaceSnapshot,
  edit: RenameTypeEdit,
): TypeRenameContext | null {
  const sourceTypeName = existingTypeDefinitionName(snapshot.typeDefinitions, edit.typeName)
  const nextTypeName = normalizeRenameTypeName(edit.nextTypeName)
  if (!sourceTypeName || !nextTypeName || sourceTypeName === nextTypeName) return null
  if (conflictingTargetTypeName(snapshot.typeDefinitions, { nextTypeName, sourceTypeName })) return null

  const sourceDefinition = snapshot.typeDefinitions?.[sourceTypeName]
  if (!sourceDefinition) return null

  const context = { nextTypeName, sourceDefinition, sourceTypeName }
  return typeRenameTargetPathExists(snapshot, context) ? null : context
}

function conflictingTargetTypeName(
  definitions: MobileTypeDefinitions | undefined,
  rename: Pick<TypeRenameContext, 'nextTypeName' | 'sourceTypeName'>,
): boolean {
  const targetTypeName = existingTypeDefinitionName(definitions, rename.nextTypeName)
  return Boolean(targetTypeName && targetTypeName !== rename.sourceTypeName)
}

function typeRenameTargetPathExists(
  snapshot: MobileWorkspaceSnapshot,
  rename: TypeRenameContext,
): boolean {
  const sourcePath = canonicalMobilePath(mobileTypeDefinitionPath(rename.sourceTypeName, rename.sourceDefinition))
  const targetPath = canonicalMobilePath(mobileTypeDefinitionPath(rename.nextTypeName, undefined))

  return typeRenamePathCandidates(snapshot).some((candidate) => {
    const candidatePath = canonicalMobilePath(candidate)
    return candidatePath === targetPath && candidatePath !== sourcePath
  })
}

function typeRenamePathCandidates(snapshot: MobileWorkspaceSnapshot): string[] {
  return [
    ...workspaceNotePoolWithDetails(snapshot).flatMap((note) => [
      note.id,
      note.path ?? '',
      noteWritePath(note),
    ]),
    ...Object.values(snapshot.typeDefinitions ?? {}).flatMap((definition) => (
      definition.path ? [definition.path] : []
    )),
  ]
}

function canonicalMobilePath(path: string): string {
  return path.replaceAll('\\', '/').split('/').filter(Boolean).join('/').toLowerCase()
}

function renamedMobileTypeDefinition(rename: TypeRenameContext): MobileTypeDefinition {
  const rawContent = renamedTypeContent(
    mobileTypeDefinitionContent(rename.nextTypeName, rename.sourceDefinition, { label: null }),
    rename.nextTypeName,
  )

  return {
    ...rename.sourceDefinition,
    label: null,
    path: mobileTypeDefinitionPath(rename.nextTypeName, undefined),
    rawContent,
  }
}

function renamedTypeDefinitions(
  definitions: MobileTypeDefinitions | undefined,
  rename: {
    definition: MobileTypeDefinition
    nextTypeName: string
    sourceTypeName: string
  },
): MobileTypeDefinitions {
  const nextDefinitions = { ...(definitions ?? {}) }
  Reflect.deleteProperty(nextDefinitions, rename.sourceTypeName)
  nextDefinitions[rename.nextTypeName] = rename.definition
  return nextDefinitions
}

function rewrittenRenamedTypeDefinitions(
  definitions: MobileTypeDefinitions | undefined,
  rename: {
    definition: MobileTypeDefinition
    nextTypeName: string
    rewrite: MovedNoteWikilinkRewrite
    sourceTypeName: string
  },
): MobileTypeDefinitions {
  const nextDefinitions = renamedTypeDefinitions(definitions, rename)
  return rewriteMobileTypeDefinitionWikilinks(nextDefinitions, [rename.rewrite]) ?? nextDefinitions
}

function renameTypeInNotes(
  notes: MobileNote[],
  rename: TypeRenameWithDefinitions,
): MobileNote[] {
  return notes.map((note) => {
    if (isTypeDocumentNote(note, rename)) {
      return noteWithRenamedTypeDocument(note, rename)
    }

    const renamedNote = note.type === rename.sourceTypeName
      ? noteWithRenamedAssignedType(note, rename)
      : note
    return rewriteMovedNoteWikilinks(renamedNote, rename.rewrite)
  })
}

function noteWithRenamedTypeDocument(
  note: MobileNote,
  rename: TypeRenameWithDefinitions,
): MobileNote {
  const definition = rename.typeDefinitions[rename.nextTypeName]
  const nextNote = noteWithWritePath(note, mobileTypeDefinitionPath(rename.nextTypeName, definition))

  return {
    ...nextNote,
    rawContent: definition?.rawContent ?? nextNote.rawContent,
    title: rename.nextTypeName,
  }
}

function noteWithRenamedAssignedType(
  note: MobileNote,
  rename: TypeRenameWithDefinitions,
): MobileNote {
  const rawContent = note.rawContent === undefined
    ? undefined
    : writeMobileFrontmatterContentValue(note.rawContent, 'type', rename.nextTypeName)

  return {
    ...note,
    rawContent,
    type: rename.nextTypeName,
    typeTone: rename.typeDefinitions[rename.nextTypeName]?.tone ?? note.typeTone,
  }
}

function renameTypeWrites(
  snapshot: MobileWorkspaceSnapshot,
  rename: TypeRenameContext & {
    notes: MobileNote[]
    renamedDefinition: MobileTypeDefinition
    typeDefinitions: MobileTypeDefinitions
  },
): MobileWorkspaceWrite[] {
  const workspaceWrites = [
    ...moveTypeDocumentWrite(rename),
    ...saveTypeDocumentWrite(rename),
    ...saveChangedNoteWrites(snapshot, rename),
  ]

  return [
    ...workspaceWrites,
    ...mobileTypeDefinitionWikilinkWritesForWorkspaceWrites(
      snapshot.typeDefinitions,
      rename.typeDefinitions,
      workspaceWrites,
    ),
  ]
}

function moveTypeDocumentWrite(rename: {
  nextTypeName: string
  renamedDefinition: MobileTypeDefinition
  sourceDefinition: MobileTypeDefinition
  sourceTypeName: string
}): MobileWorkspaceWrite[] {
  const previousPath = mobileTypeDefinitionPath(rename.sourceTypeName, rename.sourceDefinition)
  const nextPath = mobileTypeDefinitionPath(rename.nextTypeName, rename.renamedDefinition)
  return previousPath === nextPath ? [] : [{ kind: 'moveNote', path: previousPath, toPath: nextPath }]
}

function saveTypeDocumentWrite(rename: {
  nextTypeName: string
  renamedDefinition: MobileTypeDefinition
  sourceDefinition: MobileTypeDefinition
}): MobileWorkspaceWrite[] {
  const rawContent = rename.renamedDefinition.rawContent
  if (!rawContent || rawContent === rename.sourceDefinition.rawContent) return []

  return [{
    content: rawContent,
    kind: 'saveNote',
    path: mobileTypeDefinitionPath(rename.nextTypeName, rename.renamedDefinition),
  }]
}

function saveChangedNoteWrites(
  snapshot: MobileWorkspaceSnapshot,
  rename: {
    notes: MobileNote[]
  },
): MobileWorkspaceWrite[] {
  const previousByPath = new Map(workspaceNotePoolWithDetails(snapshot).map((note) => [noteWritePath(note), note]))

  return rename.notes.flatMap((note) => {
    const previousNote = previousByPath.get(noteWritePath(note))
    if (!previousNote) return []
    if (previousNote.rawContent === undefined || note.rawContent === undefined) return []
    if (previousNote.rawContent === note.rawContent) return []

    return [{
      content: note.rawContent,
      kind: 'saveNote' as const,
      path: noteWritePath(note),
    }]
  })
}

function workspaceNotePoolWithDetails(snapshot: MobileWorkspaceSnapshot): MobileNote[] {
  return snapshot.allNotes
    ? notesWithDetailedNotes(snapshot.allNotes, snapshot.notes)
    : snapshot.notes
}

function notesWithDetailedNotes(notes: MobileNote[], detailedNotes: MobileNote[]): MobileNote[] {
  const detailedById = new Map(detailedNotes.map((note) => [note.id, note]))
  return notes.map((note) => detailedById.get(note.id) ?? note)
}

function typeDocumentWikilinkRewrite(
  rename: TypeRenameContext,
  renamedDefinition: MobileTypeDefinition,
): MovedNoteWikilinkRewrite {
  return movedNoteWikilinkRewrite(
    typeDocumentRewriteNote(rename.sourceTypeName, rename.sourceDefinition),
    typeDocumentRewriteNote(rename.nextTypeName, renamedDefinition),
  )
}

function typeDocumentRewriteNote(typeName: TypeName, definition: MobileTypeDefinition): MobileNote {
  const path = mobileTypeDefinitionPath(typeName, definition)

  return {
    created: '',
    date: '',
    favorite: false,
    id: path,
    links: 0,
    modified: '',
    path,
    rawContent: definition.rawContent,
    relationships: [],
    snippet: '',
    status: '',
    tags: [],
    title: typeName,
    type: 'Type',
    typeTone: definition.tone ?? 'gray',
    workspace: '',
  }
}

function isTypeDocumentNote(
  note: MobileNote,
  rename: TypeRenameContext,
): boolean {
  return note.type === 'Type'
    && (
      note.title === rename.sourceTypeName
      || noteWritePath(note) === mobileTypeDefinitionPath(rename.sourceTypeName, rename.sourceDefinition)
    )
}

function renamedTypeContent(content: MarkdownContent, nextTypeName: TypeName): MarkdownContent {
  const document = parseLocalVaultDocument(content)
  return serializeMobileLocalVaultDocument(
    document.frontmatter,
    bodyWithRenamedFirstHeading(document.body, nextTypeName),
  )
}

function bodyWithRenamedFirstHeading(body: MarkdownContent, nextTypeName: TypeName): MarkdownContent {
  const lines = body.split('\n')
  const headingIndex = lines.findIndex((line) => line.trim().length > 0)
  if (headingIndex === -1) return `# ${nextTypeName}\n`

  const firstLine = lines[headingIndex]
  if (!firstLine.startsWith('# ')) return `# ${nextTypeName}\n\n${body}`

  return [
    ...lines.slice(0, headingIndex),
    `# ${nextTypeName}`,
    ...lines.slice(headingIndex + 1),
  ].join('\n')
}

function existingTypeDefinitionName(
  definitions: MobileTypeDefinitions | undefined,
  typeName: TypeNameInput,
): TypeName | null {
  const cleanType = cleanTypeName(typeName)
  const typeSlug = slugifyTypeName(cleanType)
  return Object.keys(definitions ?? {}).find((candidate) => (
    candidate === cleanType || slugifyTypeName(candidate) === typeSlug
  )) ?? null
}

function normalizeRenameTypeName(value: TypeNameInput): TypeName {
  const cleanType = cleanTypeName(value)
  const lowerType = cleanType.toLowerCase()
  return typeRenameAliases.get(lowerType) ?? defaultTypeCanonicalCase.get(lowerType) ?? cleanType
}

function cleanTypeName(value: TypeNameInput): TypeName {
  return wikilinkTarget(value).replace(/\.md$/, '')
}

function slugifyTypeName(value: TypeName): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"]/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '') || 'type'
}

function wikilinkTarget(value: TypeNameInput): string {
  const match = value.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/)
  return (match?.[1] ?? value).trim()
}
