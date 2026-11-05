import { mobileText } from '../i18n/mobileText'
import type { MobileNote } from './mobileWorkspaceModel'
import { isMobileMarkdownActionNote, isMobileNonMarkdownActionNote, isMobileTextLikeActionNote } from './mobileNoteActionMode'
import type { MobileCommandPaletteCommand, MobileCommandPaletteHandlers, MobileTextKey, SelectedNoteCommandLabel, SelectedNoteCommandSpec } from './mobileCommandPalette.types'
import { command, dynamicCommand } from './mobileCommandPaletteCore'

export const selectedNoteCommandSpecs: SelectedNoteCommandSpec[] = [
  {
    desktopCommand: 'fileSave',
    enabled: (handlers, note) => textLikeSelectedNoteCommandEnabled(note, handlers.onSaveActiveEditor ?? handlers.onUpdateNoteContent),
    execute: saveSelectedNote,
    kind: 'desktop',
    keywords: ['save', 'write'],
    label: 'command.note.saveNote',
  },
  {
    desktopCommand: 'noteToggleFavorite',
    enabled: (_handlers, note) => isMarkdownSelectedNote(note),
    execute: (handlers, note) => (note ? handlers.onToggleFavorite : undefined),
    kind: 'desktop',
    keywords: ['favorite', 'star', 'pin'],
    label: favoriteLabelKey,
  },
  {
    desktopCommand: 'noteToggleOrganized',
    enabled: (_handlers, note) => isMarkdownSelectedNote(note),
    execute: setSelectedNoteOrganized,
    kind: 'desktop',
    keywords: ['organized', 'inbox', 'triage'],
    label: organizedLabelKey,
  },
  {
    desktopCommand: 'noteArchive',
    enabled: (_handlers, note) => isMarkdownSelectedNote(note),
    execute: setSelectedNoteArchived,
    kind: 'desktop',
    keywords: ['archive'],
    label: archiveLabelKey,
  },
  {
    desktopCommand: 'noteDelete',
    enabled: (_handlers, note) => hasSelectedNote(note),
    execute: (handlers, note) => (note ? handlers.onDeleteNote : undefined),
    kind: 'desktop',
    keywords: ['delete', 'remove'],
    label: 'command.note.deleteNote',
  },
  {
    desktopCommand: 'noteExportPdf',
    enabled: (handlers, note) => markdownSelectedNoteCommandEnabled(note, handlers.onExportNoteAsPdf),
    execute: (handlers) => handlers.onExportNoteAsPdf,
    kind: 'desktop',
    keywords: ['export', 'pdf', 'print', 'share'],
    label: 'command.note.exportPdf',
  },
  {
    enabled: (handlers, note) => selectedNoteCommandEnabled(note, handlers.onCopyDeepLink),
    execute: (handlers) => handlers.onCopyDeepLink,
    id: 'copy-active-deep-link',
    kind: 'dynamic',
    keywords: ['copy', 'deep link', 'url', 'link'],
    label: 'command.note.copyDeepLink',
  },
  {
    enabled: (handlers, note) => selectedNoteCommandEnabled(note, handlers.onCopyFilePath),
    execute: (handlers) => handlers.onCopyFilePath,
    id: 'copy-active-file-path',
    kind: 'dynamic',
    keywords: ['file', 'path', 'copy', 'clipboard', 'filesystem'],
    label: 'editor.toolbar.copyFilePath',
  },
  {
    enabled: (handlers, note) => selectedNoteCommandEnabled(note, handlers.onRevealFile),
    execute: (handlers) => handlers.onRevealFile,
    id: 'reveal-active-file',
    kind: 'dynamic',
    keywords: ['file', 'folder', 'finder', 'reveal', 'show', 'filesystem'],
    label: 'editor.toolbar.revealFile',
  },
  {
    enabled: (handlers, note) => textLikeSelectedNoteCommandEnabled(note, handlers.onEnterNeighborhood),
    execute: openSelectedNeighborhood,
    id: 'open-active-neighborhood',
    kind: 'dynamic',
    keywords: ['neighborhood', 'map', 'relationships', 'related', 'graph'],
    label: 'editor.toolbar.openNeighborhood',
  },
  {
    enabled: (handlers, note) => markdownSelectedNoteCommandEnabled(note, handlers.onOpenSetNoteIcon),
    execute: (handlers) => handlers.onOpenSetNoteIcon,
    id: 'set-note-icon',
    kind: 'dynamic',
    keywords: ['icon', 'emoji'],
    label: 'command.note.setIcon',
  },
  {
    enabled: (handlers, note) => markdownSelectedNoteIconCommandEnabled(note, handlers.onRemoveNoteIcon),
    execute: (handlers) => handlers.onRemoveNoteIcon,
    id: 'remove-note-icon',
    kind: 'dynamic',
    keywords: ['icon', 'emoji', 'remove', 'delete'],
    label: 'command.note.removeIcon',
  },
  {
    enabled: (handlers, note) => markdownSelectedNoteCommandEnabled(note, handlers.onOpenChangeNoteType),
    execute: (handlers) => handlers.onOpenChangeNoteType,
    id: 'change-note-type',
    kind: 'dynamic',
    keywords: ['type', 'change'],
    label: 'command.note.changeType',
  },
  {
    enabled: (handlers, note) => markdownSelectedNoteCommandEnabled(note, handlers.onOpenMoveNoteToFolder),
    execute: (handlers) => handlers.onOpenMoveNoteToFolder,
    id: 'move-note-to-folder',
    kind: 'dynamic',
    keywords: ['move', 'folder', 'organize'],
    label: 'command.note.moveToFolder',
  },
  {
    enabled: (handlers, note) => markdownSelectedNoteCommandEnabled(note, handlers.onOpenRenameNoteFile),
    execute: (handlers) => handlers.onOpenRenameNoteFile,
    id: 'rename-active-file',
    kind: 'dynamic',
    keywords: ['rename', 'filename', 'file', 'path'],
    label: 'editor.filename.rename',
  },
  {
    enabled: (handlers, note) => markdownSelectedNoteCommandEnabled(note, handlers.onRenameNoteFileToTitle),
    execute: (handlers) => handlers.onRenameNoteFileToTitle,
    id: 'rename-active-file-to-title',
    kind: 'dynamic',
    keywords: ['rename', 'filename', 'title', 'file'],
    label: 'editor.filename.renameToTitle',
  },
  {
    enabled: (handlers, note) => nonMarkdownSelectedNoteCommandEnabled(note, handlers.onOpenFileInDefaultApp),
    execute: (handlers) => handlers.onOpenFileInDefaultApp,
    id: 'open-active-file-external',
    kind: 'dynamic',
    keywords: ['file', 'open', 'external', 'default', 'attachment'],
    label: 'editor.toolbar.openFileInDefaultApp',
  },
  {
    enabled: (handlers, note) => markdownSelectedNoteCommandEnabled(note, handlers.onToggleNoteWidth)
      && note?.noteWidth !== 'wide',
    execute: (handlers) => handlers.onToggleNoteWidth,
    group: 'View',
    id: 'set-note-width-wide',
    kind: 'dynamic',
    keywords: ['layout', 'note', 'column', 'width', 'wide', 'reading'],
    label: 'command.view.noteWidthWide',
  },
  {
    enabled: (handlers, note) => markdownSelectedNoteCommandEnabled(note, handlers.onToggleNoteWidth)
      && note?.noteWidth === 'wide',
    execute: (handlers) => handlers.onToggleNoteWidth,
    group: 'View',
    id: 'set-note-width-normal',
    kind: 'dynamic',
    keywords: ['layout', 'note', 'column', 'width', 'normal', 'reading'],
    label: 'command.view.noteWidthNormal',
  },
]

