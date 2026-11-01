import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_COMMAND_IDS, findShortcutCommandIdForEvent, getAppCommandShortcutDisplay } from './appCommandCatalog'

const MAC_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'

function keyEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init)
}

describe('appCommandCatalog on the web build (TOL-194)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_MEMORIA_WEB_BUILD', 'true')
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(MAC_USER_AGENT)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('maps ⌥⌘ chords to their commands', () => {
    expect(findShortcutCommandIdForEvent(keyEvent({ key: 'ñ', code: 'KeyN', altKey: true, metaKey: true })))
      .toBe(APP_COMMAND_IDS.fileNewNote)
    expect(findShortcutCommandIdForEvent(keyEvent({ key: '¡', code: 'Digit1', altKey: true, metaKey: true })))
      .toBe(APP_COMMAND_IDS.viewEditorOnly)
  })

  it('leaves browser-owned shortcuts to the browser and keeps the rest', () => {
    expect(findShortcutCommandIdForEvent(keyEvent({ key: 'n', code: 'KeyN', metaKey: true }))).toBeNull()
    expect(findShortcutCommandIdForEvent(keyEvent({ key: '1', code: 'Digit1', metaKey: true }))).toBeNull()
    expect(findShortcutCommandIdForEvent(keyEvent({ key: 'k', code: 'KeyK', metaKey: true })))
      .toBe(APP_COMMAND_IDS.viewCommandPalette)
  })

  it('shows the web shortcuts', () => {
    expect(getAppCommandShortcutDisplay(APP_COMMAND_IDS.fileNewNote)).toBe('⌥⌘N')
    expect(getAppCommandShortcutDisplay(APP_COMMAND_IDS.viewZoomIn)).toBeUndefined()
    expect(getAppCommandShortcutDisplay(APP_COMMAND_IDS.viewCommandPalette)).toBe('⌘K')
  })

  it('keeps the desktop shortcuts outside the web build', () => {
    vi.stubEnv('VITE_MEMORIA_WEB_BUILD', '')
    expect(findShortcutCommandIdForEvent(keyEvent({ key: 'n', code: 'KeyN', metaKey: true })))
      .toBe(APP_COMMAND_IDS.fileNewNote)
    expect(getAppCommandShortcutDisplay(APP_COMMAND_IDS.fileNewNote)).toBe('⌘N')
  })
})
