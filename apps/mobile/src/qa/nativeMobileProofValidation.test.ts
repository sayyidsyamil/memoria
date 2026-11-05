import { describe, expect, it } from 'vitest'
import {
  nativeMobileCommandPaletteLogLine,
  parseNativeMobileCommandPaletteProofs,
  type NativeMobileCommandPaletteProof,
} from './nativeMobileCommandPaletteProof'
import {
  nativeMobileActionAdapterLogLine,
  parseNativeMobileActionAdapterProofs,
  type NativeMobileActionAdapterProof,
} from './nativeMobileActionAdapterProof'

const commandProof: NativeMobileCommandPaletteProof = {
  commandPaletteCommandEnabled: true,
  createNoteCommandEnabled: true,
  enabledCommands: 2,
  findInVaultCommandEnabled: true,
  quickOpenCommandEnabled: true,
  reloadCommandEnabled: true,
  togglePropertiesCommandEnabled: true,
  totalCommands: 3,
  typeListCommandsAvailable: true,
  typedNoteCommandsAvailable: true,
}

const actionProof: NativeMobileActionAdapterProof = {
  clipboardDeepLinkRoundTrip: true,
  clipboardFilePathRoundTrip: true,
  deepLinkBuilt: true,
  filePathBuilt: true,
  folderRevealOpened: true,
  noteOpenOpened: true,
  noteRevealOpened: true,
  pdfExported: true,
  pdfHtmlRendered: true,
  selectedNoteId: 'owned-test-note',
}

describe('native proof shape validation', () => {
  it.each(Object.keys(commandProof))('rejects a command proof with invalid %s', (key) => {
    const invalid = { ...commandProof, [key]: null }
    const line = nativeMobileCommandPaletteLogLine(commandProof).replace(
      JSON.stringify(commandProof), JSON.stringify(invalid),
    )
    expect(parseNativeMobileCommandPaletteProofs(line)).toEqual([])
  })

  it.each(Object.keys(actionProof))('rejects an action proof with invalid %s', (key) => {
    const invalid = { ...actionProof, [key]: null }
    const line = nativeMobileActionAdapterLogLine(actionProof).replace(
      JSON.stringify(actionProof), JSON.stringify(invalid),
    )
    expect(parseNativeMobileActionAdapterProofs(line)).toEqual([])
  })

  it('retains false flags as evidence rather than rejecting a failed native check', () => {
    const command = { ...commandProof, createNoteCommandEnabled: false }
    const action = { ...actionProof, pdfExported: false }
    expect(parseNativeMobileCommandPaletteProofs(nativeMobileCommandPaletteLogLine(command))).toEqual([command])
    expect(parseNativeMobileActionAdapterProofs(nativeMobileActionAdapterLogLine(action))).toEqual([action])
  })

  it('projects only the expected fields from valid native logs', () => {
    const command = { ...commandProof, extra: 'not part of the proof' }
    const action = { ...actionProof, extra: 'not part of the proof' }
    expect(parseNativeMobileCommandPaletteProofs(nativeMobileCommandPaletteLogLine(command))).toEqual([commandProof])
    expect(parseNativeMobileActionAdapterProofs(nativeMobileActionAdapterLogLine(action))).toEqual([actionProof])
  })
})
