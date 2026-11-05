import { useMemo, useState, type ReactNode } from 'react'
import { Dimensions, Platform, StyleSheet, View, useWindowDimensions } from 'react-native'
import { MobileWorkspaceSidebar } from './MobileWorkspaceSidebar'
import { MobileNoteListPanel } from './MobileNoteListPanel'
import { MobilePanelSafeArea } from '../../ui/MobilePanelSafeArea'
import { useMobileDeviceLayout } from '../../ui/useMobileDeviceLayout'
import { useMobileStyles } from '../../ui/theme/useMobileTheme'
import type { MobileColors } from '../../ui/theme/mobilePalette'
import type { MobileMetrics } from '../../ui/mobileMetrics'
import { tabletScreenModeForWindow } from '../../screens/tabletWorkspaceScreenMode'
import { MobileVaultDisplayContext } from '../../workspace/MobileVaultContext'
import type { WorkspaceSnapshotPreview } from '../../workspace/workspaceSnapshotPreview'
import { recordNativeStartupPreviewLayout } from '../../qa/nativeStartupPresentation'
import { initialSidebarSelection, notesForSidebarSelection, noteListFilterCountsForSelection,
  noteListPropertiesForSelection, shouldShowNoteListFilter } from '../../screens/tabletWorkspaceNavigationSelectors'
import type { TabletSidebarSelection } from '../../screens/tabletWorkspaceNavigation'
import type { MobileNoteListFilter } from '../../workspace/mobileNoteFilters'
import { useMobileAnalytics } from '../../analytics/useMobileAnalytics'

export function MobileWorkspaceStartup({ children, preview, pending, hasActiveWorkspace, onSelectNote = ignorePreviewAction }: {
  children: ReactNode
  preview: WorkspaceSnapshotPreview | null
  pending: boolean
  hasActiveWorkspace: boolean
  onSelectNote?: (noteId: string) => void
}) {
  if (!preview || hasActiveWorkspace) return children
  return <MobileVaultDisplayContext.Provider value={{ source: 'native', rootUri: preview.source?.vaultPath }}>
    <StartupPanels preview={preview} pending={pending} onSelectNote={onSelectNote} />
  </MobileVaultDisplayContext.Provider>
}

const ignorePreviewAction = () => undefined

function StartupPanels({ preview, pending, onSelectNote }: { preview: WorkspaceSnapshotPreview; pending: boolean; onSelectNote: (noteId: string) => void }) {
  const tablet = useMobileDeviceLayout() === 'tablet'
  const { width, height } = useWindowDimensions()
  const screen = Dimensions.get('screen')
  const mode = tabletScreenModeForWindow({ width, height, screenWidth: screen.width, screenHeight: screen.height,
    nativeIpad: Platform.OS === 'ios' && Platform.isPad })
  const { styles } = useMobileStyles(createThemeStyles)
  const navigation = useStartupNavigation(preview)
  const showSidebar = tablet && mode.defaultSidebarVisible
  return <View style={styles.root} testID="workspace-startup-preview" onLayout={recordNativeStartupPreviewLayout}
    accessibilityState={{ busy: pending }}>
    <View style={styles.cached} testID="workspace-startup-cached-panels">
      {showSidebar && <StartupSidebar preview={preview} navigation={navigation} />}
      <View style={tablet ? styles.noteList : styles.phoneList}><MobilePanelSafeArea>
        <CachedNoteList preview={preview} tablet={tablet} compact={!tablet || mode.compactTablet}
          navigation={navigation} onSelectNote={onSelectNote} />
      </MobilePanelSafeArea></View>
      {tablet && <View style={styles.editor} />}
    </View>
  </View>
}

function StartupSidebar({ preview, navigation }: { preview: WorkspaceSnapshotPreview; navigation: ReturnType<typeof useStartupNavigation> }) {
  const { styles } = useMobileStyles(createThemeStyles)
  return <View style={styles.sidebar}><MobilePanelSafeArea sidebar>
    <MobileWorkspaceSidebar sections={preview.sidebarSections} title={preview.source?.label}
      activeItemId={navigation.selection.kind === 'item' ? navigation.selection.id : null}
      activeFolderId={navigation.selection.kind === 'folder' ? navigation.selection.id : null}
      onSelectItem={item => navigation.select({ ...item, kind: 'item' })}
      onSelectFolder={folder => navigation.select({ id: folder.id, label: folder.name, kind: 'folder' })} />
  </MobilePanelSafeArea></View>
}

type CachedNoteListProps = { preview: WorkspaceSnapshotPreview; tablet: boolean; compact: boolean
  navigation: ReturnType<typeof useStartupNavigation>; onSelectNote: (noteId: string) => void }

function CachedNoteList(props: CachedNoteListProps) {
  const { preview, tablet, compact, navigation, onSelectNote } = props
  const analytics = useMobileAnalytics()
  return <MobileNoteListPanel compact={compact} fullWidth={!tablet} notes={navigation.notes} selectedNoteId={preview.selectedNoteId ?? null}
    subtitle={preview.noteListSubtitle} title={navigation.selection.label} typeDefinitions={preview.typeDefinitions}
    displayPropertyKeys={noteListPropertiesForSelection(preview, navigation.selection)} propertyDisplayModes={preview.vaultConfig?.propertyDisplayModes}
    showCreateAction={false} noteListFilter={navigation.filter} noteListFilterVisible={shouldShowNoteListFilter(navigation.selection)}
    noteListFilterCounts={noteListFilterCountsForSelection(preview, navigation.selection)} onNoteListFilterChange={navigation.setFilter}
    onOpenCreateNote={ignorePreviewAction} onOpenSearch={ignorePreviewAction} onSelectNote={noteId => {
      analytics.capture({ name: 'mobile_startup_preview_used' })
      onSelectNote(noteId)
    }} />
}

function useStartupNavigation(preview: WorkspaceSnapshotPreview) {
  const [selection, setSelection] = useState<TabletSidebarSelection>(() => initialSidebarSelection(preview))
  const [filter, setFilter] = useState<MobileNoteListFilter>('open')
  const notes = useMemo(() => notesForSidebarSelection(preview, selection, { noteListFilter: filter }), [preview, selection, filter])
  return { selection, filter, setFilter, notes, select: (next: TabletSidebarSelection) => { setFilter('open'); setSelection(next) } }
}

function createThemeStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: mobileColors.card },
    cached: { flex: 1, flexDirection: 'row' },
    sidebar: { width: metrics.panel.sidebarWidth },
    noteList: { width: metrics.panel.noteListWidth },
    phoneList: { flex: 1, minWidth: 0 },
    editor: { flex: 1, minWidth: 0 },
  })
  return { styles, mobileColors }
}
