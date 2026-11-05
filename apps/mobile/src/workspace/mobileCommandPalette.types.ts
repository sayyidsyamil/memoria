import type appCommandManifest from '../../../../src/shared/appCommandManifest.json'
import type { mobileText } from '../i18n/mobileText'
import type { MobileSidebarFolderSelection, MobileSidebarItemSelection } from '../components/workspace/MobileWorkspaceSidebar'
import type { MobileNote, MobileNoteWidth, MobileSidebarItem, MobileWorkspaceSnapshot } from './mobileWorkspaceModel'
import type { MobileNoteListFilter } from './mobileNoteFilters'

export type DesktopCommandKey = keyof typeof appCommandManifest.commands

export type MobileCommandGroup = 'Navigation' | 'Note' | 'View' | 'Settings'

export type MobileCommandPaletteCommand = {
  desktopCommand?: DesktopCommandKey
  enabled: boolean
  execute: () => void
  group: MobileCommandGroup
  id: string
  keywords: string[]
  label: string
  shortcut?: string
}

export type MobileCommandPaletteGroup = {
  group: MobileCommandGroup
  items: MobileCommandPaletteCommand[]
}

export type MobileCommandPaletteHandlers = {
  activeFolderId?: string | null
  activeItemId?: string | null
  canGoBack?: boolean
  canGoForward?: boolean
  canMoveSelectedViewDown?: boolean
  canMoveSelectedViewUp?: boolean
  canRedoWorkspaceEdit: boolean
  canUndoWorkspaceEdit: boolean
  defaultNoteWidth?: MobileNoteWidth | null
  onCreateNote?: (titleOverride?: string) => void
  onCreateNoteOfType?: (typeName: string) => void
  onOpenBacklinks?: () => void
  onOpenChangeNoteType?: () => void
  onOpenCommandPalette?: () => void
  onOpenCreateNote: () => void
  onOpenCreateType: () => void
  onCopyFilePath?: () => void
  onCopySelectedFolderPath?: () => void
  onOpenFindInNote: () => void
  onOpenFileInDefaultApp?: () => void
  onOpenFolderActions?: (selection: MobileSidebarFolderSelection) => void
  onOpenMoveNoteToFolder?: () => void
  onOpenNativeVault?: () => void
  onOpenReplaceInNote: () => void
  onOpenRenameNoteFile?: () => void
  onOpenSearch: () => void
  onOpenPrimaryActions?: (selection: MobileSidebarItemSelection) => void
  onOpenSetNoteIcon?: () => void
  onOpenTableOfContents: () => void
  onOpenTypeActions?: (selection: MobileSidebarItemSelection) => void
  onOpenViewActions?: (selection: MobileSidebarItemSelection) => void
  onMoveSelectedViewDown?: () => void
  onMoveSelectedViewUp?: () => void
  onDeleteSelectedFolder?: () => void
  onGoBack?: () => void
  onGoForward?: () => void
  onNoteListFilterChange?: (filter: MobileNoteListFilter) => void
  onPastePlainText?: () => void
  onCopyDeepLink?: () => void
  onDeleteNote: () => void
  onEnterNeighborhood?: (noteId: string) => void
  onExportNoteAsPdf?: () => void
  onReloadVault?: () => void
  onRemoveNoteIcon?: () => void
  onRenameNoteFileToTitle?: () => void
  onRedoWorkspaceEdit: () => void
  onRevealSelectedFolder?: () => void
  onRevealFile?: () => void
  onSaveActiveEditor?: () => void
  onSelectSidebarItem: (selection: MobileSidebarItemSelection) => void
  onSetArchived: (archived: boolean) => void
  onSetDefaultNoteWidth?: (mode: MobileNoteWidth) => void
  onSetOrganized: (organized: boolean) => void
  onToggleFavorite: () => void
  onToggleNoteWidth?: () => void
  onToggleProperties?: () => void
  onToggleRawEditor?: () => void
  onUndoWorkspaceEdit: () => void
  onUpdateNoteContent?: (noteId: string, content: string) => void
  onViewAll?: () => void
  onViewEditorList?: () => void
  onViewEditorOnly?: () => void
  noteListFilter?: MobileNoteListFilter
  noteListFilterVisible?: boolean
  selectedNote: MobileNote | null
  snapshot: MobileWorkspaceSnapshot
}

export type CommandConfig = {
  desktopCommand: DesktopCommandKey
  enabled?: boolean
  execute?: () => void
  group: MobileCommandGroup
  keywords: string[]
  label: string
}

export type DynamicCommandConfig = Omit<CommandConfig, 'desktopCommand'> & { id: string; shortcut?: string }

export type ActiveSidebarItem = MobileSidebarItem & { sectionId: string }

export type MobileTextKey = Parameters<typeof mobileText>[0]

export type SelectedNoteCommandExecutor = (
  handlers: MobileCommandPaletteHandlers,
  note: MobileNote | null,
) => (() => void) | undefined

export type SelectedNoteCommandPredicate = (
  handlers: MobileCommandPaletteHandlers,
  note: MobileNote | null,
) => boolean

export type SelectedNoteCommandLabel = MobileTextKey | ((note: MobileNote | null) => MobileTextKey)

export type SelectedNoteCommandSpec = {
  enabled: SelectedNoteCommandPredicate
  execute: SelectedNoteCommandExecutor
  group?: MobileCommandGroup
  keywords: string[]
  label: SelectedNoteCommandLabel
} & (
  | { desktopCommand: DesktopCommandKey; kind: 'desktop' }
  | { id: string; kind: 'dynamic' }
)
