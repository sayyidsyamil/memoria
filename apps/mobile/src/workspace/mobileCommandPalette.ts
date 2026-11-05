import { mobileText } from '../i18n/mobileText'
import type { MobileNoteWidth } from './mobileWorkspaceModel'
import type { MobileCommandPaletteCommand, MobileCommandPaletteHandlers, MobileTextKey } from './mobileCommandPalette.types'
import { command, dynamicCommand } from './mobileCommandPaletteCore'
import { selectedNoteCommands, isMarkdownSelectedNote, markdownSelectedNoteCommandEnabled, textLikeSelectedNoteCommandEnabled } from './mobileCommandPaletteSelectedNote'
import { navigationCommands, typeSidebarItems, activeSidebarItem, selectedSidebarItem, customizeColumnsCommandConfig, typeNameForCommand, genericTypeCommandName, sidebarSelectionFromItem, commandSlug } from './mobileCommandPaletteNavigation'

export function buildMobileCommandPaletteCommands(
  handlers: MobileCommandPaletteHandlers,
): MobileCommandPaletteCommand[] {
  return [
    ...navigationCommands(handlers),
    ...noteCreationCommands(handlers),
    ...noteHistoryCommands(handlers),
    ...noteFindCommands(handlers),
    ...selectedNoteCommands(handlers),
    ...viewCommands(handlers),
    ...settingsCommands(handlers),
  ]
}

export function noteCreationCommands(handlers: MobileCommandPaletteHandlers): MobileCommandPaletteCommand[] {
  return [
    command({
      desktopCommand: 'fileNewNote',
      execute: handlers.onOpenCreateNote,
      group: 'Note',
      keywords: ['new', 'create', 'add'],
      label: mobileText('command.note.newNote'),
    }),
    currentFolderNoteCommand(handlers),
    command({
      desktopCommand: 'fileNewType',
      execute: handlers.onOpenCreateType,
      group: 'Note',
      keywords: ['new', 'create', 'type', 'template'],
      label: mobileText('command.note.newType'),
    }),
    ...typedNoteCreationCommands(handlers),
  ]
}

export function currentFolderNoteCommand(handlers: MobileCommandPaletteHandlers): MobileCommandPaletteCommand {
  return dynamicCommand({
    enabled: Boolean(handlers.activeFolderId && handlers.onCreateNote),
    execute: () => handlers.onCreateNote?.(''),
    group: 'Note',
    id: 'create-note-current-folder',
    keywords: ['new', 'create', 'add', 'folder', 'current'],
    label: mobileText('command.note.newNoteInCurrentFolder'),
  })
}

export function typedNoteCreationCommands(handlers: MobileCommandPaletteHandlers): MobileCommandPaletteCommand[] {
  const createTypedNote = handlers.onCreateNoteOfType
  if (!createTypedNote) return []

  return typeSidebarItems(handlers.snapshot).flatMap((item) => {
    const typeName = typeNameForCommand(item)
    if (!typeName || genericTypeCommandName(typeName)) return []

    return [dynamicCommand({
      enabled: true,
      execute: () => createTypedNote(typeName),
      group: 'Note',
      id: `new-${commandSlug(typeName)}`,
      keywords: ['new', 'create', typeName.toLowerCase()],
      label: mobileText('command.note.newTypedNote').replace('{type}', typeName),
    })]
  })
}

export function noteHistoryCommands(handlers: MobileCommandPaletteHandlers): MobileCommandPaletteCommand[] {
  return [
    command({
      desktopCommand: 'editUndo',
      enabled: handlers.canUndoWorkspaceEdit,
      execute: handlers.onUndoWorkspaceEdit,
      group: 'Note',
      keywords: ['undo', 'history', 'revert'],
      label: mobileText('command.note.undo'),
    }),
    command({
      desktopCommand: 'editRedo',
      enabled: handlers.canRedoWorkspaceEdit,
      execute: handlers.onRedoWorkspaceEdit,
      group: 'Note',
      keywords: ['redo', 'history', 'repeat'],
      label: mobileText('command.note.redo'),
    }),
    command({
      desktopCommand: 'editPastePlainText',
      enabled: textLikeSelectedNoteCommandEnabled(handlers.selectedNote, handlers.onPastePlainText),
      execute: handlers.onPastePlainText,
      group: 'Note',
      keywords: ['paste', 'plain', 'formatting', 'clipboard', 'match style'],
      label: mobileText('command.note.pastePlainText'),
    }),
  ]
}

