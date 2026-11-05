import { mobileNoteListMatchesQuery, normalizedMobileSearchQuery } from './mobileNoteSearch'
import { normalizeMobileWikilinkTarget, parseMobileWikilink } from './mobileWikilinks'
import type { MobileNote, MobilePropertyDisplayMode, MobileRelationship } from './mobileWorkspaceModel'

export type MobileNeighborhoodGroup = {
  id: string
  label: string
  notes: MobileNote[]
  source: MobileNeighborhoodGroupSource
}

export type MobileNeighborhoodGroupSource = 'backlinks' | 'direct' | 'instances' | 'inverse'

export type MobileNeighborhood = {
  groups: MobileNeighborhoodGroup[]
  source: MobileNote
}

type MobileReferenceSource = Pick<MobileNote, 'id' | 'title' | 'type' | 'path' | 'aliases' | 'workspaceAlias'>

const preferredInverseLabels = ['Children', 'Events', 'Referenced by'] as const
type MobileSourceMatcher = {
  noteId: string
  rawTitle: string
  targets: Set<string>
}

export function buildMobileNeighborhood(source: MobileNote, notes: MobileNote[]): MobileNeighborhood {
  return {
    groups: [
      ...instanceGroups(source, notes),
      ...directRelationshipGroups(source, notes),
      ...inverseRelationshipGroups(source, notes),
      ...backlinkGroups(source, notes),
    ],
    source,
  }
}

export function buildMobileInspectorReferenceGroups(source: MobileReferenceSource, notes: MobileNote[]): MobileNeighborhoodGroup[] {
  return [
    ...instanceGroups(source, notes),
    ...inverseRelationshipGroups(source, notes),
    ...backlinkGroups(source, notes),
  ]
}

export function filterMobileNeighborhood(
  neighborhood: MobileNeighborhood,
  query: string,
  displayPropertyKeys: string[] = [],
  displayModes?: Record<string, MobilePropertyDisplayMode> | null,
): MobileNeighborhood {
  const normalizedQuery = normalizedMobileSearchQuery(query)
  if (!normalizedQuery) return neighborhood

  return {
    ...neighborhood,
    groups: neighborhood.groups
      .map((group) => ({
        ...group,
        notes: group.notes.filter((note) => mobileNoteListMatchesQuery(note, normalizedQuery, {
          displayModes,
          displayPropertyKeys,
        })),
      }))
      .filter((group) => group.notes.length > 0),
  }
}

export function flattenMobileNeighborhoodNotes(neighborhood: MobileNeighborhood | null): MobileNote[] {
  if (!neighborhood) return []

  return [
    neighborhood.source,
    ...neighborhood.groups.flatMap((group) => group.notes),
  ]
}

function instanceGroups(source: MobileReferenceSource, notes: MobileNote[]): MobileNeighborhoodGroup[] {
  if (source.type !== 'Type') return []

  return [
    relationshipGroup('Instances', notes.filter((note) => note.type === source.title && note.id !== source.id), 'instances'),
  ].filter(hasNotes)
}

function directRelationshipGroups(source: MobileNote, notes: MobileNote[]): MobileNeighborhoodGroup[] {
  const relationships = source.relationships
    .filter((relationship) => relationshipKey(relationship).toLowerCase() !== 'type')
  if (relationships.length === 0) return []
  const notesById = indexNotesById(notes)

  return relationships
    .sort((left, right) => relationshipKey(left).localeCompare(relationshipKey(right)))
    .map((relationship) => relationshipGroup(
      relationshipLabel(relationship),
      relationship.values.flatMap((value) => noteById(notesById, value.id)),
      'direct',
      source.id,
    ))
    .filter(hasNotes)
}

function inverseRelationshipGroups(source: MobileReferenceSource, notes: MobileNote[]): MobileNeighborhoodGroup[] {
  const inverseGroups = new Map<string, MobileNote[]>()
  const sourceMatcher = mobileSourceMatcher(source)

  for (const note of notes) {
    if (note.id === source.id) continue
    for (const relationship of note.relationships) {
      if (relationshipKey(relationship).toLowerCase() === 'type') continue
      if (!relationshipTargetsNote(relationship, sourceMatcher)) continue
      appendInverseRelationship(inverseGroups, inverseRelationshipLabel(relationship, note), note)
    }
  }

  return orderInverseLabels(inverseGroups.keys()).map((label) => relationshipGroup(label, inverseGroups.get(label) ?? [], 'inverse'))
}

function backlinkGroups(source: MobileReferenceSource, notes: MobileNote[]): MobileNeighborhoodGroup[] {
  const sourceMatcher = mobileSourceMatcher(source)

  return [
    relationshipGroup('Backlinks', notes.filter((note) => noteLinksToSource(note, sourceMatcher)), 'backlinks'),
  ].filter(hasNotes)
}

function relationshipGroup(
  label: string,
  candidates: MobileNote[],
  groupSource: MobileNeighborhoodGroupSource,
  sourceId?: string,
): MobileNeighborhoodGroup {
  return {
    id: groupId(label),
    label,
    notes: sortNotesByModified(dedupeNotes(candidates, sourceId)),
    source: groupSource,
  }
}

