import type { MobileNote, MobileSavedView, MobileWorkspaceSnapshot } from '../workspace/mobileWorkspaceModel'

type ContentFragment = string
type FolderPath = NonNullable<MobileWorkspaceSnapshot['folderPaths']>[number]
type NoteMetadataKey = 'archived' | 'favorite' | 'icon' | 'noteWidth' | 'organized'
type NotePath = NonNullable<MobileNote['path']>
type PropertyKey = NonNullable<MobileNote['properties']>[number]['key']
type PropertyList = readonly string[]
type RelationshipKey = NonNullable<MobileNote['relationships'][number]['key']>
type TextContent = Exclude<MobileNote['rawContent'], undefined> | null
type TypeName = Extract<keyof NonNullable<MobileWorkspaceSnapshot['typeDefinitions']>, string>
type ViewName = MobileSavedView['definition']['name']

export function noteByPath(snapshot: MobileWorkspaceSnapshot, path: NotePath) {
  return (snapshot.allNotes ?? snapshot.notes).find((note) => note.path === path) ?? null
}

export function snapshotContainsNotePath(snapshot: MobileWorkspaceSnapshot, path: NotePath) {
  return noteByPath(snapshot, path) !== null
}

export function typeDefinitionExists(snapshot: MobileWorkspaceSnapshot, name: TypeName) {
  return snapshot.typeDefinitions?.[name] !== undefined
}

export function viewExists(snapshot: MobileWorkspaceSnapshot, name: ViewName) {
  return snapshot.views?.some((view) => view.definition.name === name) === true
}

export function viewByName(snapshot: MobileWorkspaceSnapshot, name: ViewName): MobileSavedView | undefined {
  return snapshot.views?.find((view) => view.definition.name === name)
}

export function noteMatches(
  note: MobileNote | null,
  expected: Partial<Pick<MobileNote, NoteMetadataKey>>,
) {
  return note !== null && Object.entries(expected).every(([key, value]) => note[key as NoteMetadataKey] === value)
}

export function notePropertyValue(note: MobileNote | null, key: PropertyKey) {
  return note?.properties?.find((property) => property.key === key)?.value
}

export function relationshipRefs(note: MobileNote | null, key: RelationshipKey) {
  return note?.relationships.find((relationship) => relationship.key === key)?.values
    .map((value) => value.ref)
    .filter((ref): ref is string => typeof ref === 'string') ?? []
}

export function joinedProperties(properties: PropertyList | undefined) {
  return properties?.join('|') ?? ''
}

export function favoriteLabels(snapshot: MobileWorkspaceSnapshot) {
  return snapshot.sidebarSections
    .find((section) => section.id === 'favorites')
    ?.items
    ?.map((item) => item.label) ?? []
}

export function folderPathStartsWith(snapshot: MobileWorkspaceSnapshot, pathPrefix: FolderPath) {
  return snapshot.folderPaths?.some((path) => path === pathPrefix || path.startsWith(`${pathPrefix}/`)) === true
}

export function textContainsAll(content: TextContent, fragments: readonly ContentFragment[]) {
  return content !== null && fragments.every((fragment) => content.includes(fragment))
}