export function noteFindCommands(handlers: MobileCommandPaletteHandlers): MobileCommandPaletteCommand[] {
  return [
    command({
      desktopCommand: 'editFindInNote',
      enabled: textLikeSelectedNoteCommandEnabled(handlers.selectedNote, handlers.onOpenFindInNote),
      execute: handlers.onOpenFindInNote,
      group: 'Note',
      keywords: ['find', 'search', 'current note'],
      label: mobileText('command.note.findInNote'),
    }),
    command({
      desktopCommand: 'editReplaceInNote',
      enabled: textLikeSelectedNoteCommandEnabled(handlers.selectedNote, handlers.onOpenReplaceInNote),
      execute: handlers.onOpenReplaceInNote,
      group: 'Note',
      keywords: ['replace', 'find', 'current note'],
      label: mobileText('command.note.replaceInNote'),
    }),
    command({
      desktopCommand: 'editFindInVault',
      execute: handlers.onOpenSearch,
      group: 'Navigation',
      keywords: ['find', 'search', 'vault', 'all notes'],
      label: mobileText('menu.edit.findInVault'),
    }),
  ]
}

export function viewCommands(handlers: MobileCommandPaletteHandlers): MobileCommandPaletteCommand[] {
  return [
    ...layoutViewCommands(handlers),
    command({
      desktopCommand: 'viewToggleProperties',
      execute: handlers.onToggleProperties,
      group: 'View',
      keywords: ['properties', 'inspector', 'panel'],
      label: mobileText('command.view.toggleProperties'),
    }),
    command({
      desktopCommand: 'viewToggleTableOfContents',
      enabled: isMarkdownSelectedNote(handlers.selectedNote),
      execute: handlers.onOpenTableOfContents,
      group: 'View',
      keywords: ['toc', 'headings', 'outline'],
      label: mobileText('menu.note.toggleTableOfContents'),
    }),
    command({
      desktopCommand: 'viewToggleBacklinks',
      enabled: handlers.selectedNote !== null && handlers.onOpenBacklinks !== undefined,
      execute: handlers.onOpenBacklinks,
      group: 'View',
      keywords: ['backlinks', 'references', 'mentions'],
      label: mobileText('command.view.toggleBacklinks'),
    }),
    command({
      desktopCommand: 'editToggleRawEditor',
      enabled: markdownSelectedNoteCommandEnabled(handlers.selectedNote, handlers.onToggleRawEditor),
      execute: handlers.onToggleRawEditor,
      group: 'View',
      keywords: ['raw', 'source', 'markdown', 'frontmatter'],
      label: mobileText('command.view.toggleRaw'),
    }),
    ...selectedViewMoveCommands(handlers),
    ...defaultNoteWidthCommands(handlers),
    customizeNoteListColumnsCommand(handlers),
  ]
}

export function layoutViewCommands(handlers: MobileCommandPaletteHandlers): MobileCommandPaletteCommand[] {
  return [
    command({
      desktopCommand: 'viewCommandPalette',
      enabled: handlers.onOpenCommandPalette !== undefined,
      execute: handlers.onOpenCommandPalette,
      group: 'View',
      keywords: ['command', 'palette', 'launcher', 'shortcut'],
      label: mobileText('menu.view.commandPalette'),
    }),
    command({
      desktopCommand: 'viewEditorOnly',
      execute: handlers.onViewEditorOnly,
      group: 'View',
      keywords: ['layout', 'focus', 'editor'],
      label: mobileText('command.view.editorOnly'),
    }),
    command({
      desktopCommand: 'viewEditorList',
      execute: handlers.onViewEditorList,
      group: 'View',
      keywords: ['layout', 'notes', 'list'],
      label: mobileText('command.view.editorNoteList'),
    }),
    command({
      desktopCommand: 'viewAll',
      execute: handlers.onViewAll,
      group: 'View',
      keywords: ['layout', 'sidebar', 'all panels'],
      label: mobileText('command.view.fullLayout'),
    }),
  ]
}

