import type { MobileMetrics } from '../../ui/mobileMetrics'
import { useMobileStyles } from '../../ui/theme/useMobileTheme'
import type { MobileColors } from '../../ui/theme/mobilePalette'
import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Table } from 'phosphor-react-native'
import { Text } from '../ui/text'
import { mobileText } from '../../i18n/mobileText'
import { desktopToolbarActionParity } from '../../ui/desktopParity'
import { MobileButton } from '../../ui/MobileButton'
import { MobileTextInput } from '../../ui/MobileTextInput'

import { mobileNoteEditableContent } from '../../workspace/mobileDocumentContent'
import {
  readMobileMarkdownTables,
  updateMobileMarkdownTable,
  type MobileMarkdownTableAlignment,
  type MobileMarkdownTable,
} from '../../workspace/mobileMarkdownTables'
import type { MobileEditorBlock, MobileNote } from '../../workspace/mobileWorkspaceModel'
import { MobileTableAlignmentControls } from './MobileTableAlignmentControls'

type MobileTableMoreActionsProps = {
  editorBlocks: MobileEditorBlock[]
  editorBullets: string[]
  note: MobileNote
  onClose: () => void
  onUpdateNoteContent: (noteId: string, content: string) => void
}

export function MobileTableMoreActions({
  editorBlocks,
  editorBullets,
  note,
  onClose,
  onUpdateNoteContent,
}: MobileTableMoreActionsProps) {
  const sourceContent = useMemo(() => mobileNoteEditableContent({
    ...note,
    editorBlocks: note.editorBlocks ?? editorBlocks,
    editorBullets: note.editorBullets ?? editorBullets,
  }), [editorBlocks, editorBullets, note])
  const tables = useMemo(() => readMobileMarkdownTables({ markdown: sourceContent }), [sourceContent])
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const selectedTable = tables.find((table) => table.key === editingKey) ?? null

  if (tables.length === 0) return null
  if (!selectedTable) return <CollapsedTableAction onPress={() => setEditingKey(tables[0]?.key ?? null)} />

  return (
    <MobileTableSourceEditor
      key={selectedTable.key}
      noteId={note.id}
      sourceContent={sourceContent}
      table={selectedTable}
      tables={tables}
      onClose={onClose}
      onSelectTable={setEditingKey}
      onUpdateNoteContent={onUpdateNoteContent}
    />
  )
}

function CollapsedTableAction({ onPress }: { onPress: () => void }) {
  const { styles, mobileColors } = useMobileStyles(createThemeStyles)
  return (
    <Pressable
      accessibilityLabel={mobileText('editor.table.edit')}
      accessibilityRole="button"
      style={({ pressed }) => [styles.actionRow, pressed ? styles.rowPressed : null]}
      testID="workspace-action-edit-table"
      onPress={onPress}
    >
      <View style={styles.actionRowContent}>
        <View style={styles.actionIcon}>
          <Table color={mobileColors.textMuted} size={desktopToolbarActionParity.iconSize} />
        </View>
        <Text numberOfLines={1} style={styles.actionText}>{mobileText('editor.table.edit')}</Text>
      </View>
    </Pressable>
  )
}

function MobileTableSourceEditor({
  noteId,
  onClose,
  onSelectTable,
  onUpdateNoteContent,
  sourceContent,
  table,
  tables,
}: {
  noteId: string
  onClose: () => void
  onSelectTable: (key: string) => void
  onUpdateNoteContent: (noteId: string, content: string) => void
  sourceContent: string
  table: MobileMarkdownTable
  tables: MobileMarkdownTable[]
}) {
  const { styles } = useMobileStyles(createThemeStyles)
  const [alignments, setAlignments] = useState(table.alignments)
  const [headers, setHeaders] = useState(table.headers)
  const [rows, setRows] = useState(table.rows)

  const saveTable = () => {
    const result = updateMobileMarkdownTable({
      markdown: sourceContent,
      update: { alignments, headers, key: table.key, rows },
    })
    if (result.updated) onUpdateNoteContent(noteId, result.markdown)
    onClose()
  }

  return (
    <View style={styles.editor} testID="workspace-table-editor">
      <EditorHeader />
      <TablePicker table={table} tables={tables} onSelectTable={onSelectTable} />
      <TableControls
        canRemoveColumn={headers.length > 1}
        canRemoveRow={rows.length > 0}
        onAddColumn={() => {
          setAlignments(addColumnToAlignments)
          setHeaders(addColumnToHeaders)
          setRows(addColumnToRows)
        }}
        onAddRow={() => setRows((current) => addTableRow({ columnCount: headers.length, rows: current }))}
        onRemoveColumn={() => {
          setAlignments(removeLastItem)
          setHeaders(removeLastItem)
          setRows(removeLastColumn)
        }}
        onRemoveRow={() => setRows(removeLastItem)}
      />
      <MobileTableAlignmentControls
        alignments={alignments}
        columnCount={headers.length}
        onChangeAlignment={(columnIndex, alignment) => setAlignments((current) => replaceAlignmentAt({
          alignments: current,
          columnCount: headers.length,
          columnIndex,
          value: alignment,
        }))}
      />
      <TableFields
        headers={headers}
        rows={rows}
        onChangeCell={(rowIndex, columnIndex, value) => setRows((current) => updateTableCell({
          columnIndex,
          rowIndex,
          rows: current,
          value,
        }))}
        onChangeHeader={(columnIndex, value) => setHeaders((current) => replaceAt({
          index: columnIndex,
          value,
          values: current,
        }))}
      />
      <View style={styles.footer}>
        <MobileButton label={mobileText('common.cancel')} variant="ghost" onPress={onClose} />
        <MobileButton label={mobileText('common.save')} onPress={saveTable} />
      </View>
    </View>
  )
}

