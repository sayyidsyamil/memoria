import { mobileText } from '../i18n/mobileText'
import type { MobileSidebarFolderSelection, MobileSidebarItemSelection } from '../components/workspace/MobileWorkspaceSidebar'
import type { MobileSidebarFolder, MobileSidebarItem, MobileWorkspaceSnapshot } from './mobileWorkspaceModel'
import type { MobileNoteListFilter } from './mobileNoteFilters'
import { mobileTypeNameFromSidebarLabel } from './mobileTypeNames'
import type { DesktopCommandKey, MobileCommandPaletteCommand, MobileCommandPaletteHandlers, ActiveSidebarItem } from './mobileCommandPalette.types'
import { command, dynamicCommand } from './mobileCommandPaletteCore'

export function mobilePrimarySidebarSelection(
  snapshot: MobileWorkspaceSnapshot,
  itemId: 'all-notes' | 'archive' | 'inbox',
): MobileSidebarItemSelection | null {
  const item = snapshot.sidebarSections
    .find((section) => section.id === 'primary')
    ?.items
    ?.find((candidate) => candidate.id === itemId)

  if (!item) return null

  return {
    count: item.count,
    id: item.id,
    label: item.label,
    noteId: item.noteId,
    sectionId: 'primary',
    typeName: item.typeName,
    viewId: item.viewId,
  }
}

export function navigationCommands(handlers: MobileCommandPaletteHandlers): MobileCommandPaletteCommand[] {
  return [
    command({
      desktopCommand: 'fileQuickOpen',
      execute: handlers.onOpenSearch,
      group: 'Navigation',
      keywords: ['quick', 'open', 'find'],
      label: mobileText('command.navigation.searchNotes'),
    }),
    primaryNavigationCommand('goInbox', 'inbox', mobileText('command.navigation.goInbox'), handlers),
    primaryNavigationCommand('goAllNotes', 'all-notes', mobileText('command.navigation.goAllNotes'), handlers),
    primaryNavigationCommand('goArchived', 'archive', mobileText('command.navigation.goArchived'), handlers),
    workspaceHistoryCommand('viewGoBack', handlers.canGoBack, handlers.onGoBack, mobileText('command.navigation.goBack')),
    workspaceHistoryCommand('viewGoForward', handlers.canGoForward, handlers.onGoForward, mobileText('command.navigation.goForward')),
    ...folderNavigationCommands(handlers),
    ...typeSectionNavigationCommands(handlers),
    ...noteListFilterCommands(handlers),
  ]
}

export function folderNavigationCommands(handlers: MobileCommandPaletteHandlers): MobileCommandPaletteCommand[] {
  const folder = activeSidebarFolder(handlers)

  return [
    dynamicCommand({
      enabled: Boolean(folder && handlers.onRevealSelectedFolder),
      execute: handlers.onRevealSelectedFolder,
      group: 'Navigation',
      id: 'reveal-selected-folder',
      keywords: ['folder', 'directory', 'finder', 'reveal', 'show', 'filesystem'],
      label: mobileText('sidebar.action.revealFolderMenu'),
    }),
    dynamicCommand({
      enabled: Boolean(folder && handlers.onCopySelectedFolderPath),
      execute: handlers.onCopySelectedFolderPath,
      group: 'Navigation',
      id: 'copy-selected-folder-path',
      keywords: ['folder', 'directory', 'path', 'copy', 'clipboard'],
      label: mobileText('sidebar.action.copyFolderPathMenu'),
    }),
    dynamicCommand({
      enabled: Boolean(folder && handlers.onOpenFolderActions),
      execute: folder ? () => handlers.onOpenFolderActions?.(folder) : undefined,
      group: 'Navigation',
      id: 'rename-folder',
      keywords: ['folder', 'directory', 'sidebar', 'rename'],
      label: mobileText('command.navigation.renameFolder'),
    }),
    dynamicCommand({
      enabled: Boolean(folder && handlers.onDeleteSelectedFolder),
      execute: handlers.onDeleteSelectedFolder,
      group: 'Navigation',
      id: 'delete-folder',
      keywords: ['folder', 'directory', 'sidebar', 'delete', 'remove'],
      label: mobileText('command.navigation.deleteFolder'),
    }),
  ]
}

export function typeSectionNavigationCommands(handlers: MobileCommandPaletteHandlers): MobileCommandPaletteCommand[] {
  return typeSidebarItems(handlers.snapshot).flatMap((item) => {
    const typeName = typeNameForCommand(item)
    if (!typeName) return []

    return [dynamicCommand({
      enabled: true,
      execute: () => handlers.onSelectSidebarItem(sidebarSelectionFromTypeItem(item)),
      group: 'Navigation',
      id: `list-${commandSlug(typeName)}`,
      keywords: ['list', 'show', 'filter', item.label, typeName],
      label: mobileText('command.navigation.listType').replace('{type}', item.label),
    })]
  })
}

export function noteListFilterCommands(handlers: MobileCommandPaletteHandlers): MobileCommandPaletteCommand[] {
  if (!handlers.noteListFilterVisible || handlers.onNoteListFilterChange === undefined) return []

  return [
    noteListFilterCommand('open', mobileText('command.navigation.showOpenNotes'), handlers),
    noteListFilterCommand('archived', mobileText('command.navigation.showArchivedNotes'), handlers),
  ]
}

