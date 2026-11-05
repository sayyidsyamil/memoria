import { describe, expect, it } from 'vitest'
import {
  assertNativeMobileCommandPaletteProofs,
  formatNativeMobileCommandPaletteFailures,
  nativeMobileCommandPaletteLogLine,
  nativeMobileCommandPaletteProbeEnabled,
  nativeMobileCommandPaletteProof,
  parseNativeMobileCommandPaletteProofs,
  type NativeMobileCommandPaletteProof,
} from './nativeMobileCommandPaletteProbe'
import type { MobileCommandPaletteCommand } from '../workspace/mobileCommandPalette'

describe('native mobile command palette probe', () => {
  it('builds a passing proof from the live command list shape', () => {
    const proof = nativeMobileCommandPaletteProof([
      command('view-command-palette'),
      command('file-new-note'),
      command('edit-find-in-vault'),
      command('file-quick-open'),
      command('vault-reload'),
      command('view-toggle-properties'),
      command('list-essay'),
      command('new-essay'),
      command('disabled-command', false),
    ])

    expect(proof).toEqual({
      commandPaletteCommandEnabled: true,
      createNoteCommandEnabled: true,
      enabledCommands: 8,
      findInVaultCommandEnabled: true,
      quickOpenCommandEnabled: true,
      reloadCommandEnabled: true,
      togglePropertiesCommandEnabled: true,
      totalCommands: 9,
      typeListCommandsAvailable: true,
      typedNoteCommandsAvailable: true,
    })
    expect(assertNativeMobileCommandPaletteProofs([proof])).toEqual([])
  })

  it('parses simulator log proofs', () => {
    const proof = passingProof()

    expect(parseNativeMobileCommandPaletteProofs(nativeMobileCommandPaletteLogLine(proof))).toEqual([proof])
  })

  it('reports missing command groups', () => {
    expect(formatNativeMobileCommandPaletteFailures(
      assertNativeMobileCommandPaletteProofs([]),
    )).toContain('mobile.commandPalette')
    expect(assertNativeMobileCommandPaletteProofs([{
      ...passingProof(),
      commandPaletteCommandEnabled: false,
      typedNoteCommandsAvailable: false,
    }])).toEqual([
      {
        id: 'mobile.commandPalette.open',
        message: 'Native command palette includes the shared desktop Command Palette command ID',
      },
      {
        id: 'mobile.commandPalette.typedNote',
        message: 'Native command palette exposes typed note creation commands',
      },
    ])
  })

  it('detects the native QA query flag', () => {
    expect(nativeMobileCommandPaletteProbeEnabled(new globalThis.URLSearchParams('mobileCommandPaletteProbe=1'))).toBe(true)
    expect(nativeMobileCommandPaletteProbeEnabled(new globalThis.URLSearchParams('mobileCommandPaletteProbe=0'))).toBe(false)
  })
})

function command(id: string, enabled = true): MobileCommandPaletteCommand {
  return {
    enabled,
    execute: () => undefined,
    group: 'View',
    id,
    keywords: [],
    label: id,
  }
}

function passingProof(): NativeMobileCommandPaletteProof {
  return {
    commandPaletteCommandEnabled: true,
    createNoteCommandEnabled: true,
    enabledCommands: 8,
    findInVaultCommandEnabled: true,
    quickOpenCommandEnabled: true,
    reloadCommandEnabled: true,
    togglePropertiesCommandEnabled: true,
    totalCommands: 8,
    typeListCommandsAvailable: true,
    typedNoteCommandsAvailable: true,
  }
}