function EditorHeader() {
  const { styles, mobileColors } = useMobileStyles(createThemeStyles)
  return (
    <View style={styles.header}>
      <Table color={mobileColors.textMuted} size={desktopToolbarActionParity.iconSize} />
      <Text style={styles.title}>{mobileText('editor.table.edit')}</Text>
    </View>
  )
}

function TableControls({
  canRemoveColumn,
  canRemoveRow,
  onAddColumn,
  onAddRow,
  onRemoveColumn,
  onRemoveRow,
}: {
  canRemoveColumn: boolean
  canRemoveRow: boolean
  onAddColumn: () => void
  onAddRow: () => void
  onRemoveColumn: () => void
  onRemoveRow: () => void
}) {
  const { styles } = useMobileStyles(createThemeStyles)
  return (
    <View style={styles.controls}>
      <MobileButton density="status" label={mobileText('editor.table.addRow')} onPress={onAddRow} />
      <MobileButton density="status" label={mobileText('editor.table.addColumn')} onPress={onAddColumn} />
      <MobileButton density="status" disabled={!canRemoveRow} label={mobileText('editor.table.removeRow')} variant="ghost" onPress={onRemoveRow} />
      <MobileButton density="status" disabled={!canRemoveColumn} label={mobileText('editor.table.removeColumn')} variant="ghost" onPress={onRemoveColumn} />
    </View>
  )
}

function TableFields({
  headers,
  onChangeCell,
  onChangeHeader,
  rows,
}: {
  headers: string[]
  onChangeCell: (rowIndex: number, columnIndex: number, value: string) => void
  onChangeHeader: (columnIndex: number, value: string) => void
  rows: string[][]
}) {
  const { styles } = useMobileStyles(createThemeStyles)
  return (
    <View style={styles.fieldGroup}>
      {headers.map((header, columnIndex) => (
        <MobileTextInput
          key={`header-${columnIndex}`}
          label={columnLabel({ columnIndex })}
          testID={`workspace-table-header-input-${columnIndex}`}
          value={header}
          onChangeText={(value) => onChangeHeader(columnIndex, value)}
        />
      ))}
      {rows.map((row, rowIndex) => (
        <View key={`row-${rowIndex}`} style={styles.rowGroup} testID={`workspace-table-row-${rowIndex}`}>
          <Text style={styles.rowTitle}>{rowLabel({ rowIndex })}</Text>
          {headers.map((_header, columnIndex) => (
            <MobileTextInput
              key={`cell-${rowIndex}-${columnIndex}`}
              label={cellLabel({ columnIndex, rowIndex })}
              testID={`workspace-table-cell-input-${rowIndex}-${columnIndex}`}
              value={row[columnIndex] ?? ''}
              onChangeText={(value) => onChangeCell(rowIndex, columnIndex, value)}
            />
          ))}
        </View>
      ))}
    </View>
  )
}

function TablePicker({
  onSelectTable,
  table,
  tables,
}: {
  onSelectTable: (key: string) => void
  table: MobileMarkdownTable
  tables: MobileMarkdownTable[]
}) {
  const { styles } = useMobileStyles(createThemeStyles)
  if (tables.length <= 1) return null

  return (
    <View style={styles.picker} testID="workspace-table-picker">
      {tables.map((candidate, index) => (
        <Pressable
          accessibilityLabel={tableLabel({ index })}
          accessibilityRole="button"
          key={candidate.key}
          style={({ pressed }) => [
            styles.pickerRow,
            candidate.key === table.key ? styles.pickerRowSelected : null,
            pressed ? styles.rowPressed : null,
          ]}
          testID={`workspace-table-option-${index}`}
          onPress={() => onSelectTable(candidate.key)}
        >
          <Text numberOfLines={1} style={styles.pickerTitle}>{tableLabel({ index })}</Text>
        </Pressable>
      ))}
    </View>
  )
}

function addColumnToHeaders(headers: string[]): string[] {
  return [...headers, '']
}

function addColumnToAlignments(alignments: MobileMarkdownTableAlignment[]): MobileMarkdownTableAlignment[] {
  return [...alignments, 'default']
}

