import { describe, expect, it } from 'vitest'
import {
  BROWSER_OWNED_SHORTCUT_COMMANDS,
  findWebShortcutCommand,
  webSafeDesktopCommand,
  webShortcutDisplay,
} from './webShortcuts'

function chord(code: string, modifiers: Partial<KeyboardEvent> = {}, altGraph = false) {
  return {
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    code,
    getModifierState: (key: string) => key === 'AltGraph' && altGraph,
    ...modifiers,
  }
}

describe('webShortcuts', () => {
  it('reads ⌥⌘ chords on Apple keyboards by key position', () => {
    expect(findWebShortcutCommand(chord('KeyN', { metaKey: true }), true)).toBe('file-new-note')
    expect(findWebShortcutCommand(chord('KeyP', { metaKey: true }), true)).toBe('file-quick-open')
    expect(findWebShortcutCommand(chord('Digit3', { metaKey: true }), true)).toBe('view-all')
    expect(findWebShortcutCommand(chord('KeyZ', { metaKey: true }), true)).toBeNull()
  })

  it('ignores other modifier mixes on Apple keyboards', () => {
    expect(findWebShortcutCommand(chord('KeyN', { metaKey: true, ctrlKey: true }), true)).toBeNull()
    expect(findWebShortcutCommand(chord('KeyN', { metaKey: true, shiftKey: true }), true)).toBeNull()
    expect(findWebShortcutCommand(chord('KeyN', { metaKey: true, altKey: false }), true)).toBeNull()
  })

  it('reads Ctrl+Alt elsewhere, but not AltGr typing a character', () => {
    expect(findWebShortcutCommand(chord('Digit2', { ctrlKey: true }), false)).toBe('view-editor-list')
    expect(findWebShortcutCommand(chord('KeyN', { ctrlKey: true }, true), false)).toBeNull()
    expect(findWebShortcutCommand(chord('KeyN', { ctrlKey: true, metaKey: true }), false)).toBeNull()
    expect(findWebShortcutCommand(chord('KeyN'), false)).toBeNull()
  })

  it('leaves browser-owned desktop shortcuts to the browser', () => {
    expect(webSafeDesktopCommand('file-new-note')).toBeNull()
    expect(webSafeDesktopCommand('view-zoom-in')).toBeNull()
    expect(webSafeDesktopCommand('view-command-palette')).toBe('view-command-palette')
    expect(webSafeDesktopCommand(null)).toBeNull()
    expect(BROWSER_OWNED_SHORTCUT_COMMANDS.has('file-save')).toBe(false)
  })

  it('shows the web chord, nothing for a browser-owned command, else the desktop label', () => {
    expect(webShortcutDisplay('file-new-note', '⌘N', true)).toBe('⌥⌘N')
    expect(webShortcutDisplay('file-quick-open', 'Ctrl+P', false)).toBe('Ctrl+Alt+P')
    expect(webShortcutDisplay('note-toggle-favorite', '⌘D', true)).toBeUndefined()
    expect(webShortcutDisplay('view-command-palette', '⌘K', true)).toBe('⌘K')
  })
})
