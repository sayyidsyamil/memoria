import type { MobileCommandPaletteCommand } from '../workspace/mobileCommandPalette'
import {
  nativeMobileCommandPaletteLogLine,
  type NativeMobileCommandPaletteProof,
} from './nativeMobileCommandPaletteProof'

export {
  assertNativeMobileCommandPaletteProofs,
  formatNativeMobileCommandPaletteFailures,
  nativeMobileCommandPaletteLogLine,
  nativeMobileCommandPaletteLogPrefix,
  parseNativeMobileCommandPaletteProofs,
} from './nativeMobileCommandPaletteProof'
export type {
  NativeMobileCommandPaletteAssertionFailure,
  NativeMobileCommandPaletteProof,
} from './nativeMobileCommandPaletteProof'

export function nativeMobileCommandPaletteProbeEnabled(searchParams: URLSearchParams): boolean {
  return searchParams.get('mobileCommandPaletteProbe') === '1'
}

export function nativeMobileCommandPaletteProof(
  commands: readonly MobileCommandPaletteCommand[],
): NativeMobileCommandPaletteProof {
  const enabledIds = enabledCommandIds(commands)

  return {
    commandPaletteCommandEnabled: enabledIds.has('view-command-palette'),
    createNoteCommandEnabled: enabledIds.has('file-new-note'),
    enabledCommands: enabledIds.size,
    findInVaultCommandEnabled: enabledIds.has('edit-find-in-vault'),
    quickOpenCommandEnabled: enabledIds.has('file-quick-open'),
    reloadCommandEnabled: enabledIds.has('vault-reload'),
    togglePropertiesCommandEnabled: enabledIds.has('view-toggle-properties'),
    totalCommands: commands.length,
    typeListCommandsAvailable: commandIdStartsWith(enabledIds, 'list-'),
    typedNoteCommandsAvailable: commandIdStartsWith(enabledIds, 'new-'),
  }
}

export function logNativeMobileCommandPaletteProof(commands: readonly MobileCommandPaletteCommand[]) {
  console.info(nativeMobileCommandPaletteLogLine(nativeMobileCommandPaletteProof(commands)))
}

function enabledCommandIds(commands: readonly MobileCommandPaletteCommand[]): Set<string> {
  return new Set(commands.filter((command) => command.enabled).map((command) => command.id))
}

function commandIdStartsWith(ids: Set<string>, prefix: string): boolean {
  for (const id of ids) {
    if (id.startsWith(prefix)) return true
  }

  return false
}
