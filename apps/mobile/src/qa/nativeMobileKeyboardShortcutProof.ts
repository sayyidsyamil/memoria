import { nativeMobileKeyCommandsAvailable } from '../native/mobileNativeKeyCommands'
import type { MobileWorkspaceKeyboardAction } from '../workspace/mobileWorkspaceKeyboardShortcuts'
import {
  nativeMobileKeyboardShortcutLogLine,
  type NativeMobileKeyboardShortcutActionProof,
  type NativeMobileKeyboardShortcutBridgeProof,
} from './nativeMobileKeyboardShortcutProofContract'

export {
  assertNativeMobileKeyboardShortcutProofs,
  formatNativeMobileKeyboardShortcutFailures,
  nativeMobileKeyboardShortcutLogLine,
  nativeMobileKeyboardShortcutLogPrefix,
  nativeMobileKeyboardShortcutProbeEnabled,
  parseNativeMobileKeyboardShortcutProofs,
  type NativeMobileKeyboardShortcutActionProof,
  type NativeMobileKeyboardShortcutAssertionFailure,
  type NativeMobileKeyboardShortcutBridgeProof,
  type NativeMobileKeyboardShortcutProof,
} from './nativeMobileKeyboardShortcutProofContract'

export function nativeMobileKeyboardShortcutBridgeProof(): NativeMobileKeyboardShortcutBridgeProof {
  return {
    kind: 'bridge',
    nativeModuleAvailable: nativeMobileKeyCommandsAvailable(),
  }
}

export function nativeMobileKeyboardShortcutActionProof(
  action: MobileWorkspaceKeyboardAction,
  event: {
    code?: string
    key: string
    metaKey: boolean
    source?: 'native'
  },
): NativeMobileKeyboardShortcutActionProof {
  return {
    action,
    code: event.code ?? null,
    kind: 'action',
    key: event.key,
    metaKey: event.metaKey,
    source: event.source ?? 'dom',
  }
}

export function logNativeMobileKeyboardShortcutBridgeProof() {
  console.info(nativeMobileKeyboardShortcutLogLine(nativeMobileKeyboardShortcutBridgeProof()))
}

export function logNativeMobileKeyboardShortcutActionProof(
  action: MobileWorkspaceKeyboardAction,
  event: {
    code?: string
    key: string
    metaKey: boolean
    source?: 'native'
  },
) {
  console.info(nativeMobileKeyboardShortcutLogLine(nativeMobileKeyboardShortcutActionProof(action, event)))
}
