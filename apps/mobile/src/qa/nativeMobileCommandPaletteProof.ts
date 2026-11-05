type CommandPaletteProofLogText = string
type CommandPaletteProofLine = string

export type NativeMobileCommandPaletteProof = {
  commandPaletteCommandEnabled: boolean
  createNoteCommandEnabled: boolean
  enabledCommands: number
  findInVaultCommandEnabled: boolean
  quickOpenCommandEnabled: boolean
  reloadCommandEnabled: boolean
  togglePropertiesCommandEnabled: boolean
  totalCommands: number
  typeListCommandsAvailable: boolean
  typedNoteCommandsAvailable: boolean
}

export type NativeMobileCommandPaletteAssertionFailure = {
  id: string
  message: string
}

export const nativeMobileCommandPaletteLogPrefix = 'MEMORIA_MOBILE_COMMAND_PALETTE_PROBE'

export function nativeMobileCommandPaletteLogLine(
  proof: NativeMobileCommandPaletteProof,
): CommandPaletteProofLine {
  return `${nativeMobileCommandPaletteLogPrefix} ${JSON.stringify(proof)}`
}

export function parseNativeMobileCommandPaletteProofs(
  logText: CommandPaletteProofLogText,
): NativeMobileCommandPaletteProof[] {
  return logText
    .split('\n')
    .map(parseProofLine)
    .filter((proof): proof is NativeMobileCommandPaletteProof => proof !== null)
}

export function assertNativeMobileCommandPaletteProofs(
  proofs: NativeMobileCommandPaletteProof[],
): NativeMobileCommandPaletteAssertionFailure[] {
  const latest = proofs.at(-1)
  if (!latest) {
    return [{
      id: 'mobile.commandPalette',
      message: 'Native mobile command-palette proof was not logged',
    }]
  }

  return [
    proofFailure(latest.totalCommands > 0, 'mobile.commandPalette.total', 'Native command palette builds commands from the live workspace controller'),
    proofFailure(latest.enabledCommands > 0, 'mobile.commandPalette.enabled', 'Native command palette exposes enabled commands'),
    proofFailure(latest.commandPaletteCommandEnabled, 'mobile.commandPalette.open', 'Native command palette includes the shared desktop Command Palette command ID'),
    proofFailure(latest.quickOpenCommandEnabled, 'mobile.commandPalette.quickOpen', 'Native command palette includes desktop quick-open/search'),
    proofFailure(latest.findInVaultCommandEnabled, 'mobile.commandPalette.findInVault', 'Native command palette includes desktop Find in Vault'),
    proofFailure(latest.createNoteCommandEnabled, 'mobile.commandPalette.createNote', 'Native command palette includes desktop note creation'),
    proofFailure(latest.togglePropertiesCommandEnabled, 'mobile.commandPalette.properties', 'Native command palette includes desktop properties toggle'),
    proofFailure(latest.reloadCommandEnabled, 'mobile.commandPalette.reload', 'Native command palette includes desktop vault reload'),
    proofFailure(latest.typeListCommandsAvailable, 'mobile.commandPalette.typeList', 'Native command palette exposes Type section list commands'),
    proofFailure(latest.typedNoteCommandsAvailable, 'mobile.commandPalette.typedNote', 'Native command palette exposes typed note creation commands'),
  ].filter((failure): failure is NativeMobileCommandPaletteAssertionFailure => failure !== null)
}

export function formatNativeMobileCommandPaletteFailures(
  failures: NativeMobileCommandPaletteAssertionFailure[],
): string {
  return failures.map((failure) => `${failure.id}: ${failure.message}`).join('\n')
}

function parseProofLine(line: CommandPaletteProofLine): NativeMobileCommandPaletteProof | null {
  const prefixIndex = line.indexOf(nativeMobileCommandPaletteLogPrefix)
  if (prefixIndex === -1) return null

  const rawJson = line.slice(prefixIndex + nativeMobileCommandPaletteLogPrefix.length).trim()
  try {
    return parsedProof(JSON.parse(rawJson))
  } catch {
    return null
  }
}

function parsedProof(value: unknown): NativeMobileCommandPaletteProof | null {
  if (!proofHasShape(value)) return null

  return {
    commandPaletteCommandEnabled: value.commandPaletteCommandEnabled,
    createNoteCommandEnabled: value.createNoteCommandEnabled,
    enabledCommands: value.enabledCommands,
    findInVaultCommandEnabled: value.findInVaultCommandEnabled,
    quickOpenCommandEnabled: value.quickOpenCommandEnabled,
    reloadCommandEnabled: value.reloadCommandEnabled,
    togglePropertiesCommandEnabled: value.togglePropertiesCommandEnabled,
    totalCommands: value.totalCommands,
    typeListCommandsAvailable: value.typeListCommandsAvailable,
    typedNoteCommandsAvailable: value.typedNoteCommandsAvailable,
  }
}

function proofHasShape(value: unknown): value is NativeMobileCommandPaletteProof {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<keyof NativeMobileCommandPaletteProof, unknown>
  const flags = [
    candidate.commandPaletteCommandEnabled,
    candidate.createNoteCommandEnabled,
    candidate.findInVaultCommandEnabled,
    candidate.quickOpenCommandEnabled,
    candidate.reloadCommandEnabled,
    candidate.togglePropertiesCommandEnabled,
    candidate.typeListCommandsAvailable,
    candidate.typedNoteCommandsAvailable,
  ]
  return flags.every((flag) => typeof flag === 'boolean')
    && typeof candidate.enabledCommands === 'number'
    && typeof candidate.totalCommands === 'number'
}

function proofFailure(
  passed: boolean,
  id: string,
  message: string,
): NativeMobileCommandPaletteAssertionFailure | null {
  return passed ? null : { id, message }
}
