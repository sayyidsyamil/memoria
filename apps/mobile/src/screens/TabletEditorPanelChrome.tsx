import { useMobileStyles, useMobileColors } from '../ui/theme/useMobileTheme'
import { ArrowClockwise, FileText, WarningCircle } from 'phosphor-react-native'
import { ScrollView, View } from 'react-native'
import { MobileTypeIcon } from '../components/workspace/MobileWorkspaceIcons'
import { Text } from '../components/ui/text'
import { mobileText } from '../i18n/mobileText'
import { MobilePanel, MobileToolbar, MobileToolbarTitle } from '../ui/MobilePanel'
import { MobileButton } from '../ui/MobileButton'
import { desktopToolbarActionParity } from '../ui/desktopParity'

import type { MobileNote, MobileTypeDefinitions } from '../workspace/mobileWorkspaceModel'
import { createEditorPanelStyles } from './TabletEditorPanelStyles'
import type { MobileNoteReadState } from '../workspace/mobileNoteRead'

export function MobileNoteReadFallback({ note, state }: { note: MobileNote; state: MobileNoteReadState }) {
  const themeStyles = useMobileStyles(createEditorPanelStyles)
  const { panelStyles } = themeStyles
  const mobileColors = useMobileColors()
  const failed = state.status === 'error'
  if (!failed) {
    return (
      <ScrollView contentContainerStyle={[panelStyles.content, { flexGrow: 1 }]} style={panelStyles.editorHost}
        testID="note-read-loading">
        <Text style={[panelStyles.filePreviewTitle, { textAlign: 'left', width: '100%' }]}>{note.title}</Text>
        <Text style={[panelStyles.filePreviewDescription, { textAlign: 'left', width: '100%' }]}>{note.snippet}</Text>
      </ScrollView>
    )
  }
  return (
    <View style={panelStyles.emptyState} testID="note-read-error">
      <View style={panelStyles.filePreviewFallback} accessibilityLiveRegion="polite">
        <WarningCircle size={24} color={mobileColors.textMuted} />
        <Text style={panelStyles.filePreviewDescription}>{mobileText('mobile.editor.readFailed')}</Text>
        <MobileButton icon={<ArrowClockwise size={16} color={mobileColors.textMuted} />}
          label={mobileText('pulse.retry')} onPress={state.retry} testID="note-read-retry" />
      </View>
    </View>
  )
}

export function MobileFilePreviewFallback({
  note,
  typeDefinitions,
}: {
  note: MobileNote
  typeDefinitions?: MobileTypeDefinitions
}) {
  const themeStyles = useMobileStyles(createEditorPanelStyles)
  const { panelStyles } = themeStyles
  return (
    <View style={panelStyles.filePreviewFallback} testID="file-preview-fallback">
      <MobileTypeIcon
        fileKind={note.fileKind}
        size={32}
        tone={note.typeTone}
        type={note.type}
        typeDefinitions={typeDefinitions}
      />
      <Text style={panelStyles.filePreviewTitle}>{mobileText('filePreview.previewUnavailable')}</Text>
      <Text style={panelStyles.filePreviewDescription}>{mobileText('filePreview.previewUnavailableDescription')}</Text>
    </View>
  )
}

export function EmptyEditorPanel() {
  const themeStyles = useMobileStyles(createEditorPanelStyles)
  const { panelStyles } = themeStyles
  const mobileColors = useMobileColors()
  return (
    <MobilePanel style={panelStyles.panel} testID="editor-panel">
      <MobileToolbar testID="editor-toolbar">
        <FileText color={mobileColors.textMuted} size={desktopToolbarActionParity.iconSize} />
        <MobileToolbarTitle testID="editor-toolbar-title" title={mobileText('inspector.empty.noNoteSelected')} />
      </MobileToolbar>
      <View style={panelStyles.emptyState}>
        <Text style={panelStyles.emptyTitle}>{mobileText('editor.empty.selectNote')}</Text>
      </View>
    </MobilePanel>
  )
}

export function MobileSpreadsheetFallback() {
  const { panelStyles } = useMobileStyles(createEditorPanelStyles)
  const colors = useMobileColors()
  return (
    <View style={[panelStyles.emptyState, { backgroundColor: colors.sidebar }]}
      testID="spreadsheet-unsupported" accessibilityState={{ disabled: true }}>
      <Text style={panelStyles.filePreviewDescription}>
        {mobileText('mobile.editor.spreadsheetUnsupported')}
      </Text>
    </View>
  )
}
