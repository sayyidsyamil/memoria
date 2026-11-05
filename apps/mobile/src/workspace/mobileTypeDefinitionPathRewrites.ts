import type {
  MobileTypeDefinition,
  MobileTypeDefinitions,
} from './mobileWorkspaceModel'
import { mobileTypeDefinitionPath } from './mobileTypeDefinitions'
import {
  rewriteMovedWikilinkContent,
  type MovedNoteWikilinkRewrite,
} from './mobileWorkspacePathRewrites'

type MarkdownContent = string
type SaveNoteWriteCandidate = {
  kind: string
  path?: string
}
type TypeRelationshipRefs = Record<string, string[]>

export type MobileTypeDefinitionRewriteWrite = {
  content: MarkdownContent
  kind: 'saveNote'
  path: string
}

export function rewriteMobileTypeDefinitionWikilinks(
  typeDefinitions: MobileTypeDefinitions | undefined,
  rewrites: MovedNoteWikilinkRewrite[],
): MobileTypeDefinitions | undefined {
  if (!typeDefinitions || rewrites.length === 0) return typeDefinitions

  let changed = false
  const nextDefinitions = Object.fromEntries(
    Object.entries(typeDefinitions).map(([typeName, definition]) => {
      const nextDefinition = rewriteTypeDefinitionWikilinks(definition, rewrites)
      changed = changed || nextDefinition !== definition
      return [typeName, nextDefinition]
    }),
  )

  return changed ? nextDefinitions : typeDefinitions
}

export function mobileTypeDefinitionWikilinkWrites(
  previousDefinitions: MobileTypeDefinitions | undefined,
  nextDefinitions: MobileTypeDefinitions | undefined,
  skippedPaths = new Set<string>(),
): MobileTypeDefinitionRewriteWrite[] {
  if (!previousDefinitions || !nextDefinitions || previousDefinitions === nextDefinitions) return []

  return Object.entries(nextDefinitions).flatMap(([typeName, definition]) => {
    const rawContent = definition.rawContent
    if (rawContent === undefined || previousDefinitions[typeName]?.rawContent === rawContent) return []

    const path = mobileTypeDefinitionPath(typeName, definition)
    if (skippedPaths.has(path)) return []

    return [{ content: rawContent, kind: 'saveNote', path }]
  })
}

export function mobileTypeDefinitionWikilinkWritesForWorkspaceWrites(
  previousDefinitions: MobileTypeDefinitions | undefined,
  nextDefinitions: MobileTypeDefinitions | undefined,
  writes: SaveNoteWriteCandidate[],
): MobileTypeDefinitionRewriteWrite[] {
  return mobileTypeDefinitionWikilinkWrites(
    previousDefinitions,
    nextDefinitions,
    saveNoteWritePaths(writes),
  )
}

function rewriteTypeDefinitionWikilinks(
  definition: MobileTypeDefinition,
  rewrites: MovedNoteWikilinkRewrite[],
): MobileTypeDefinition {
  const rawContent = definition.rawContent === undefined
    ? undefined
    : rewrites.reduce(rewriteMovedWikilinkContent, definition.rawContent)
  const relationships = rewriteTypeDefinitionRelationships(definition.relationships, rewrites)

  if (rawContent === definition.rawContent && relationships === definition.relationships) return definition

  return {
    ...definition,
    rawContent,
    relationships,
  }
}

function rewriteTypeDefinitionRelationships(
  relationships: TypeRelationshipRefs | undefined,
  rewrites: MovedNoteWikilinkRewrite[],
): TypeRelationshipRefs | undefined {
  if (!relationships) return relationships

  let changed = false
  const nextRelationships = Object.fromEntries(
    Object.entries(relationships).map(([key, refs]) => {
      const nextRefs = rewriteWikilinkRefs(refs, rewrites)
      changed = changed || nextRefs !== refs
      return [key, nextRefs]
    }),
  )

  return changed ? nextRelationships : relationships
}

function rewriteWikilinkRefs(
  refs: string[],
  rewrites: MovedNoteWikilinkRewrite[],
): string[] {
  const nextRefs = refs.map((ref) => rewrites.reduce(rewriteMovedWikilinkContent, ref))
  return sameStringList(refs, nextRefs) ? refs : nextRefs
}

function sameStringList(previous: string[], next: string[]): boolean {
  return previous.length === next.length && previous.every((value, index) => value === next[index])
}

function saveNoteWritePaths(writes: SaveNoteWriteCandidate[]): Set<string> {
  return new Set(writes.flatMap(saveNoteWritePath))
}

function saveNoteWritePath(write: SaveNoteWriteCandidate): string[] {
  return write.kind === 'saveNote' && write.path ? [write.path] : []
}
