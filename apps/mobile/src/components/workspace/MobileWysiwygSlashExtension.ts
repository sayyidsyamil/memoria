import { Extension, type Editor, type ChainedCommands } from '@tiptap/core'
import { Plugin, PluginKey } from '@10play/tentap-editor/web'
import { matchingMobileSlashCommands, type MobileSlashAction, type MobileSlashState } from './MobileWysiwygSlashCommands'

type MenuSelection = { signature: string; index: number; dismissed: boolean }
const selectionKey = new PluginKey<MenuSelection>('memoriaMobileSlash')
const emptySelection: MenuSelection = { signature: '', index: 0, dismissed: false }

export const MobileSlashExtension = Extension.create({
  name: 'mobileSlash',
  priority: 1100,
  addProseMirrorPlugins() {
    const editor = this.editor
    return [new Plugin({
      key: selectionKey,
      state: {
        init: () => emptySelection,
        apply: (transaction, state) => transaction.getMeta(selectionKey)
          ?? (transaction.docChanged || transaction.selectionSet ? emptySelection : state),
      },
      props: {
        handleKeyDown: (view, event) => !view.composing && handleSlashKey(editor, event.key),
      },
    })]
  },
})

function slashAtSelection(editor: Editor) {
  const { empty, $from, from } = editor.state.selection
  if (!empty || !$from.parent.isTextblock || $from.parent.type.spec.code || editor.isActive('code')) return null
  const prefix = $from.parent.textBetween(0, $from.parentOffset, '', '\ufffc')
  const match = /^\/([\p{L}\p{N} _-]{0,48})$/u.exec(prefix)
  return match ? { from: $from.start(), to: from, query: match[1] } : null
}

export function readMobileSlash(editor: Editor): MobileSlashState | null {
  const match = slashAtSelection(editor)
  if (!match) return null
  const selected = selectionKey.getState(editor.state) ?? emptySelection
  const signatureMatches = selected.signature === signature(match)
  if (signatureMatches && selected.dismissed) return null
  const commands = matchingMobileSlashCommands(match.query).map(({ action, label }) => ({ action, label }))
  const index = signatureMatches ? Math.min(selected.index, Math.max(0, commands.length - 1)) : 0
  return { ...match, commands, index }
}

function signature(match: { from: number; to: number; query: string }) {
  return `${match.from}:${match.to}:${match.query}`
}

function handleSlashKey(editor: Editor, key: string): boolean {
  const menu = readMobileSlash(editor)
  if (!menu) return false
  if (key === 'Escape') return updateSelection(editor, menu, menu.index, true)
  if (menu.commands.length === 0) return false
  if (key === 'Enter') return runMobileSlash(editor, menu.commands[menu.index].action)
  const direction = { ArrowDown: 1, ArrowUp: -1 }[key]
  if (!direction) return false
  const index = (menu.index + direction + menu.commands.length) % menu.commands.length
  return updateSelection(editor, menu, index, false)
}

function updateSelection(editor: Editor, menu: MobileSlashState, index: number, dismissed: boolean) {
  editor.view.dispatch(editor.state.tr.setMeta(selectionKey, { signature: signature(menu), index, dismissed }))
  return true
}

export function runMobileSlash(editor: Editor, action: MobileSlashAction): boolean {
  const menu = readMobileSlash(editor)
  if (!menu?.commands.some((command) => command.action === action)) return false
  const transform = slashTransforms.get(action)
  if (!transform) return false
  return transform(editor.chain().focus().deleteRange({ from: menu.from, to: menu.to })).run()
}

const slashTransforms = new Map<MobileSlashAction, (chain: ChainedCommands) => ChainedCommands>([
  ['paragraph', (chain) => chain.command(({ state, commands }) =>
    state.selection.$from.parent.type.name === 'paragraph' || commands.setNode('paragraph'))],
  ['heading1', (chain) => chain.setNode('heading', { level: 1 })],
  ['heading2', (chain) => chain.setNode('heading', { level: 2 })],
  ['heading3', (chain) => chain.setNode('heading', { level: 3 })],
  ['heading4', (chain) => chain.setNode('heading', { level: 4 })],
  ['heading5', (chain) => chain.setNode('heading', { level: 5 })],
  ['heading6', (chain) => chain.setNode('heading', { level: 6 })],
  ['bulletList', (chain) => chain.toggleList('bulletList', 'listItem')],
  ['orderedList', (chain) => chain.toggleList('orderedList', 'listItem')],
  ['taskList', (chain) => chain.toggleList('taskList', 'taskItem')],
  ['quote', (chain) => chain.toggleWrap('blockquote')],
  ['codeBlock', (chain) => chain.setNode('codeBlock', { language: 'text' })],
  ['divider', (chain) => chain.insertContent({ type: 'horizontalRule' })],
  ['mathBlock', (chain) => chain.insertContent({ type: 'mathBlock', attrs: { latex: '\\sqrt{a^2 + b^2}' } })],
  ['table', (chain) => chain.insertContent(tableBlock())],
])

function tableBlock() {
  return {
    type: 'table',
    content: ['tableHeader', 'tableCell'].map((type) => ({
      type: 'tableRow', content: [0, 1].map(() => ({ type, content: [{ type: 'paragraph' }] })),
    })),
  }
}