export function selectedNoteCommands(handlers: MobileCommandPaletteHandlers): MobileCommandPaletteCommand[] {
  const note = handlers.selectedNote

  return selectedNoteCommandSpecs.map((spec) => selectedNoteCommand(spec, handlers, note))
}

export function selectedNoteCommand(
  spec: SelectedNoteCommandSpec,
  handlers: MobileCommandPaletteHandlers,
  note: MobileNote | null,
): MobileCommandPaletteCommand {
  const config = {
    enabled: spec.enabled(handlers, note),
    execute: spec.execute(handlers, note),
    group: spec.group ?? 'Note',
    keywords: spec.keywords,
    label: mobileText(selectedNoteCommandLabel(spec.label, note)),
  }

  if (spec.kind === 'desktop') {
    return command({ ...config, desktopCommand: spec.desktopCommand })
  }

  return dynamicCommand({ ...config, id: spec.id })
}

export function selectedNoteCommandLabel(
  label: SelectedNoteCommandLabel,
  note: MobileNote | null,
): MobileTextKey {
  return typeof label === 'function' ? label(note) : label
}

export function hasSelectedNote(note: MobileNote | null): boolean {
  return note !== null
}

export function isMarkdownSelectedNote(note: MobileNote | null): boolean {
  return isMobileMarkdownActionNote(note)
}

