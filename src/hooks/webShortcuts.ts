/**
 * Browser-safe shortcuts for the web build (TOL-194). Browsers keep some desktop shortcuts for
 * themselves (⌘N, ⌘1–3, ⌘⇧T…) or give them a meaning users expect (⌘P prints, ⌘D bookmarks,
 * ⌘± zooms the page). On the web those are left to the browser; the commands most used from
 * the keyboard move to ⌥⌘ (Ctrl+Alt off Apple keyboards), which Safari, Chrome and iPadOS
 * leave free for these keys. Everything else stays reachable from the command palette, ⌘K.
 */

type ShortcutEventLike = Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'code'> & {
  getModifierState?: (key: string) => boolean
}

interface WebShortcut {
  code: string
  key: string
}

/** Desktop shortcuts the browser owns or that would shadow a familiar browser action. */
export const BROWSER_OWNED_SHORTCUT_COMMANDS: ReadonlySet<string> = new Set([
  'app-settings', // ⌘, Safari settings
  'file-new-note', // ⌘N new window
  'file-quick-open', // ⌘P print, ⌘O open file
  'view-editor-only', // ⌘1–3 switch tabs
  'view-editor-list',
  'view-all',
  'view-zoom-in', // ⌘= ⌘- ⌘0 page zoom
  'view-zoom-out',
  'view-zoom-reset',
  'view-go-back', // ⌘← ⌘→ history
  'view-go-forward',
  'view-toggle-properties', // ⌘⇧I Safari: mail this page
  'view-toggle-ai-chat', // ⌘⇧L Safari: sidebar
  'view-toggle-table-of-contents', // ⌘⇧T reopen closed tab
  'note-toggle-favorite', // ⌘D bookmark
  'note-toggle-organized', // ⌘E use selection for find
  'note-open-in-new-window', // ⌘⇧O bookmarks
])

const WEB_SHORTCUTS: Readonly<Record<string, WebShortcut>> = {
  'file-new-note': { code: 'KeyN', key: 'N' },
  'file-quick-open': { code: 'KeyP', key: 'P' },
  'view-editor-only': { code: 'Digit1', key: '1' },
  'view-editor-list': { code: 'Digit2', key: '2' },
  'view-all': { code: 'Digit3', key: '3' },
}

const WEB_SHORTCUT_BY_CODE = new Map(
  Object.entries(WEB_SHORTCUTS).map(([id, shortcut]) => [shortcut.code, id]),
)

/** ⌥⌘ on Apple keyboards, Ctrl+Alt elsewhere; AltGr (Ctrl+Alt on Windows) types characters. */
function isWebShortcutChord(event: ShortcutEventLike, apple: boolean): boolean {
  if (!event.altKey || event.shiftKey) return false
  if (apple) return event.metaKey && !event.ctrlKey
  if (event.metaKey || !event.ctrlKey) return false
  return event.getModifierState?.('AltGraph') !== true
}

/** The web command for a ⌥⌘ chord, if it is one; matched by key position, as ⌥ changes the character. */
export function findWebShortcutCommand(event: ShortcutEventLike, apple: boolean): string | null {
  if (!isWebShortcutChord(event, apple)) return null
  return WEB_SHORTCUT_BY_CODE.get(event.code) ?? null
}

/** Drops a desktop match that the browser owns on the web. */
export function webSafeDesktopCommand<Id extends string>(commandId: Id | null): Id | null {
  return commandId !== null && BROWSER_OWNED_SHORTCUT_COMMANDS.has(commandId) ? null : commandId
}

/** What the web shows for a command: its ⌥⌘ chord, nothing for a browser-owned one, else the desktop label. */
export function webShortcutDisplay(id: string, desktopDisplay: string | undefined, apple: boolean): string | undefined {
  const shortcut = Reflect.get(WEB_SHORTCUTS, id) as WebShortcut | undefined
  if (shortcut) return apple ? `⌥⌘${shortcut.key}` : `Ctrl+Alt+${shortcut.key}`
  return BROWSER_OWNED_SHORTCUT_COMMANDS.has(id) ? undefined : desktopDisplay
}
