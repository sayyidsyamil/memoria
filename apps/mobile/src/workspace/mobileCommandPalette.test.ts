import { describe, expect, it, vi } from 'vitest'
import { requiredFixture } from '../fixtures/requiredFixture'
import appCommandManifest from '../../../../src/shared/appCommandManifest.json'
import { workspaceScenarios } from '../fixtures/workspaceFixtures'
import {
  buildMobileCommandPaletteCommands,
  mobileCommandPaletteResults,
  mobilePrimarySidebarSelection,
  type MobileCommandPaletteHandlers,
} from './mobileCommandPalette'
import type { MobileNote } from './mobileWorkspaceModel'

describe('mobile command palette', () => {
  it('builds mobile commands from shared desktop command ids and excludes explicit out-of-scope commands', () => {
    const commands = buildMobileCommandPaletteCommands(commandHandlers())
    const commandIds = commands.map((command) => command.id)

    expect(commandIds).toContain(appCommandManifest.commands.fileQuickOpen.id)
    expect(commandIds).toContain(appCommandManifest.commands.fileNewNote.id)
    expect(commandIds).toContain(appCommandManifest.commands.editPastePlainText.id)
    expect(commandIds).toContain(appCommandManifest.commands.viewCommandPalette.id)
    expect(commandIds).toContain(appCommandManifest.commands.viewGoBack.id)
    expect(commandIds).toContain(appCommandManifest.commands.viewGoForward.id)
    expect(commandIds).toContain(appCommandManifest.commands.viewToggleProperties.id)
    expect(commandIds).toContain(appCommandManifest.commands.vaultOpen.id)
    expect(commandIds).toContain(appCommandManifest.commands.vaultReload.id)
    expect(commandIds).not.toContain(appCommandManifest.commands.vaultCommitPush.id)
    expect(commandIds).not.toContain(appCommandManifest.commands.viewToggleAiChat.id)
  })

  it('exposes the desktop reload-vault command through the mobile command palette', () => {
    const handlers = commandHandlers()
    const reload = enabledCommand(handlers, appCommandManifest.commands.vaultReload.id)

    expect(reload).toMatchObject({
      desktopCommand: 'vaultReload',
      group: 'Settings',
      label: 'Reload Vault',
    })

    reload.execute()

    expect(handlers.onReloadVault).toHaveBeenCalledOnce()
  })

  it('exposes the desktop command-palette command through the mobile command system', () => {
    const handlers = commandHandlers()
    const commandPalette = enabledCommand(handlers, appCommandManifest.commands.viewCommandPalette.id)

    expect(commandPalette).toMatchObject({
      desktopCommand: 'viewCommandPalette',
      group: 'View',
      label: 'Command Palette',
      shortcut: '⌘K',
    })

    commandPalette.execute()

    expect(handlers.onOpenCommandPalette).toHaveBeenCalledOnce()
  })

  it('uses desktop primary sidebar selections for navigation commands', () => {
    const handlers = commandHandlers()
    const allNotes = enabledCommand(handlers, appCommandManifest.commands.goAllNotes.id)

    allNotes.execute()

    expect(handlers.onSelectSidebarItem).toHaveBeenCalledWith(
      expect.objectContaining({
        count: '8846',
        id: 'all-notes',
        label: 'All Notes',
        sectionId: 'primary',
      }),
    )
  })

  it('exposes desktop back and forward commands when workspace history is available', () => {
    const handlers = commandHandlers()
    const goBack = enabledCommand(handlers, appCommandManifest.commands.viewGoBack.id)
    const goForward = enabledCommand(handlers, appCommandManifest.commands.viewGoForward.id)

    expect(goBack).toMatchObject({
      desktopCommand: 'viewGoBack',
      group: 'Navigation',
      label: 'Go Back',
    })
    expect(goForward).toMatchObject({
      desktopCommand: 'viewGoForward',
      group: 'Navigation',
      label: 'Go Forward',
    })

    goBack.execute()
    goForward.execute()

    expect(handlers.onGoBack).toHaveBeenCalledOnce()
    expect(handlers.onGoForward).toHaveBeenCalledOnce()
  })

  it('keeps desktop back and forward out of results before history exists', () => {
    const handlers = commandHandlers({ canGoBack: false, canGoForward: false })
    const commandIds = mobileCommandPaletteResults(buildMobileCommandPaletteCommands(handlers), '')
      .flatList
      .map((command) => command.id)

    expect(commandIds).not.toContain(appCommandManifest.commands.viewGoBack.id)
    expect(commandIds).not.toContain(appCommandManifest.commands.viewGoForward.id)
  })

  it('exposes desktop-style type section navigation commands', () => {
    const handlers = commandHandlers()
    const commands = buildMobileCommandPaletteCommands(handlers)
    const essayCommand = commands.find((command) => command.id === 'list-essay')

    expect(essayCommand).toMatchObject({
      enabled: true,
      group: 'Navigation',
      label: 'List Essays',
    })

    essayCommand?.execute()

    expect(handlers.onSelectSidebarItem).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'essays',
        label: 'Essays',
        sectionId: 'types',
        typeName: 'Essay',
      }),
    )
  })

  it('exposes desktop-style typed note creation commands', () => {
    const handlers = commandHandlers()
    const commands = buildMobileCommandPaletteCommands(handlers)
    const essayCommand = commands.find((command) => command.id === 'new-essay')

    expect(essayCommand).toMatchObject({
      enabled: true,
      group: 'Note',
      label: 'New Essay',
    })

    essayCommand?.execute()

    expect(handlers.onCreateNoteOfType).toHaveBeenCalledWith('Essay')
  })

  it('canonicalizes Type command names when older sidebar items only carry display labels', () => {
    const handlers = commandHandlers({
      snapshot: {
        ...workspaceScenarios.default,
        sidebarSections: workspaceScenarios.default.sidebarSections.map((section) => (
          section.id === 'types'
            ? {
              ...section,
              items: [
                { count: '3', icon: 'file', id: 'people', label: 'People' },
                { count: '2', icon: 'tag', id: 'responsibilities', label: 'Responsibilities' },
              ],
            }
            : section
        )),
      },
    })
    const commands = buildMobileCommandPaletteCommands(handlers)

    const listPeople = commands.find((command) => command.id === 'list-person')
    const newPerson = commands.find((command) => command.id === 'new-person')
    const newResponsibility = commands.find((command) => command.id === 'new-responsibility')

    expect(listPeople).toMatchObject({
      enabled: true,
      group: 'Navigation',
      label: 'List People',
    })
    expect(commands.map((command) => command.id)).not.toContain('new-people')
    expect(newPerson).toMatchObject({ label: 'New Person' })
    expect(newResponsibility).toMatchObject({ label: 'New Responsibility' })

    newPerson?.execute()
    newResponsibility?.execute()

    expect(handlers.onCreateNoteOfType).toHaveBeenCalledWith('Person')
    expect(handlers.onCreateNoteOfType).toHaveBeenCalledWith('Responsibility')
  })

  it('exposes the desktop current-folder note creation command when a folder is selected', () => {
    const handlers = commandHandlers({ activeFolderId: 'Writing/Essays' })
    const command = enabledCommand(handlers, 'create-note-current-folder')

    expect(command).toMatchObject({
      group: 'Note',
      label: 'Create New Note in Current Folder',
    })

    command.execute()

    expect(handlers.onCreateNote).toHaveBeenCalledWith('')
  })

  it('exposes desktop-style selected folder commands', () => {
    const handlers = commandHandlers({ activeFolderId: 'Memoria/Mobile UI' })
    const reveal = enabledCommand(handlers, 'reveal-selected-folder')
    const copyPath = enabledCommand(handlers, 'copy-selected-folder-path')
    const rename = enabledCommand(handlers, 'rename-folder')
    const deleteFolder = enabledCommand(handlers, 'delete-folder')

    expect(reveal).toMatchObject({
      group: 'Navigation',
      label: 'Reveal in Finder',
    })
    expect(copyPath).toMatchObject({
      group: 'Navigation',
      label: 'Copy folder path',
    })
    expect(rename).toMatchObject({ label: 'Rename Folder' })
    expect(deleteFolder).toMatchObject({ label: 'Delete Folder' })

    reveal.execute()
    copyPath.execute()
    rename.execute()
    deleteFolder.execute()

    expect(handlers.onRevealSelectedFolder).toHaveBeenCalledOnce()
    expect(handlers.onCopySelectedFolderPath).toHaveBeenCalledOnce()
    expect(handlers.onOpenFolderActions).toHaveBeenCalledWith({
      id: 'Memoria/Mobile UI',
      name: 'Mobile UI',
    })
    expect(handlers.onDeleteSelectedFolder).toHaveBeenCalledOnce()
  })

  it('exposes desktop-style section filter commands when note-list filters are visible', () => {
    const handlers = commandHandlers({ noteListFilter: 'open', noteListFilterVisible: true })
    const results = mobileCommandPaletteResults(buildMobileCommandPaletteCommands(handlers), '')
    const commandIds = results.flatList.map((command) => command.id)

    expect(commandIds).toContain('filter-archived')
    expect(commandIds).not.toContain('filter-open')

    enabledCommand(handlers, 'filter-archived').execute()

    expect(handlers.onNoteListFilterChange).toHaveBeenCalledWith('archived')
  })

  it('opens active list customization from the command palette', () => {
    const primaryHandlers = commandHandlers({ activeItemId: 'all-notes' })
    const primaryCommand = enabledCommand(primaryHandlers, 'customize-note-list-columns')

    expect(primaryCommand).toMatchObject({
      group: 'View',
      label: 'Customize All Notes columns',
    })

    primaryCommand.execute()

    expect(primaryHandlers.onOpenPrimaryActions).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'all-notes',
        sectionId: 'primary',
      }),
    )

    const typeHandlers = commandHandlers({ activeItemId: 'essays' })
    const typeCommand = enabledCommand(typeHandlers, 'customize-note-list-columns')

    expect(typeCommand).toMatchObject({
      label: 'Customize columns',
    })

    typeCommand.execute()

    expect(typeHandlers.onOpenTypeActions).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'essays',
        sectionId: 'types',
        typeName: 'Essay',
      }),
    )

    const viewHandlers = commandHandlers({ activeItemId: 'view-active-procedures' })
    const viewCommand = enabledCommand(viewHandlers, 'customize-note-list-columns')

    expect(viewCommand).toMatchObject({
      label: 'Customize Active Procedures columns',
    })

    viewCommand.execute()

    expect(viewHandlers.onOpenViewActions).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'view-active-procedures',
        sectionId: 'views',
      }),
    )
  })

  it('exposes desktop-style selected saved-view movement commands', () => {
    const handlers = commandHandlers({
      activeItemId: 'view-active-procedures',
      canMoveSelectedViewDown: true,
      canMoveSelectedViewUp: true,
    })

    const moveUp = enabledCommand(handlers, 'move-view-up')
    const moveDown = enabledCommand(handlers, 'move-view-down')

    expect(moveUp).toMatchObject({ label: 'Move Active Procedures Up' })
    expect(moveDown).toMatchObject({ label: 'Move Active Procedures Down' })

    moveUp.execute()
    moveDown.execute()

    expect(handlers.onMoveSelectedViewUp).toHaveBeenCalledOnce()
    expect(handlers.onMoveSelectedViewDown).toHaveBeenCalledOnce()
  })

  it('exposes desktop default note-width commands through the mobile command palette', () => {
    const handlers = commandHandlers({ defaultNoteWidth: 'normal' })
    const setWide = enabledCommand(handlers, 'set-default-note-width-wide')
    const commandIds = mobileCommandPaletteResults(buildMobileCommandPaletteCommands(handlers), '')
      .flatList
      .map((command) => command.id)

    expect(setWide).toMatchObject({
      group: 'View',
      label: 'Use Wide Note Width by Default',
    })
    expect(commandIds).not.toContain('set-default-note-width-normal')

    setWide.execute()

    expect(handlers.onSetDefaultNoteWidth).toHaveBeenCalledWith('wide')
  })

  it('offers normal default note width when the persisted default is wide', () => {
    const handlers = commandHandlers({ defaultNoteWidth: 'wide' })
    const setNormal = enabledCommand(handlers, 'set-default-note-width-normal')

    expect(setNormal).toMatchObject({
      group: 'View',
      label: 'Use Normal Note Width by Default',
    })

    setNormal.execute()

    expect(handlers.onSetDefaultNoteWidth).toHaveBeenCalledWith('normal')
  })

  it('exposes selected markdown note utility commands through the palette', () => {
    const handlers = commandHandlers()
    const commandIds = mobileCommandPaletteResults(buildMobileCommandPaletteCommands(handlers), '')
      .flatList
      .map((command) => command.id)

    expect(commandIds).toEqual(expect.arrayContaining([
      'copy-active-file-path',
      'reveal-active-file',
      'open-active-neighborhood',
      'rename-active-file',
      'rename-active-file-to-title',
      'set-note-width-wide',
    ]))

    enabledCommand(handlers, 'copy-active-file-path').execute()
    enabledCommand(handlers, 'reveal-active-file').execute()
    enabledCommand(handlers, 'open-active-neighborhood').execute()

    expect(handlers.onCopyFilePath).toHaveBeenCalledOnce()
    expect(handlers.onRevealFile).toHaveBeenCalledOnce()
    expect(handlers.onEnterNeighborhood).toHaveBeenCalledWith(handlers.selectedNote?.id)
  })

  it('keeps non-markdown file commands aligned with the mobile More sheet', () => {
    const textFile = selectedFile({ fileKind: 'text', id: 'Files/config.yml', path: 'Files/config.yml', title: 'config.yml' })
    const binaryFile = selectedFile({ fileKind: 'binary', id: 'Files/diagram.png', path: 'Files/diagram.png', title: 'diagram.png' })
    const textCommandIds = mobileCommandPaletteResults(
      buildMobileCommandPaletteCommands(commandHandlers({ selectedNote: textFile })),
      '',
    ).flatList.map((command) => command.id)
    const binaryCommandIds = mobileCommandPaletteResults(
      buildMobileCommandPaletteCommands(commandHandlers({ selectedNote: binaryFile })),
      '',
    ).flatList.map((command) => command.id)

    expect(textCommandIds).toContain('open-active-file-external')
    expect(textCommandIds).toContain('open-active-neighborhood')
    expect(textCommandIds).toContain(appCommandManifest.commands.fileSave.id)
    expect(textCommandIds).toContain(appCommandManifest.commands.editFindInNote.id)
    expect(textCommandIds).toContain(appCommandManifest.commands.editReplaceInNote.id)
    expect(textCommandIds).not.toContain('change-note-type')
    expect(textCommandIds).not.toContain(appCommandManifest.commands.editToggleRawEditor.id)
    expect(textCommandIds).not.toContain(appCommandManifest.commands.viewToggleTableOfContents.id)
    expect(textCommandIds).not.toContain('set-note-width-wide')
    expect(binaryCommandIds).toContain('open-active-file-external')
    expect(binaryCommandIds).not.toContain(appCommandManifest.commands.fileSave.id)
    expect(binaryCommandIds).not.toContain(appCommandManifest.commands.editFindInNote.id)
    expect(binaryCommandIds).not.toContain(appCommandManifest.commands.editReplaceInNote.id)
    expect(binaryCommandIds).not.toContain(appCommandManifest.commands.editToggleRawEditor.id)
    expect(binaryCommandIds).not.toContain(appCommandManifest.commands.viewToggleTableOfContents.id)
    expect(binaryCommandIds).not.toContain('open-active-neighborhood')
  })

  it('filters enabled commands by label, keyword, and group with desktop-like fuzzy ranking', () => {
    const handlers = commandHandlers()
    const commands = buildMobileCommandPaletteCommands(handlers)

    expect(mobileCommandPaletteResults(commands, 'pdf').flatList.map((command) => command.id)).toEqual([
      appCommandManifest.commands.noteExportPdf.id,
    ])
    expect(mobileCommandPaletteResults(commands, 'folder').flatList.map((command) => command.id)).toContain('move-note-to-folder')
    expect(mobileCommandPaletteResults(commands, 'settings').groups.map((group) => group.group)).toEqual(['Settings'])
  })

  it('keeps unavailable commands out of the executable results', () => {
    const handlers = commandHandlers({ selectedNote: null, canUndoWorkspaceEdit: false })
    const results = mobileCommandPaletteResults(buildMobileCommandPaletteCommands(handlers), '')
    const commandIds = results.flatList.map((command) => command.id)

    expect(commandIds).not.toContain(appCommandManifest.commands.noteDelete.id)
    expect(commandIds).not.toContain(appCommandManifest.commands.editUndo.id)
    expect(commandIds).not.toContain(appCommandManifest.commands.editFindInNote.id)
    expect(commandIds).not.toContain(appCommandManifest.commands.editReplaceInNote.id)
    expect(commandIds).toContain(appCommandManifest.commands.fileNewNote.id)
  })

  it('dispatches paste-without-formatting only when the active editor registers it', () => {
    const handlers = commandHandlers()
    const command = enabledCommand(handlers, appCommandManifest.commands.editPastePlainText.id)

    command.execute()

    expect(handlers.onPastePlainText).toHaveBeenCalledOnce()

    const commandIdsWithoutEditor = mobileCommandPaletteResults(
      buildMobileCommandPaletteCommands(commandHandlers({ onPastePlainText: undefined })),
      '',
    ).flatList.map((candidate) => candidate.id)

    expect(commandIdsWithoutEditor).not.toContain(appCommandManifest.commands.editPastePlainText.id)
  })

  it('prefers the active editor save command over stale snapshot content', () => {
    const handlers = commandHandlers()
    const command = enabledCommand(handlers, appCommandManifest.commands.fileSave.id)

    command.execute()

    expect(handlers.onSaveActiveEditor).toHaveBeenCalledOnce()
    expect(handlers.onUpdateNoteContent).not.toHaveBeenCalled()
  })

  it('keeps save available when only the active editor save command exists', () => {
    const handlers = commandHandlers({ onUpdateNoteContent: undefined })
    const command = enabledCommand(handlers, appCommandManifest.commands.fileSave.id)

    command.execute()

    expect(handlers.onSaveActiveEditor).toHaveBeenCalledOnce()
  })

  it('dispatches the desktop raw-editor toggle through the active editor chrome command', () => {
    const handlers = commandHandlers()
    const command = enabledCommand(handlers, appCommandManifest.commands.editToggleRawEditor.id)

    command.execute()

    expect(handlers.onToggleRawEditor).toHaveBeenCalledOnce()
  })

  it('falls back to snapshot content when no editor save command is registered', () => {
    const handlers = commandHandlers({ onSaveActiveEditor: undefined })
    const command = enabledCommand(handlers, appCommandManifest.commands.fileSave.id)
    const selectedNote = requiredFixture(handlers.selectedNote)

    command.execute()

    expect(handlers.onUpdateNoteContent).toHaveBeenCalledWith(selectedNote.id, selectedNote.rawContent ?? '')
  })

  it('normalizes primary sidebar selections from the snapshot', () => {
    expect(mobilePrimarySidebarSelection(workspaceScenarios.default, 'inbox')).toEqual(
      expect.objectContaining({
        count: '7',
        id: 'inbox',
        label: 'Inbox',
        sectionId: 'primary',
      }),
    )
  })
})

