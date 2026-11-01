import type { AnyExtension, Editor } from '@tiptap/core'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import type { MobileMarkdownTableAlignment } from '../../workspace/mobileMarkdownTables'

const TableNode = Table.configure({
  allowTableNodeSelection: true,
  lastColumnResizable: false,
  resizable: false,
})
const MobileTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      memoriaAlignment: mobileTableAlignmentAttribute(),
    }
  },
})
const MobileTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      memoriaAlignment: mobileTableAlignmentAttribute(),
    }
  },
})
const tableExtensions: AnyExtension[] = [
  TableNode,
  TableRow,
  MobileTableHeader,
  MobileTableCell,
]

type MobileTableBridgeExtension = {
  clone: () => MobileTableBridgeExtension
  config?: unknown
  configureCSS: (css: string) => MobileTableBridgeExtension
  configureExtension: (config: unknown) => MobileTableBridgeExtension
  configureTiptapExtensionsOnRunTime: (config: unknown, extendConfig: unknown) => (AnyExtension | undefined)[]
  extendEditorInstance: (sendBridgeMessage: SendMobileTableBridgeMessage) => MobileTableBridgeEditorInstance
  extendEditorState: (editor: Editor) => MobileTableBridgeEditorState
  extendExtension: (extendConfig: unknown) => MobileTableBridgeExtension
  extendConfig?: unknown
  extendCSS: string
  name: string
  onBridgeMessage: (editor: Editor, message: unknown) => boolean
  tiptapExtension: AnyExtension
}

type MobileTableBridgeOptions = {
  config?: unknown
  css?: string
  extendConfig?: unknown
}
type MobileTableBridgeActionType =
  | 'mobile-table-add-column-after'
  | 'mobile-table-add-row-after'
  | 'mobile-table-add-row-column-after-first-body-cell'
  | 'mobile-table-delete-column'
  | 'mobile-table-delete-row'
type MobileTableBridgeEditorInstance = {
  addColumnAfter: () => void
  addRowAfter: () => void
  addRowAndColumnAfterFirstBodyCell: () => void
  deleteColumn: () => void
  deleteRow: () => void
}
type ProseMirrorNodeLike = {
  child: (index: number) => ProseMirrorNodeLike
  childCount: number
  descendants: (callback: (node: ProseMirrorNodeLike, position: number) => boolean | undefined) => void
  nodeSize: number
  type: { name: string }
}
type MobileTableBridgeEditorState = {
  canAddColumnAfter: boolean
  canAddRowAfter: boolean
  canDeleteColumn: boolean
  canDeleteRow: boolean
}
type MobileTableBridgeMessage = {
  type: MobileTableBridgeActionType
}
type SendMobileTableBridgeMessage = (message: MobileTableBridgeMessage) => void

export const MobileTableBridge = mobileTableBridge()

function mobileTableAlignmentAttribute() {
  return {
    default: null,
    parseHTML: (element: HTMLElement) => (
      mobileTableAlignment(element.getAttribute('data-memoria-alignment'))
      ?? mobileTableAlignment(element.style.textAlign)
    ),
    renderHTML: (attrs: { memoriaAlignment?: unknown }) => {
      const alignment = mobileTableAlignment(attrs.memoriaAlignment)
      return alignment && alignment !== 'default'
        ? {
          'data-memoria-alignment': alignment,
          style: `text-align: ${alignment}`,
        }
        : {}
    },
  }
}

function mobileTableAlignment(value: unknown): MobileMarkdownTableAlignment | null {
  return value === 'center' || value === 'default' || value === 'left' || value === 'right' ? value : null
}

