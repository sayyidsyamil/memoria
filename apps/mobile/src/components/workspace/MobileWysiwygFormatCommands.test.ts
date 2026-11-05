import { describe, expect, it, vi } from 'vitest'
import { mobileColors } from '../../ui/tokens'
import type { MobileMarkdownFormatAction } from '../../workspace/mobileMarkdownFormatting'
import {
  applyNativeWysiwygFormat,
  nativeWysiwygFormattingActions,
  type NativeWysiwygCommandBridge,
} from './MobileWysiwygFormatCommands'

describe('native WYSIWYG format commands', () => {
  it.each([
    ['bold', 'toggleBold', []],
    ['italic', 'toggleItalic', []],
    ['strike', 'toggleStrike', []],
    ['code', 'toggleCode', []],
    ['bulletList', 'toggleBulletList', []],
    ['orderedList', 'toggleOrderedList', []],
    ['taskList', 'toggleTaskList', []],
    ['quote', 'toggleBlockquote', []],
    ['heading1', 'toggleHeading', [1]],
    ['heading2', 'toggleHeading', [2]],
    ['heading3', 'toggleHeading', [3]],
    ['heading4', 'toggleHeading', [4]],
    ['heading5', 'toggleHeading', [5]],
    ['heading6', 'toggleHeading', [6]],
    ['highlight', 'toggleHighlight', [mobileColors.yellowSoft]],
    ['indent', 'sink', []],
    ['outdent', 'lift', []],
    ['tableAddColumnAfter', 'addColumnAfter', []],
    ['tableAddRowAfter', 'addRowAfter', []],
    ['tableDeleteColumn', 'deleteColumn', []],
    ['tableDeleteRow', 'deleteRow', []],
  ] as const)('maps %s to the TenTap %s command', (action, method, args) => {
    const editor = fakeEditor()

    applyNativeWysiwygFormat(editor, action)

    expect(editor[method]).toHaveBeenCalledWith(...args)
    expect(calledMethods(editor)).toEqual([method])
  })

  it('routes indent and outdent through task-list bridges when a task item can move', () => {
    const editor = fakeEditor({ canLiftTaskListItem: true, canSinkTaskListItem: true })

    applyNativeWysiwygFormat(editor, 'indent')
    applyNativeWysiwygFormat(editor, 'outdent')

    expect(calledMethods(editor)).toEqual(['liftTaskListItem', 'sinkTaskListItem'])
  })

  it('keeps inserted block markdown commands visible without mapping them to direct TenTap toolbar commands', () => {
    const insertedBlockActions: MobileMarkdownFormatAction[] = ['divider', 'codeBlock', 'mathBlock', 'mermaid', 'table', 'whiteboard']

    expect(nativeWysiwygFormattingActions).toEqual(expect.arrayContaining(insertedBlockActions))

    for (const action of insertedBlockActions) {
      const editor = fakeEditor()
      applyNativeWysiwygFormat(editor, action)
      expect(calledMethods(editor)).toEqual([])
    }
  })

  it('keeps wikilink visible as a native picker action', () => {
    expect(nativeWysiwygFormattingActions).toContain('wikilink')
  })

  it.each(['attachment', 'link', 'pastePlainText'] as const)('keeps %s visible as a native editor-side action without mapping it to a TenTap command', (action) => {
    const editor = fakeEditor()

    applyNativeWysiwygFormat(editor, action)

    expect(nativeWysiwygFormattingActions).toContain(action)
    expect(calledMethods(editor)).toEqual([])
  })
})

type FakeEditor = Required<NativeWysiwygCommandBridge>
type FakeEditorMethod = {
  [Key in keyof FakeEditor]: FakeEditor[Key] extends (...args: never[]) => unknown ? Key : never
}[keyof FakeEditor]

function fakeEditor(overrides: Partial<NativeWysiwygCommandBridge> = {}): FakeEditor {
  return {
    addColumnAfter: vi.fn(),
    addRowAfter: vi.fn(),
    addRowAndColumnAfterFirstBodyCell: vi.fn(),
    canLift: true,
    canLiftTaskListItem: false,
    canSink: true,
    canSinkTaskListItem: false,
    deleteColumn: vi.fn(),
    deleteRow: vi.fn(),
    lift: vi.fn(),
    liftTaskListItem: vi.fn(),
    setLink: vi.fn(),
    sink: vi.fn(),
    sinkTaskListItem: vi.fn(),
    toggleBlockquote: vi.fn(),
    toggleBold: vi.fn(),
    toggleBulletList: vi.fn(),
    toggleCode: vi.fn(),
    toggleHeading: vi.fn(),
    toggleHighlight: vi.fn(),
    toggleItalic: vi.fn(),
    toggleOrderedList: vi.fn(),
    toggleStrike: vi.fn(),
    toggleTaskList: vi.fn(),
    ...overrides,
  }
}

function calledMethods(editor: FakeEditor): FakeEditorMethod[] {
  return Object.entries(editor)
    .filter(([, method]) => typeof method === 'function' && vi.mocked(method).mock.calls.length > 0)
    .map(([method]) => method as FakeEditorMethod)
    .sort()
}