function addColumnToRows(rows: string[][]): string[][] {
  return rows.map((row) => [...row, ''])
}

function addTableRow({ columnCount, rows }: { columnCount: number; rows: string[][] }): string[][] {
  return [...rows, Array.from({ length: columnCount }, () => '')]
}

function removeLastColumn(rows: string[][]): string[][] {
  return rows.map((row) => row.slice(0, -1))
}

function removeLastItem<T>(items: T[]): T[] {
  return items.slice(0, -1)
}

function replaceAt({ index, value, values }: { index: number; value: string; values: string[] }): string[] {
  return values.map((current, currentIndex) => currentIndex === index ? value : current)
}

function replaceAlignmentAt({
  alignments,
  columnCount,
  columnIndex,
  value,
}: {
  alignments: MobileMarkdownTableAlignment[]
  columnCount: number
  columnIndex: number
  value: MobileMarkdownTableAlignment
}): MobileMarkdownTableAlignment[] {
  return Array.from({ length: columnCount }, (_current, currentIndex) => (
    currentIndex === columnIndex ? value : alignments[currentIndex] ?? 'default'
  ))
}

function updateTableCell({
  columnIndex,
  rowIndex,
  rows,
  value,
}: {
  columnIndex: number
  rowIndex: number
  rows: string[][]
  value: string
}): string[][] {
  return rows.map((row, currentRow) => currentRow === rowIndex
    ? replaceAt({ index: columnIndex, value, values: row })
    : row)
}

function cellLabel({ columnIndex, rowIndex }: { columnIndex: number; rowIndex: number }): string {
  return mobileText('editor.table.cell')
    .replace('{row}', `${rowIndex + 1}`)
    .replace('{column}', `${columnIndex + 1}`)
}

function columnLabel({ columnIndex }: { columnIndex: number }): string {
  return mobileText('editor.table.column').replace('{index}', `${columnIndex + 1}`)
}

function rowLabel({ rowIndex }: { rowIndex: number }): string {
  return mobileText('editor.table.row').replace('{index}', `${rowIndex + 1}`)
}

function tableLabel({ index }: { index: number }): string {
  return `${mobileText('editor.formatting.table')} ${index + 1}`
}

function createThemeStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  const styles = {
    ...tableActionStyles(mobileColors, metrics),
    ...tableEditorStyles(mobileColors, metrics),
    ...tablePickerStyles(mobileColors, metrics),
  }
  return { mobileColors, styles }
}

function tableActionStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  const { toolbarAction: desktopToolbarActionParity, space: mobileSpace, type: mobileType } = metrics
  return StyleSheet.create({
    actionIcon: {
      width: desktopToolbarActionParity.iconSize,
      alignItems: 'center',
    },
    actionRow: {
      minWidth: 0,
      borderRadius: 6,
    },
    actionRowContent: {
      minHeight: 44,
      alignItems: 'center',
      flexDirection: 'row',
      gap: mobileSpace.sm,
      paddingHorizontal: mobileSpace.sm,
    },
    actionText: {
      minWidth: 0,
      flex: 1,
      color: mobileColors.text,
      fontSize: mobileType.body,
      fontWeight: '500',
    },
    rowPressed: {
      backgroundColor: mobileColors.graySoft,
    }
  })
}

function tableEditorStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  const { space: mobileSpace, type: mobileType } = metrics
  return StyleSheet.create({
    controls: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: mobileSpace.xs,
    },
    editor: {
      gap: mobileSpace.md,
      borderColor: mobileColors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingTop: mobileSpace.md,
    },
    fieldGroup: {
      gap: mobileSpace.sm,
    },
    footer: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: mobileSpace.sm,
    },
    header: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: mobileSpace.sm,
    },
    rowGroup: {
      gap: mobileSpace.xs,
      borderColor: mobileColors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingTop: mobileSpace.sm,
    },
    rowTitle: {
      color: mobileColors.textMuted,
      fontSize: mobileType.caption,
      fontWeight: '500',
    },
    title: {
      color: mobileColors.text,
      fontSize: mobileType.body,
      fontWeight: '500',
    }
  })
}

function tablePickerStyles(mobileColors: MobileColors, metrics: MobileMetrics) {
  const { space: mobileSpace, type: mobileType } = metrics
  return StyleSheet.create({
    picker: {
      gap: mobileSpace.xs,
    },
    pickerRow: {
      minHeight: 34,
      alignItems: 'center',
      flexDirection: 'row',
      borderRadius: 6,
      paddingHorizontal: mobileSpace.sm,
      paddingVertical: mobileSpace.xs,
    },
    pickerRowSelected: {
      backgroundColor: mobileColors.selected,
    },
    pickerTitle: {
      minWidth: 0,
      flex: 1,
      color: mobileColors.text,
      fontSize: mobileType.body,
      fontWeight: '500',
    }
  })
}
