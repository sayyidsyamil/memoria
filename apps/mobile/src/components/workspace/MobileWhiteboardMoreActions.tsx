import { useMobileStyles } from '../../ui/theme/useMobileTheme'
import { useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import { ScribbleLoop } from 'phosphor-react-native'
import { Text } from '../ui/text'
import { mobileText } from '../../i18n/mobileText'
import { desktopToolbarActionParity } from '../../ui/desktopParity'
import { MobileButton } from '../../ui/MobileButton'
import { MobileTextInput } from '../../ui/MobileTextInput'
import { mobileNoteEditableContent } from '../../workspace/mobileDocumentContent'
import { readMobileTldrawWhiteboards, updateMobileTldrawWhiteboard, type MobileTldrawWhiteboard } from '../../workspace/mobileTldrawWhiteboards'
import { addMobileTldrawTextShapeToSnapshot, canAddMobileTldrawTextShapeToSnapshot, readMobileTldrawTextShapesFromSnapshot, removeMobileTldrawTextShapeFromSnapshot, updateMobileTldrawTextShapeInSnapshot } from '../../workspace/mobileTldrawSnapshot'
import type { MobileEditorBlock, MobileNote } from '../../workspace/mobileWorkspaceModel'
import { createWhiteboardActionStyles as createThemeStyles } from './mobileWhiteboardActionStyles'

type MobileWhiteboardMoreActionsProps = {
  editorBlocks: MobileEditorBlock[]
  editorBullets: string[]
  note: MobileNote
  onClose: () => void
  onUpdateNoteContent: (noteId: string, content: string) => void
}

type MobileWhiteboardSourceEditorProps = {
  noteId: string
  onClose: () => void
  onSelectWhiteboard: (key: string) => void
  onUpdateNoteContent: (noteId: string, content: string) => void
  sourceContent: string
  whiteboard: MobileTldrawWhiteboard
  whiteboards: MobileTldrawWhiteboard[]
}

export function MobileWhiteboardMoreActions({
  editorBlocks,
  editorBullets,
  note,
  onClose,
  onUpdateNoteContent,
}: MobileWhiteboardMoreActionsProps) {
  const sourceContent = useMemo(() => mobileNoteEditableContent({
    ...note,
    editorBlocks: note.editorBlocks ?? editorBlocks,
    editorBullets: note.editorBullets ?? editorBullets,
  }), [editorBlocks, editorBullets, note])
  const whiteboards = useMemo(() => readMobileTldrawWhiteboards({ markdown: sourceContent }), [sourceContent])
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const selectedWhiteboard = whiteboards.find((whiteboard) => whiteboard.key === editingKey) ?? null

  if (whiteboards.length === 0) return null
  if (!selectedWhiteboard) {
    return <CollapsedWhiteboardAction onPress={() => setEditingKey(whiteboards[0]?.key ?? null)} />
  }

  return (
    <MobileWhiteboardSourceEditor
      key={selectedWhiteboard.key}
      noteId={note.id}
      sourceContent={sourceContent}
      whiteboard={selectedWhiteboard}
      whiteboards={whiteboards}
      onClose={onClose}
      onSelectWhiteboard={setEditingKey}
      onUpdateNoteContent={onUpdateNoteContent}
    />
  )
}

function CollapsedWhiteboardAction({ onPress }: { onPress: () => void }) {
  const { styles, mobileColors } = useMobileStyles(createThemeStyles)
  return (
    <Pressable
      accessibilityLabel={mobileText('editor.whiteboard.edit')}
      accessibilityRole="button"
      style={({ pressed }) => [styles.actionRow, pressed ? styles.rowPressed : null]}
      testID="workspace-action-edit-whiteboard"
      onPress={onPress}
    >
      <View style={styles.actionRowContent}>
        <View style={styles.actionIcon}>
          <ScribbleLoop color={mobileColors.textMuted} size={desktopToolbarActionParity.iconSize} />
        </View>
        <Text numberOfLines={1} style={styles.actionText}>{mobileText('editor.whiteboard.edit')}</Text>
      </View>
    </Pressable>
  )
}

function MobileWhiteboardSourceEditor({
  noteId,
  onClose,
  onSelectWhiteboard,
  onUpdateNoteContent,
  sourceContent,
  whiteboard,
  whiteboards,
}: MobileWhiteboardSourceEditorProps) {
  const { styles, mobileColors } = useMobileStyles(createThemeStyles)
  const [height, setHeight] = useState(whiteboard.height)
  const [snapshot, setSnapshot] = useState(whiteboard.snapshot)
  const [textShape, setTextShape] = useState('')
  const [width, setWidth] = useState(whiteboard.width)
  const textShapes = useMemo(() => readMobileTldrawTextShapesFromSnapshot({ snapshot }), [snapshot])
  const canAddTextShape = textShape.trim().length > 0 && canAddMobileTldrawTextShapeToSnapshot({ snapshot })

  const addTextShape = () => {
    const result = addMobileTldrawTextShapeToSnapshot({ snapshot, text: textShape })
    if (!result.added) return
    setSnapshot(result.snapshot)
    setTextShape('')
  }

  const updateTextShape = (shapeId: string, text: string) => {
    setSnapshot((currentSnapshot) => {
      const result = updateMobileTldrawTextShapeInSnapshot({ shapeId, snapshot: currentSnapshot, text })
      return result.updated ? result.snapshot : currentSnapshot
    })
  }

  const removeTextShape = (shapeId: string) => {
    setSnapshot((currentSnapshot) => {
      const result = removeMobileTldrawTextShapeFromSnapshot({ shapeId, snapshot: currentSnapshot })
      return result.removed ? result.snapshot : currentSnapshot
    })
  }

  const saveWhiteboard = () => {
    const result = updateMobileTldrawWhiteboard({
      markdown: sourceContent,
      update: {
        height,
        key: whiteboard.key,
        snapshot,
        width,
      },
    })
    if (result.updated) onUpdateNoteContent(noteId, result.markdown)
    onClose()
  }

  return (
    <View style={styles.editor} testID="workspace-whiteboard-editor">
      <View style={styles.header}>
        <ScribbleLoop color={mobileColors.textMuted} size={desktopToolbarActionParity.iconSize} />
        <Text style={styles.title}>{mobileText('editor.whiteboard.edit')}</Text>
      </View>
      <WhiteboardPicker whiteboard={whiteboard} whiteboards={whiteboards} onSelectWhiteboard={onSelectWhiteboard} />
      <View style={styles.metadataFields}>
        <MobileTextInput
          label={mobileText('editor.whiteboard.height')}
          testID="workspace-whiteboard-height-input"
          value={height}
          onChangeText={setHeight}
        />
        <MobileTextInput
          label={mobileText('editor.whiteboard.width')}
          testID="workspace-whiteboard-width-input"
          value={width}
          onChangeText={setWidth}
        />
      </View>
      <View style={styles.structuredEditor} testID="workspace-whiteboard-structured-editor">
        {textShapes.length > 0 ? (
          <View style={styles.textShapeList} testID="workspace-whiteboard-text-shape-list">
            {textShapes.map((shape, index) => (
              <View key={shape.id} style={styles.textShapeRow} testID={`workspace-whiteboard-text-shape-${index}`}>
                <View style={styles.textShapeInput}>
                  <MobileTextInput
                    label={`${mobileText('inspector.properties.valueKind.text')} ${index + 1}`}
                    testID={`workspace-whiteboard-text-shape-${index}-input`}
                    value={shape.text}
                    onChangeText={(text) => updateTextShape(shape.id, text)}
                  />
                </View>
                <MobileButton
                  label={mobileText('common.remove')}
                  style={styles.removeTextShapeButton}
                  variant="ghost"
                  onPress={() => removeTextShape(shape.id)}
                />
              </View>
            ))}
          </View>
        ) : null}
        <MobileTextInput
          label={mobileText('inspector.properties.valueKind.text')}
          testID="workspace-whiteboard-text-shape-input"
          value={textShape}
          onChangeText={setTextShape}
        />
        <View style={styles.structuredEditorFooter}>
          <MobileButton
            density="status"
            disabled={!canAddTextShape}
            label={mobileText('inspector.relationship.add')}
            onPress={addTextShape}
          />
        </View>
      </View>
      <MobileTextInput
        multiline
        label={mobileText('editor.whiteboard.snapshot')}
        scrollEnabled
        style={styles.snapshotInput}
        testID="workspace-whiteboard-snapshot-input"
        textAlignVertical="top"
        value={snapshot}
        onChangeText={setSnapshot}
      />
      <View style={styles.footer}>
        <MobileButton label={mobileText('common.cancel')} variant="ghost" onPress={onClose} />
        <MobileButton label={mobileText('common.save')} onPress={saveWhiteboard} />
      </View>
    </View>
  )
}

function WhiteboardPicker({
  onSelectWhiteboard,
  whiteboard,
  whiteboards,
}: {
  onSelectWhiteboard: (key: string) => void
  whiteboard: MobileTldrawWhiteboard
  whiteboards: MobileTldrawWhiteboard[]
}) {
  const { styles } = useMobileStyles(createThemeStyles)
  if (whiteboards.length <= 1) return null

  return (
    <View style={styles.picker} testID="workspace-whiteboard-picker">
      {whiteboards.map((candidate, index) => (
        <Pressable
          accessibilityLabel={whiteboardLabel(candidate, index)}
          accessibilityRole="button"
          key={candidate.key}
          style={({ pressed }) => [
            styles.pickerRow,
            candidate.key === whiteboard.key ? styles.pickerRowSelected : null,
            pressed ? styles.rowPressed : null,
          ]}
          testID={`workspace-whiteboard-option-${index}`}
          onPress={() => onSelectWhiteboard(candidate.key)}
        >
          <Text numberOfLines={1} style={styles.pickerTitle}>{whiteboardLabel(candidate, index)}</Text>
        </Pressable>
      ))}
    </View>
  )
}

function whiteboardLabel(whiteboard: MobileTldrawWhiteboard, index: number): string {
  return whiteboard.boardId || `${mobileText('editor.formatting.whiteboard')} ${index + 1}`
}