export function isNonMarkdownSelectedNote(note: MobileNote | null): boolean {
  return isMobileNonMarkdownActionNote(note)
}

export function isTextLikeSelectedNote(note: MobileNote | null): boolean {
  return isMobileTextLikeActionNote(note)
}

export function selectedNoteCommandEnabled(
  note: MobileNote | null,
  handler: unknown,
): boolean {
  return hasSelectedNote(note) && handler !== undefined
}

export function markdownSelectedNoteCommandEnabled(
  note: MobileNote | null,
  handler: unknown,
): boolean {
  return isMarkdownSelectedNote(note) && handler !== undefined
}

export function nonMarkdownSelectedNoteCommandEnabled(
  note: MobileNote | null,
  handler: unknown,
): boolean {
  return isNonMarkdownSelectedNote(note) && handler !== undefined
}

export function textLikeSelectedNoteCommandEnabled(
  note: MobileNote | null,
  handler: unknown,
): boolean {
  return isTextLikeSelectedNote(note) && handler !== undefined
}

export function markdownSelectedNoteIconCommandEnabled(
  note: MobileNote | null,
  handler: unknown,
): boolean {
  return isMarkdownSelectedNote(note) && typeof note?.icon === 'string' && note.icon.length > 0 && handler !== undefined
}

export function saveSelectedNote(
  handlers: MobileCommandPaletteHandlers,
  note: MobileNote | null,
): (() => void) | undefined {
  if (!isTextLikeSelectedNote(note)) return undefined
  if (handlers.onSaveActiveEditor) return handlers.onSaveActiveEditor

  const saveContent = handlers.onUpdateNoteContent
  if (!note || saveContent === undefined) return undefined
  return () => saveContent(note.id, note.rawContent ?? '')
}

export function setSelectedNoteOrganized(
  handlers: MobileCommandPaletteHandlers,
  note: MobileNote | null,
): (() => void) | undefined {
  if (!note) return undefined
  return () => handlers.onSetOrganized(!note.organized)
}

export function setSelectedNoteArchived(
  handlers: MobileCommandPaletteHandlers,
  note: MobileNote | null,
): (() => void) | undefined {
  if (!note) return undefined
  return () => handlers.onSetArchived(!note.archived)
}

export function openSelectedNeighborhood(
  handlers: MobileCommandPaletteHandlers,
  note: MobileNote | null,
): (() => void) | undefined {
  const openNeighborhood = handlers.onEnterNeighborhood
  if (!note || !isTextLikeSelectedNote(note) || openNeighborhood === undefined) return undefined
  return () => openNeighborhood(note.id)
}

export function favoriteLabelKey(note: MobileNote | null) {
  return note?.favorite ? 'command.note.removeFavorite' : 'command.note.addFavorite'
}

export function organizedLabelKey(note: MobileNote | null) {
  return note?.organized ? 'command.note.markUnorganized' : 'command.note.markOrganized'
}

export function archiveLabelKey(note: MobileNote | null) {
  return note?.archived ? 'command.note.unarchiveNote' : 'command.note.archiveNote'
}
