import type { MobileNote, MobileSidebarFolder } from './mobileWorkspaceModel'

type FolderPath = string
type FolderSegment = string

const windowsReservedDeviceNames = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
])
const invalidPortableNameChars = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])

export function buildMobileFolderTree({
  folderPaths = [],
  notes,
}: {
  folderPaths?: FolderPath[]
  notes: MobileNote[]
}): MobileSidebarFolder[] {
  const roots: MobileSidebarFolder[] = []
  const foldersByPath = new Map<FolderPath, MobileSidebarFolder>()

  for (const path of folderTreeSourcePaths(folderPaths, notes)) {
    appendFolderPath(roots, foldersByPath, folderPathSegments(path))
  }

  sortFolderTree(roots)
  return roots
}

export function mobileFolderPathsForNotes(notes: MobileNote[]): FolderPath[] {
  return uniqueMobileFolderPaths(notes.map(noteFolderPath).filter(Boolean))
}

export function uniqueMobileFolderPaths(paths: FolderPath[]): FolderPath[] {
  return [...new Set(paths.map(normalizedMobileFolderPath).filter(Boolean))].sort((left, right) => left.localeCompare(right))
}

export function normalizedMobileFolderPath(path: FolderPath): FolderPath {
  return path.trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/')
}

export function normalizedMobileFolderName(name: FolderSegment): FolderSegment | null {
  const trimmed = name.trim()
  return isInvalidPortableNameSegment(trimmed) ? null : trimmed
}

export function normalizedMobileFilenameStem(value: FolderSegment): FolderSegment | null {
  const trimmed = value.trim()
  const stem = (trimmed.endsWith('.md') ? trimmed.slice(0, -3) : trimmed).trim()
  return normalizedMobileFolderName(stem)
}

export function mobileFolderChildPath(parentPath: FolderPath | undefined, folderName: FolderSegment): FolderPath | null {
  const name = normalizedMobileFolderName(folderName)
  if (!name) return null

  const parent = parentPath ? normalizedMobileFolderPath(parentPath) : ''
  return parent ? `${parent}/${name}` : name
}

export function mobileFolderName(path: FolderPath): FolderSegment {
  return normalizedMobileFolderPath(path).split('/').filter(Boolean).at(-1) ?? ''
}

export function mobileFolderParentPath(path: FolderPath): FolderPath {
  return normalizedMobileFolderPath(path).split('/').filter(Boolean).slice(0, -1).join('/')
}

export function mobileFolderPathContains(folderPath: FolderPath, candidatePath: FolderPath): boolean {
  const folder = normalizedMobileFolderPath(folderPath)
  const candidate = normalizedMobileFolderPath(candidatePath)
  return Boolean(folder) && (candidate === folder || candidate.startsWith(`${folder}/`))
}

export function folderPathsWithCreated(paths: FolderPath[], folderPath: FolderPath): FolderPath[] {
  const normalized = normalizedMobileFolderPath(folderPath)
  if (!normalized || paths.some((path) => normalizedMobileFolderPath(path) === normalized)) return uniqueMobileFolderPaths(paths)
  return uniqueMobileFolderPaths([...paths, normalized])
}

export function folderPathsWithDeleted(paths: FolderPath[], folderPath: FolderPath): FolderPath[] {
  return uniqueMobileFolderPaths(paths.filter((path) => !mobileFolderPathContains(folderPath, path)))
}

export function folderPathsWithRenamed(paths: FolderPath[], previousPath: FolderPath, nextPath: FolderPath): FolderPath[] {
  return uniqueMobileFolderPaths(paths.map((path) => renamedFolderPath(path, previousPath, nextPath)))
}

export function renamedFolderPath(path: FolderPath, previousPath: FolderPath, nextPath: FolderPath): FolderPath {
  if (!mobileFolderPathContains(previousPath, path)) return normalizedMobileFolderPath(path)

  const previous = normalizedMobileFolderPath(previousPath)
  const next = normalizedMobileFolderPath(nextPath)
  return `${next}${normalizedMobileFolderPath(path).slice(previous.length)}`
}

function noteFolderPath(note: MobileNote): FolderPath {
  return normalizedMobileFolderPath((note.path ?? note.id).split('/').slice(0, -1).join('/'))
}

function folderTreeSourcePaths(folderPaths: FolderPath[], notes: MobileNote[]): FolderPath[] {
  const paths = new Set<FolderPath>()

  for (const path of folderPaths) addFolderTreePath(paths, path)
  for (const note of notes) addFolderTreePath(paths, noteFolderPath(note))

  return [...paths]
}

function addFolderTreePath(paths: Set<FolderPath>, path: FolderPath) {
  const normalizedPath = normalizedMobileFolderPath(path)
  if (normalizedPath) paths.add(normalizedPath)
}

function appendFolderPath(
  roots: MobileSidebarFolder[],
  foldersByPath: Map<FolderPath, MobileSidebarFolder>,
  segments: FolderSegment[],
) {
  let currentPath = ''
  let level = roots

  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment
    const folder = findOrCreateFolder(level, foldersByPath, segment, currentPath)
    level = folder.children
  }
}

function folderPathSegments(path: FolderPath): FolderSegment[] {
  return normalizedMobileFolderPath(path).split('/').filter(visibleFolderSegment)
}

function findOrCreateFolder(
  folders: MobileSidebarFolder[],
  foldersByPath: Map<FolderPath, MobileSidebarFolder>,
  name: FolderSegment,
  path: FolderPath,
): MobileSidebarFolder {
  const existing = foldersByPath.get(path)
  if (existing) return existing

  const folder = { children: [], expanded: true, id: path, name }
  foldersByPath.set(path, folder)
  folders.push(folder)
  return folder
}

function sortFolderTree(folders: MobileSidebarFolder[]) {
  folders.sort((left, right) => left.name.localeCompare(right.name))
  for (const folder of folders) sortFolderTree(folder.children)
}

function visibleFolderSegment(segment: FolderSegment): boolean {
  return Boolean(segment) && !segment.startsWith('.') && segment !== 'type'
}

function isInvalidPortableNameSegment(value: FolderSegment): boolean {
  if (!value || value === '.' || value === '..') return true
  if (value.endsWith('.') || value.endsWith(' ')) return true
  if ([...value].some(isInvalidPortableNameChar)) return true

  return windowsReservedDeviceNames.has(portableDeviceName(value))
}

function portableDeviceName(value: FolderSegment): string {
  return value.split('.')[0]?.toUpperCase() ?? value.toUpperCase()
}

function isInvalidPortableNameChar(char: string): boolean {
  const codePoint = char.codePointAt(0) ?? 0
  return codePoint < 32 || codePoint === 127 || invalidPortableNameChars.has(char)
}