export function defaultNoteWidthCommands(handlers: MobileCommandPaletteHandlers): MobileCommandPaletteCommand[] {
  return [
    defaultNoteWidthCommand('normal', 'command.view.defaultNoteWidthNormal', handlers),
    defaultNoteWidthCommand('wide', 'command.view.defaultNoteWidthWide', handlers),
  ]
}

export function defaultNoteWidthCommand(
  mode: MobileNoteWidth,
  labelKey: MobileTextKey,
  handlers: MobileCommandPaletteHandlers,
): MobileCommandPaletteCommand {
  const activeMode = handlers.defaultNoteWidth ?? 'normal'

  return dynamicCommand({
    enabled: Boolean(handlers.onSetDefaultNoteWidth && activeMode !== mode),
    execute: () => handlers.onSetDefaultNoteWidth?.(mode),
    group: 'View',
    id: `set-default-note-width-${mode}`,
    keywords: ['layout', 'note', 'column', 'width', mode, 'default', 'reading'],
    label: mobileText(labelKey),
  })
}

export function selectedViewMoveCommands(handlers: MobileCommandPaletteHandlers): MobileCommandPaletteCommand[] {
  const selectedView = selectedSidebarItem(handlers, 'views')
  const viewName = selectedView?.label.trim()

  return [
    dynamicCommand({
      enabled: Boolean(selectedView && handlers.canMoveSelectedViewUp && handlers.onMoveSelectedViewUp),
      execute: handlers.onMoveSelectedViewUp,
      group: 'View',
      id: 'move-view-up',
      keywords: ['saved view', 'view', 'views', 'order', 'sidebar', 'move', 'up'],
      label: viewName
        ? mobileText('command.view.moveNamedViewUp').replace('{name}', viewName)
        : mobileText('command.view.moveViewUp'),
    }),
    dynamicCommand({
      enabled: Boolean(selectedView && handlers.canMoveSelectedViewDown && handlers.onMoveSelectedViewDown),
      execute: handlers.onMoveSelectedViewDown,
      group: 'View',
      id: 'move-view-down',
      keywords: ['saved view', 'view', 'views', 'order', 'sidebar', 'move', 'down'],
      label: viewName
        ? mobileText('command.view.moveNamedViewDown').replace('{name}', viewName)
        : mobileText('command.view.moveViewDown'),
    }),
  ]
}

export function customizeNoteListColumnsCommand(handlers: MobileCommandPaletteHandlers): MobileCommandPaletteCommand {
  const item = activeSidebarItem(handlers)
  const selection = item ? sidebarSelectionFromItem(item, item.sectionId) : null
  const config = selection ? customizeColumnsCommandConfig(selection, handlers) : null

  return dynamicCommand({
    enabled: config !== null,
    execute: config?.execute,
    group: 'View',
    id: 'customize-note-list-columns',
    keywords: ['columns', 'chips', 'properties', 'note list', selection?.label ?? ''],
    label: config?.label ?? mobileText('noteList.properties.customizeColumns'),
  })
}

export function settingsCommands(handlers: MobileCommandPaletteHandlers): MobileCommandPaletteCommand[] {
  return [
    command({
      desktopCommand: 'vaultOpen',
      enabled: handlers.onOpenNativeVault !== undefined,
      execute: handlers.onOpenNativeVault,
      group: 'Settings',
      keywords: ['vault', 'open', 'folder'],
      label: mobileText('command.settings.openVault'),
    }),
    command({
      desktopCommand: 'vaultReload',
      enabled: handlers.onReloadVault !== undefined,
      execute: handlers.onReloadVault,
      group: 'Settings',
      keywords: ['vault', 'reload', 'refresh', 'disk'],
      label: mobileText('command.settings.reloadVault'),
    }),
  ]
}

export type { MobileCommandGroup, MobileCommandPaletteCommand, MobileCommandPaletteGroup, MobileCommandPaletteHandlers } from './mobileCommandPalette.types'
export { mobileCommandPaletteResults, mobileCommandGroupLabel } from './mobileCommandPaletteCore'
export { mobilePrimarySidebarSelection } from './mobileCommandPaletteNavigation'
