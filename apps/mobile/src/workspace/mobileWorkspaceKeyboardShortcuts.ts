import { useContext, useEffect, useLayoutEffect, useRef } from 'react'
import { WorkspaceSyncEditorsContext } from './workspaceSyncEditors'
import {
  optionalNativeMobileKeyCommandsModule,
  type NativeMobileKeyCommandEvent,
  type NativeMobileKeyCommandsModule,
} from '../native/mobileNativeKeyCommands'

type KeyboardShortcutHandlers = {
  nativeNoteNavigationEnabled?: boolean
  onCreateNote?: () => void
  onOpenFindInNote?: () => void
  onOpenCommandPalette: () => void
  onOpenSearch: () => void
  onSelectNextNote?: () => void
  onSelectPreviousNote?: () => void
  onShortcutAction?: (action: MobileWorkspaceKeyboardAction, event: MobileKeyboardShortcutEvent) => void
  onToggleRawEditor?: () => void
  onToggleProperties?: () => void
  onViewAll?: () => void
  onViewEditorList?: () => void
  onViewEditorOnly?: () => void
}
export type MobileWorkspaceKeyboardAction =
  | 'commandPalette'
  | 'createNote'
  | 'findInNote'
  | 'nextNote'
  | 'previousNote'
  | 'search'
  | 'toggleRawEditor'
  | 'toggleProperties'
  | 'viewAll'
  | 'viewEditorList'
  | 'viewEditorOnly'

type KeyboardDocument = {
  addEventListener: (type: 'keydown', listener: (event: KeyboardEvent) => void, options?: KeyboardListenerOptions) => void
  removeEventListener: (type: 'keydown', listener: (event: KeyboardEvent) => void, options?: KeyboardListenerOptions) => void
}
type KeyboardListenerOptions = { capture?: boolean } | boolean
type KeyboardTargetCandidate = Partial<KeyboardDocument> | null | undefined
type KeyboardShortcutSubscription = { remove: () => void }
type KeyboardTargetHost = {
  document?: (Partial<KeyboardDocument> & { body?: KeyboardTargetCandidate }) | null
  window?: KeyboardTargetCandidate
}
type MobileKeyboardShortcutEvent =
  Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'> &
  Partial<Pick<KeyboardEvent, 'code' | 'preventDefault' | 'target'>> & {
    source?: 'native'
  }

export function useMobileWorkspaceKeyboardShortcuts(options: KeyboardShortcutHandlers) {
  const syncEditors = useContext(WorkspaceSyncEditorsContext)
  const current = useRef(options)
  useLayoutEffect(() => { current.current = options }, [options])
  useEffect(() => installMobileWorkspaceKeyboardShortcuts((event) => {
    if (syncEditors?.isBlocked()) return
    dispatchWorkspaceShortcut(event, current.current)
  }), [syncEditors])
}

function dispatchWorkspaceShortcut(event: MobileKeyboardShortcutEvent, options: KeyboardShortcutHandlers) {
  const action = mobileWorkspaceKeyboardAction(event)
  if (!action || !shouldHandleMobileWorkspaceKeyboardAction(action, event, options)) return
  const handler = workspaceShortcutHandlers(options).get(action)
  if (!handler) return
  event.preventDefault?.()
  options.onShortcutAction?.(action, event)
  handler()
}

function workspaceShortcutHandlers(options: KeyboardShortcutHandlers) {
  return new Map<MobileWorkspaceKeyboardAction, (() => void) | undefined>([
    ['commandPalette', options.onOpenCommandPalette],
    ['createNote', options.onCreateNote],
    ['findInNote', options.onOpenFindInNote],
    ['nextNote', options.onSelectNextNote],
    ['previousNote', options.onSelectPreviousNote],
    ['search', options.onOpenSearch],
    ['toggleRawEditor', options.onToggleRawEditor],
    ['toggleProperties', options.onToggleProperties],
    ['viewAll', options.onViewAll],
    ['viewEditorList', options.onViewEditorList],
    ['viewEditorOnly', options.onViewEditorOnly],
  ])
}