function enabledCommand(handlers: MobileCommandPaletteHandlers, id: string) {
  const command = buildMobileCommandPaletteCommands(handlers).find((candidate) => candidate.id === id)
  expect(command?.enabled).toBe(true)
  return requiredFixture(command)
}

function commandHandlers(
  overrides: Partial<MobileCommandPaletteHandlers> = {},
): MobileCommandPaletteHandlers {
  const selectedNote = workspaceScenarios.default.notes[0] ?? null
  const handlers: MobileCommandPaletteHandlers = {
    ...workspaceCommandHandlers(),
    ...editorCommandHandlers(),
    canRedoWorkspaceEdit: true,
    canUndoWorkspaceEdit: true,
    canGoBack: true,
    canGoForward: true,
    noteListFilter: 'open',
    noteListFilterVisible: false,
    selectedNote,
    snapshot: workspaceScenarios.default,
  }
  return Object.assign(handlers, overrides)
}

function workspaceCommandHandlers() {
  return {
    onCopyDeepLink: vi.fn(),
    onCopyFilePath: vi.fn(),
    onCopySelectedFolderPath: vi.fn(),
    onCreateNote: vi.fn(),
    onCreateNoteOfType: vi.fn(),
    onDeleteSelectedFolder: vi.fn(),
    onDeleteNote: vi.fn(),
    onEnterNeighborhood: vi.fn(),
    onExportNoteAsPdf: vi.fn(),
    onGoBack: vi.fn(),
    onGoForward: vi.fn(),
    onOpenBacklinks: vi.fn(),
    onOpenChangeNoteType: vi.fn(),
    onOpenCommandPalette: vi.fn(),
    onOpenCreateNote: vi.fn(),
    onOpenCreateType: vi.fn(),
    onOpenFindInNote: vi.fn(),
    onOpenFileInDefaultApp: vi.fn(),
    onOpenFolderActions: vi.fn(),
    onOpenMoveNoteToFolder: vi.fn(),
    onOpenNativeVault: vi.fn(),
    onOpenPrimaryActions: vi.fn(),
    onOpenReplaceInNote: vi.fn(),
    onOpenRenameNoteFile: vi.fn(),
    onOpenSearch: vi.fn(),
    onOpenSetNoteIcon: vi.fn(),
    onOpenTableOfContents: vi.fn(),
    onOpenTypeActions: vi.fn(),
    onOpenViewActions: vi.fn(),
  }
}