function hasNotes(group: MobileNeighborhoodGroup) {
  return group.notes.length > 0
}

function relationshipTargetsNote(relationship: MobileRelationship, source: MobileSourceMatcher) {
  return relationship.values.some((value) => {
    if (value.id === source.noteId) return true
    if (value.ref && targetMatchesSource(wikilinkTarget(value.ref), source)) return true

    return value.title === source.rawTitle
  })
}

function noteLinksToSource(note: MobileNote, source: MobileSourceMatcher) {
  if (note.id === source.noteId) return false
  return (note.outgoingLinks ?? []).some((target) => targetMatchesSource(target, source))
}

function targetMatchesSource(target: string, source: MobileSourceMatcher) {
  const normalizedTarget = normalizeMobileWikilinkTarget(target)
  if (source.targets.has(normalizedTarget)) return true

  const lastSegment = normalizedTarget.split('/').filter(Boolean).at(-1)
  return lastSegment ? source.targets.has(lastSegment) : false
}

function mobileSourceMatcher(note: MobileReferenceSource): MobileSourceMatcher {
  return {
    noteId: note.id,
    rawTitle: note.title,
    targets: sourceLinkTargets(note),
  }
}

function sourceLinkTargets(note: MobileReferenceSource): Set<string> {
  const path = note.path ?? note.id
  const filename = path.split('/').pop() ?? path
  const filenameStem = filename.replace(/\.[^.]+$/u, '')
  const relativePathStem = path.replace(/\.md$/u, '')
  const baseTargets = [
    note.title,
    ...(note.aliases ?? []),
    filenameStem,
    relativePathStem,
    ...pathSuffixes(relativePathStem),
  ].filter(Boolean)
  const workspaceAlias = note.workspaceAlias?.trim()
  const workspaceTargets = workspaceAlias
    ? baseTargets.map((target) => `${workspaceAlias}/${target}`)
    : []

  return new Set([
    ...baseTargets,
    ...workspaceTargets,
  ].map(normalizeMobileWikilinkTarget).filter(Boolean))
}

function pathSuffixes(path: string): string[] {
  const normalizedPath = path.replace(/^\/+|\/+$/g, '')
  const segments = normalizedPath.split('/').filter(Boolean)

  return segments.map((_segment, index) => segments.slice(index).join('/'))
}

function appendInverseRelationship(groups: Map<string, MobileNote[]>, label: string, note: MobileNote) {
  groups.set(label, [...(groups.get(label) ?? []), note])
}

function orderInverseLabels(labels: Iterable<string>) {
  const presentLabels = [...labels]
  const preferredLabels = preferredInverseLabels.filter((label) => presentLabels.includes(label))
  const customLabels = presentLabels
    .filter((label) => !preferredInverseLabels.includes(label as typeof preferredInverseLabels[number]))
    .sort((left, right) => left.localeCompare(right))

  return [...preferredLabels, ...customLabels]
}

function inverseRelationshipLabel(relationship: MobileRelationship, note: MobileNote) {
  const label = relationshipLabel(relationship)
  const normalizedLabel = label.toLowerCase()

  if (normalizedLabel === 'belongs to') return note.type === 'Event' ? 'Events' : 'Children'
  if (normalizedLabel === 'related to') return note.type === 'Event' ? 'Events' : 'Referenced by'

  return `← ${label}`
}

function relationshipLabel(relationship: MobileRelationship) {
  if (relationship.kind === 'belongsTo') return 'Belongs to'
  if (relationship.kind === 'relatedTo') return 'Related to'
  if (relationship.kind === 'has') return 'Has'

  return relationship.label ?? humanizeRelationshipKey(relationshipKey(relationship))
}

function relationshipKey(relationship: MobileRelationship) {
  return relationship.key ?? relationship.label ?? relationship.kind
}

function wikilinkTarget(value: string) {
  return parseMobileWikilink(value)?.target ?? value
}

function indexNotesById(notes: MobileNote[]) {
  const index = new Map<string, MobileNote>()
  for (const note of notes) {
    const id = note.id
    if (!index.has(id)) index.set(id, note)
  }
  return index
}

function noteById(notes: ReadonlyMap<string, MobileNote>, noteId: string | undefined) {
  if (!noteId) return []
  const note = notes.get(noteId)
  return note ? [note] : []
}

function dedupeNotes(notes: MobileNote[], sourceId?: string) {
  const deduped = new Map<string, MobileNote>()
  for (const note of notes) {
    if (note.id === sourceId || deduped.has(note.id)) continue
    deduped.set(note.id, note)
  }

  return [...deduped.values()]
}

function sortNotesByModified(notes: MobileNote[]) {
  return [...notes].sort((left, right) => (right.modifiedAt ?? 0) - (left.modifiedAt ?? 0))
}

function groupId(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function humanizeRelationshipKey(key: string) {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}