export function primaryNavigationCommand(
  desktopCommand: DesktopCommandKey,
  itemId: 'all-notes' | 'archive' | 'inbox',
  label: string,
  handlers: MobileCommandPaletteHandlers,
): MobileCommandPaletteCommand {
  const selection = mobilePrimarySidebarSelection(handlers.snapshot, itemId)
  return command({
    desktopCommand,
    enabled: selection !== null,
    execute: selection ? () => handlers.onSelectSidebarItem(selection) : undefined,
    group: 'Navigation',
    keywords: [itemId, 'go', 'navigate', 'sidebar'],
    label,
  })
}

export function workspaceHistoryCommand(
  desktopCommand: Extract<DesktopCommandKey, 'viewGoBack' | 'viewGoForward'>,
  canNavigate: boolean | undefined,
  execute: (() => void) | undefined,
  label: string,
): MobileCommandPaletteCommand {
  return command({
    desktopCommand,
    enabled: Boolean(canNavigate && execute),
    execute,
    group: 'Navigation',
    keywords: ['go', 'navigate', 'history', label],
    label,
  })
}

export function noteListFilterCommand(
  filter: MobileNoteListFilter,
  label: string,
  handlers: MobileCommandPaletteHandlers,
): MobileCommandPaletteCommand {
  return dynamicCommand({
    enabled: handlers.noteListFilter !== filter,
    execute: () => handlers.onNoteListFilterChange?.(filter),
    group: 'Navigation',
    id: `filter-${filter}`,
    keywords: ['filter', filter, 'notes', 'section', 'pill'],
    label,
  })
}

export function typeSidebarItems(snapshot: MobileWorkspaceSnapshot): MobileSidebarItem[] {
  return snapshot.sidebarSections
    .find((section) => section.id === 'types')
    ?.items
    ?.filter((item) => item.typeName || item.label) ?? []
}

export function activeSidebarFolder(handlers: MobileCommandPaletteHandlers): MobileSidebarFolderSelection | null {
  const folderId = handlers.activeFolderId
  if (!folderId) return null

  for (const section of handlers.snapshot.sidebarSections) {
    const folder = findSidebarFolder(section.folders ?? [], folderId)
    if (folder) return { id: folder.id, name: folder.name }
  }

  return null
}

export function findSidebarFolder(
  folders: MobileSidebarFolder[],
  folderId: string,
): MobileSidebarFolder | null {
  for (const folder of folders) {
    if (folder.id === folderId) return folder
    const child = findSidebarFolder(folder.children, folderId)
    if (child) return child
  }

  return null
}

export function activeSidebarItem(handlers: MobileCommandPaletteHandlers): ActiveSidebarItem | null {
  if (!handlers.activeItemId) return null

  for (const section of handlers.snapshot.sidebarSections) {
    const item = section.items?.find((candidate) => candidate.id === handlers.activeItemId)
    if (item) return { ...item, sectionId: section.id }
  }

  return null
}

export function selectedSidebarItem(
  handlers: MobileCommandPaletteHandlers,
  sectionId: string,
): ActiveSidebarItem | null {
  const item = activeSidebarItem(handlers)
  return item?.sectionId === sectionId ? item : null
}

export function customizeColumnsCommandConfig(
  selection: MobileSidebarItemSelection,
  handlers: MobileCommandPaletteHandlers,
): { execute: () => void; label: string } | null {
  if (selection.sectionId === 'primary') return primaryColumnsCommandConfig(selection, handlers)
  if (selection.sectionId === 'types' && handlers.onOpenTypeActions) {
    return {
      execute: () => handlers.onOpenTypeActions?.(selection),
      label: mobileText('noteList.properties.customizeColumns'),
    }
  }
  if (selection.sectionId === 'views' && handlers.onOpenViewActions) {
    return {
      execute: () => handlers.onOpenViewActions?.(selection),
      label: mobileText('noteList.properties.customizeViewColumns').replace('{name}', selection.label),
    }
  }
  return null
}

export function primaryColumnsCommandConfig(
  selection: MobileSidebarItemSelection,
  handlers: MobileCommandPaletteHandlers,
): { execute: () => void; label: string } | null {
  if (!handlers.onOpenPrimaryActions || !['all-notes', 'inbox'].includes(selection.id)) return null

  return {
    execute: () => handlers.onOpenPrimaryActions?.(selection),
    label: selection.id === 'all-notes'
      ? mobileText('noteList.properties.customizeAllColumns')
      : mobileText('noteList.properties.customizeInboxColumns'),
  }
}

export function typeNameForCommand(item: MobileSidebarItem): string {
  return mobileTypeNameFromSidebarLabel(item.label, item.typeName) ?? ''
}

export function genericTypeCommandName(typeName: string): boolean {
  return ['note', 'type'].includes(typeName.toLowerCase())
}

export function sidebarSelectionFromTypeItem(item: MobileSidebarItem): MobileSidebarItemSelection {
  return sidebarSelectionFromItem(item, 'types')
}

export function sidebarSelectionFromItem(
  item: MobileSidebarItem,
  sectionId: string,
): MobileSidebarItemSelection {
  return {
    count: item.count,
    id: item.id,
    label: item.label,
    noteId: item.noteId,
    sectionId,
    typeName: item.typeName,
    viewId: item.viewId,
  }
}

export function commandSlug(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-')
}