function editorCommandHandlers() {
  return {
    onMoveSelectedViewDown: vi.fn(),
    onMoveSelectedViewUp: vi.fn(),
    onNoteListFilterChange: vi.fn(),
    onPastePlainText: vi.fn(),
    onRedoWorkspaceEdit: vi.fn(),
    onReloadVault: vi.fn(),
    onRemoveNoteIcon: vi.fn(),
    onRenameNoteFileToTitle: vi.fn(),
    onRevealFile: vi.fn(),
    onRevealSelectedFolder: vi.fn(),
    onSaveActiveEditor: vi.fn(),
    onSelectSidebarItem: vi.fn(),
    onSetArchived: vi.fn(),
    onSetDefaultNoteWidth: vi.fn(),
    onSetOrganized: vi.fn(),
    onToggleFavorite: vi.fn(),
    onToggleNoteWidth: vi.fn(),
    onToggleRawEditor: vi.fn(),
    onToggleProperties: vi.fn(),
    onUndoWorkspaceEdit: vi.fn(),
    onUpdateNoteContent: vi.fn(),
    onViewAll: vi.fn(),
    onViewEditorList: vi.fn(),
    onViewEditorOnly: vi.fn(),
  }
}

function selectedFile(overrides: Partial<MobileNote>): MobileNote {
  return {
    ...requiredFixture(workspaceScenarios.default.notes[0]),
    ...overrides,
  }
}
