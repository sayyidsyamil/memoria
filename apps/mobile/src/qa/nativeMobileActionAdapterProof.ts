type ActionAdapterProofLogText = string
type ActionAdapterProofLine = string

export type NativeMobileActionAdapterProof = {
  clipboardDeepLinkRoundTrip: boolean
  clipboardFilePathRoundTrip: boolean
  deepLinkBuilt: boolean
  filePathBuilt: boolean
  folderRevealOpened: boolean
  noteOpenOpened: boolean
  noteRevealOpened: boolean
  pdfExported: boolean
  pdfHtmlRendered: boolean
  selectedNoteId: string
}

export type NativeMobileActionAdapterAssertionFailure = {
  id: string
  message: string
}

export const nativeMobileActionAdapterLogPrefix = 'MEMORIA_MOBILE_ACTION_ADAPTER_PROBE'

export function nativeMobileActionAdapterLogLine(
  proof: NativeMobileActionAdapterProof,
): ActionAdapterProofLine {
  return `${nativeMobileActionAdapterLogPrefix} ${JSON.stringify(proof)}`
}

export function parseNativeMobileActionAdapterProofs(
  logText: ActionAdapterProofLogText,
): NativeMobileActionAdapterProof[] {
  return logText
    .split('\n')
    .map(parseProofLine)
    .filter((proof): proof is NativeMobileActionAdapterProof => proof !== null)
}

export function assertNativeMobileActionAdapterProofs(
  proofs: NativeMobileActionAdapterProof[],
): NativeMobileActionAdapterAssertionFailure[] {
  const latest = proofs.at(-1)
  if (!latest) {
    return [{
      id: 'mobile.actionAdapters',
      message: 'Native mobile action-adapter proof was not logged',
    }]
  }

  return [
    proofFailure(latest.selectedNoteId.length > 0, 'mobile.actionAdapters.selectedNote', 'Native action-adapter probe resolves the active note'),
    proofFailure(latest.filePathBuilt, 'mobile.actionAdapters.filePath', 'Native action-adapter probe builds a safe selected-note file path'),
    proofFailure(latest.deepLinkBuilt, 'mobile.actionAdapters.deepLink', 'Native action-adapter probe builds a desktop-shaped Memoria deep link'),
    proofFailure(latest.clipboardFilePathRoundTrip, 'mobile.actionAdapters.copyFilePath', 'Native action-adapter probe copies and reads back the selected-note file path'),
    proofFailure(latest.clipboardDeepLinkRoundTrip, 'mobile.actionAdapters.copyDeepLink', 'Native action-adapter probe copies and reads back the selected-note deep link'),
    proofFailure(latest.noteOpenOpened, 'mobile.actionAdapters.openFile', 'Native action-adapter probe routes selected-note open through the file opener boundary'),
    proofFailure(latest.noteRevealOpened, 'mobile.actionAdapters.revealFile', 'Native action-adapter probe routes selected-note reveal through the file revealer boundary'),
    proofFailure(latest.folderRevealOpened, 'mobile.actionAdapters.revealFolder', 'Native action-adapter probe routes selected-folder reveal through the file revealer boundary'),
    proofFailure(latest.pdfHtmlRendered, 'mobile.actionAdapters.pdfHtml', 'Native action-adapter probe renders selected-note PDF HTML without frontmatter'),
    proofFailure(latest.pdfExported, 'mobile.actionAdapters.pdfExport', 'Native action-adapter probe routes selected-note PDF export through the exporter boundary'),
  ].filter((failure): failure is NativeMobileActionAdapterAssertionFailure => failure !== null)
}

export function formatNativeMobileActionAdapterFailures(
  failures: NativeMobileActionAdapterAssertionFailure[],
): string {
  return failures.map((failure) => `${failure.id}: ${failure.message}`).join('\n')
}

function parseProofLine(line: ActionAdapterProofLine): NativeMobileActionAdapterProof | null {
  const prefixIndex = line.indexOf(nativeMobileActionAdapterLogPrefix)
  if (prefixIndex === -1) return null

  const rawJson = line.slice(prefixIndex + nativeMobileActionAdapterLogPrefix.length).trim()
  try {
    return parsedProof(JSON.parse(rawJson))
  } catch {
    return null
  }
}

function parsedProof(value: unknown): NativeMobileActionAdapterProof | null {
  if (!proofHasShape(value)) return null

  return {
    clipboardDeepLinkRoundTrip: value.clipboardDeepLinkRoundTrip,
    clipboardFilePathRoundTrip: value.clipboardFilePathRoundTrip,
    deepLinkBuilt: value.deepLinkBuilt,
    filePathBuilt: value.filePathBuilt,
    folderRevealOpened: value.folderRevealOpened,
    noteOpenOpened: value.noteOpenOpened,
    noteRevealOpened: value.noteRevealOpened,
    pdfExported: value.pdfExported,
    pdfHtmlRendered: value.pdfHtmlRendered,
    selectedNoteId: value.selectedNoteId,
  }
}

function proofHasShape(value: unknown): value is NativeMobileActionAdapterProof {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<keyof NativeMobileActionAdapterProof, unknown>
  const flags = [
    candidate.clipboardDeepLinkRoundTrip,
    candidate.clipboardFilePathRoundTrip,
    candidate.deepLinkBuilt,
    candidate.filePathBuilt,
    candidate.folderRevealOpened,
    candidate.noteOpenOpened,
    candidate.noteRevealOpened,
    candidate.pdfExported,
    candidate.pdfHtmlRendered,
  ]
  return flags.every((flag) => typeof flag === 'boolean')
    && typeof candidate.selectedNoteId === 'string'
}

function proofFailure(
  passed: boolean,
  id: string,
  message: string,
): NativeMobileActionAdapterAssertionFailure | null {
  return passed ? null : { id, message }
}