function mobileTableBridge({
  config,
  css = '',
  extendConfig,
}: MobileTableBridgeOptions = {}): MobileTableBridgeExtension {
  return {
    clone: () => mobileTableBridge({ config, css, extendConfig }),
    config,
    configureCSS: (nextCss) => mobileTableBridge({ config, css: nextCss, extendConfig }),
    configureExtension: (nextConfig) => mobileTableBridge({ config: nextConfig, css, extendConfig }),
    configureTiptapExtensionsOnRunTime: (runtimeConfig, runtimeExtendConfig) => (
      tableExtensions.map((extension) => configuredTableExtension(extension, {
        config: runtimeConfig,
        extendConfig: runtimeExtendConfig,
      }))
    ),
    extendEditorInstance: (sendBridgeMessage) => ({
      addColumnAfter: () => sendBridgeMessage({ type: 'mobile-table-add-column-after' }),
      addRowAfter: () => sendBridgeMessage({ type: 'mobile-table-add-row-after' }),
      addRowAndColumnAfterFirstBodyCell: () => sendBridgeMessage({ type: 'mobile-table-add-row-column-after-first-body-cell' }),
      deleteColumn: () => sendBridgeMessage({ type: 'mobile-table-delete-column' }),
      deleteRow: () => sendBridgeMessage({ type: 'mobile-table-delete-row' }),
    }),
    extendEditorState: (editor) => ({
      canAddColumnAfter: editor.can().addColumnAfter(),
      canAddRowAfter: editor.can().addRowAfter(),
      canDeleteColumn: editor.can().deleteColumn(),
      canDeleteRow: editor.can().deleteRow(),
    }),
    extendExtension: (nextExtendConfig) => mobileTableBridge({ config, css, extendConfig: nextExtendConfig }),
    extendConfig,
    extendCSS: css,
    name: TableNode.name,
    onBridgeMessage: (editor, message) => handleMobileTableBridgeMessage(editor, message),
    tiptapExtension: TableNode,
  }
}

function configuredTableExtension(
  extension: AnyExtension,
  options: { config: unknown; extendConfig: unknown },
): AnyExtension {
  if (extension.name !== TableNode.name) return extension

  const configuredExtension = options.config ? extension.configure(options.config) : extension
  return options.extendConfig ? configuredExtension.extend(options.extendConfig) : configuredExtension
}

function handleMobileTableBridgeMessage(editor: Editor, message: unknown): boolean {
  const action = mobileTableBridgeAction(message)
  if (!action) return false

  try {
    runMobileTableBridgeAction(editor, action)
  } catch (error) {
    console.warn('[mobile-table] Failed to run table bridge action:', action, error)
  }
  return true
}

function runMobileTableBridgeAction(editor: Editor, action: MobileTableBridgeActionType): void {
  if (action === 'mobile-table-add-column-after') editor.chain().focus().addColumnAfter().run()
  if (action === 'mobile-table-add-row-after') editor.chain().focus().addRowAfter().run()
  if (action === 'mobile-table-add-row-column-after-first-body-cell') addRowAndColumnAfterFirstBodyCell(editor)
  if (action === 'mobile-table-delete-column') editor.chain().focus().deleteColumn().run()
  if (action === 'mobile-table-delete-row') editor.chain().focus().deleteRow().run()
}

function addRowAndColumnAfterFirstBodyCell(editor: Editor): void {
  const cellPosition = firstBodyTableCellPosition(editor.state.doc as ProseMirrorNodeLike)
  if (cellPosition === null) return

  editor.chain()
    .focus()
    .setCellSelection({ anchorCell: cellPosition, headCell: cellPosition })
    .addColumnAfter()
    .addRowAfter()
    .run()
}

function firstBodyTableCellPosition(doc: ProseMirrorNodeLike): number | null {
  let cellPosition: number | null = null
  doc.descendants((node, position) => {
    if (cellPosition !== null) return false
    if (node.type.name !== 'table') return true

    cellPosition = firstBodyCellPositionInTable(node, position)
    return false
  })

  return cellPosition
}

function firstBodyCellPositionInTable(table: ProseMirrorNodeLike, tablePosition: number): number | null {
  let rowPosition = tablePosition + 1
  for (let index = 0; index < table.childCount; index += 1) {
    const row = table.child(index)
    if (!isHeaderRow(row)) return firstChildPosition(row, rowPosition)
    rowPosition += row.nodeSize
  }

  return null
}

function firstChildPosition(node: ProseMirrorNodeLike, position: number): number | null {
  return node.childCount > 0 ? position + 1 : null
}

function isHeaderRow(row: ProseMirrorNodeLike): boolean {
  if (row.childCount === 0) return false

  for (let index = 0; index < row.childCount; index += 1) {
    if (row.child(index).type.name !== 'tableHeader') return false
  }

  return true
}

function mobileTableBridgeAction(message: unknown): MobileTableBridgeActionType | null {
  if (!message || typeof message !== 'object') return null

  const type = (message as { type?: unknown }).type
  return isMobileTableBridgeActionType(type) ? type : null
}

function isMobileTableBridgeActionType(value: unknown): value is MobileTableBridgeActionType {
  return value === 'mobile-table-add-column-after'
    || value === 'mobile-table-add-row-after'
    || value === 'mobile-table-add-row-column-after-first-body-cell'
    || value === 'mobile-table-delete-column'
    || value === 'mobile-table-delete-row'
}