export function installMobileWorkspaceKeyboardShortcuts(
  listener: (event: MobileKeyboardShortcutEvent) => void,
  host: KeyboardTargetHost = globalThis as KeyboardTargetHost,
  nativeModule: NativeMobileKeyCommandsModule | null = optionalNativeMobileKeyCommandsModule(),
) {
  const targets = keyboardTargets(host)
  const subscriptions: KeyboardShortcutSubscription[] = []

  const options = { capture: true }
  targets.forEach((target) => {
    const keyboardListener = listener as (event: KeyboardEvent) => void
    target.addEventListener('keydown', keyboardListener, options)
    subscriptions.push({ remove: () => target.removeEventListener('keydown', keyboardListener, options) })
  })
  if (nativeModule) subscriptions.push(nativeModule.addListener('onShortcut', listener))
  if (subscriptions.length === 0) return undefined

  return () => { subscriptions.forEach((subscription) => { subscription.remove() }) }
}

export function keyboardTargets(host: KeyboardTargetHost): KeyboardDocument[] {
  return uniqueKeyboardTargets([
    host.document,
    host.window,
    host.document?.body ?? undefined,
  ])
}

function uniqueKeyboardTargets(targets: KeyboardTargetCandidate[]) {
  const seen = new Set<KeyboardDocument>()
  return targets.filter((target): target is KeyboardDocument => {
    if (!isKeyboardTarget(target) || seen.has(target)) return false
    seen.add(target)
    return true
  })
}

function isKeyboardTarget(target: KeyboardTargetCandidate): target is KeyboardDocument {
  return (
    typeof target?.addEventListener === 'function' &&
    typeof target.removeEventListener === 'function'
  )
}

export function mobileWorkspaceKeyboardAction(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'> & Partial<Pick<KeyboardEvent, 'code'>>,
): MobileWorkspaceKeyboardAction | null {
  if (event.altKey) return null
  const key = normalizedKeyboardKey(event).replace(/^(key|digit)/u, '')
  const actions = keyboardActionMap(event)
  return actions.get(key) ?? null
}

function keyboardActionMap(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>) {
  if (event.metaKey || event.ctrlKey) return event.shiftKey ? shiftedCommandActions : commandActions
  return event.shiftKey ? new Map<string, MobileWorkspaceKeyboardAction>() : navigationActions
}

const commandActions = new Map<string, MobileWorkspaceKeyboardAction>([
  ['k', 'commandPalette'], ['f', 'findInNote'], ['o', 'search'], ['p', 'search'],
  ['\\', 'toggleRawEditor'], ['backslash', 'toggleRawEditor'], ['n', 'createNote'],
  ['1', 'viewEditorOnly'], ['2', 'viewEditorList'], ['3', 'viewAll'],
])
const shiftedCommandActions = new Map<string, MobileWorkspaceKeyboardAction>([['i', 'toggleProperties']])
const navigationActions = new Map<string, MobileWorkspaceKeyboardAction>([
  ['arrowdown', 'nextNote'], ['arrowup', 'previousNote'],
])

export function shouldHandleMobileWorkspaceKeyboardAction(
  action: MobileWorkspaceKeyboardAction,
  event: MobileKeyboardShortcutEvent | NativeMobileKeyCommandEvent,
  { nativeNoteNavigationEnabled = true }: { nativeNoteNavigationEnabled?: boolean } = {},
) {
  if (!noteNavigationAction(action)) return true
  if (keyboardEventTargetAcceptsTextInput(event)) return false
  return event.source !== 'native' || nativeNoteNavigationEnabled
}

function normalizedKeyboardKey(
  event: Pick<KeyboardEvent, 'key'> & Partial<Pick<KeyboardEvent, 'code'>>,
) {
  const key = event.key.toLowerCase()
  if (key === 'unidentified' || key.length === 0) return event.code?.toLowerCase() ?? ''
  if (key === '\\') return '\\'
  return key
}

function noteNavigationAction(action: MobileWorkspaceKeyboardAction) {
  return action === 'nextNote' || action === 'previousNote'
}

function keyboardEventTargetAcceptsTextInput(event: MobileKeyboardShortcutEvent | NativeMobileKeyCommandEvent) {
  const target = ('target' in event ? event.target : null) as { isContentEditable?: boolean; tagName?: string } | null
  if (!target) return false
  const tagName = target.tagName?.toLowerCase()

  return target.isContentEditable === true || tagName === 'input' || tagName === 'textarea'
}
