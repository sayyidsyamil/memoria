import { Extension, type Editor } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Decoration, DecorationSet, Plugin, PluginKey } from '@10play/tentap-editor/web'
import { findEditorMatches, nextEditorFindIndex, replacementForEditorFindMatch, type EditorFindMatch, type EditorFindOptions } from '../../../../../src/utils/editorFind'
import type { MobileFindRequest, MobileFindSnapshot } from './MobileWysiwygFindBridge'

type FindState = MobileFindSnapshot & { query: string; options: EditorFindOptions; matches: EditorFindMatch[] }
const findKey = new PluginKey<FindState>('memoriaMobileFind')
const emptyFind: FindState = {
  query: '', options: { caseSensitive: false, regex: false }, activeIndex: 0, matchCount: 0, matches: [], error: null,
}

export const MobileFindExtension = Extension.create({
  name: 'mobileFind',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: findKey,
      state: {
        init: () => emptyFind,
        apply: (transaction, previous) => {
          const request: MobileFindRequest | undefined = transaction.getMeta(findKey)
          if (request?.kind === 'close') return emptyFind
          if (request?.kind === 'query') return calculateMatches(transaction.doc, { ...previous, ...request, activeIndex: 0 })
          const current = transaction.docChanged ? calculateMatches(transaction.doc, previous) : previous
          return request?.kind === 'move'
            ? { ...current, activeIndex: nextEditorFindIndex(current.activeIndex, current.matchCount, request.direction) }
            : current
        },
      },
      props: { decorations: (state) => findDecorations(state.doc, findKey.getState(state) ?? emptyFind) },
    })]
  },
})

function calculateMatches(document: Node, state: FindState): FindState {
  const matches: EditorFindMatch[] = []
  let error: string | null = null
  if (!state.query) return { ...emptyFind, options: state.options }
  document.descendants((node, position) => {
    if (!node.isTextblock || error) return !error
    const result = findEditorMatches(node.textBetween(0, node.content.size, '', '\ufffc'), state.query, state.options)
    error = result.error
    matches.push(...result.matches.map((match) => ({ ...match, from: position + 1 + match.from, to: position + 1 + match.to })))
    return false
  })
  return { ...state, matches, error, matchCount: matches.length, activeIndex: Math.min(state.activeIndex, Math.max(0, matches.length - 1)) }
}

function findDecorations(document: Node, state: FindState) {
  const decorations = state.matches.map((match, index) => Decoration.inline(match.from, match.to, {
    class: 'memoria-find-match',
    ...(index === state.activeIndex ? { 'data-memoria-find-active': 'true' } : {}),
  }))
  return DecorationSet.create(document, decorations)
}

export function readMobileFind(editor: Editor): MobileFindSnapshot {
  const { activeIndex, matchCount, error } = findKey.getState(editor.state) ?? emptyFind
  return { activeIndex, matchCount, error }
}

export function applyMobileFindRequest(editor: Editor, request: MobileFindRequest): void {
  if (request.kind === 'replace') replaceMatches(editor, request)
  else editor.view.dispatch(editor.state.tr.setMeta(findKey, request))
  editor.view.dom.querySelector<HTMLElement>('[data-memoria-find-active]')?.scrollIntoView?.({ block: 'center' })
}

function replaceMatches(editor: Editor, request: Extract<MobileFindRequest, { kind: 'replace' }>) {
  const state = findKey.getState(editor.state) ?? emptyFind
  if (state.error || state.matchCount === 0) return
  const matches = request.all ? state.matches : state.matches.slice(state.activeIndex, state.activeIndex + 1)
  const transaction = editor.state.tr
  for (const match of [...matches].reverse()) {
    transaction.insertText(replacementForEditorFindMatch(match, state.query, request.replacement, state.options), match.from, match.to)
  }
  editor.view.dispatch(transaction)
}
