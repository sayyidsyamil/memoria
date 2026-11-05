import { readMobileClipboardText, writeMobileClipboardText, type MobileClipboardReader, type MobileClipboardWriter } from '../workspace/mobileClipboard'
import { buildMobileDeepLinkForNote } from '../workspace/mobileDeepLinks'
import { openMobileNoteFile, type MobileFileOpener } from '../workspace/mobileNoteFileOpen'
import { buildMobileFilePathForNote } from '../workspace/mobileNoteFilePath'
import { exportMobileNoteAsPdf, mobilePdfPayloadForNote, type MobilePdfExporter } from '../workspace/mobilePdfExport'
import { revealMobileFolderPath, revealMobileNoteFile, type MobileFileRevealer } from '../workspace/mobileNoteFileReveal'
import type { MobileNote, MobileWorkspaceSnapshot } from '../workspace/mobileWorkspaceModel'
import type { ReadOnlyWorkspaceRequest } from '../workspace/readOnlyWorkspaceRepository'
import type { NativeMobileActionAdapterProof as NativeMobileActionAdapterProofShape } from './nativeMobileActionAdapterProof'

type ActionAdapterProbeText = string
type ActionAdapterProbeRequest = {
  dependencies?: NativeMobileActionAdapterProbeDependencies
  repositoryRequest: ReadOnlyWorkspaceRequest
  snapshot: MobileWorkspaceSnapshot
}
type ActionAdapterOperationRequest = {
  dependencies: NativeMobileActionAdapterProbeDependencies
  note: MobileNote | null
  snapshot: MobileWorkspaceSnapshot
  vaultRootUri: ReadOnlyWorkspaceRequest['vaultRootUri']
}

export {
  assertNativeMobileActionAdapterProofs,
  formatNativeMobileActionAdapterFailures,
  nativeMobileActionAdapterLogLine,
  nativeMobileActionAdapterLogPrefix,
  parseNativeMobileActionAdapterProofs,
} from './nativeMobileActionAdapterProof'
export type {
  NativeMobileActionAdapterAssertionFailure,
  NativeMobileActionAdapterProof,
} from './nativeMobileActionAdapterProof'

export type NativeMobileActionAdapterProbeDependencies = {
  clipboardReader?: MobileClipboardReader
  clipboardWriter?: MobileClipboardWriter
  fileOpener?: MobileFileOpener
  fileRevealer?: MobileFileRevealer
  folderRevealer?: MobileFileRevealer
  pdfExporter?: MobilePdfExporter
}

export function nativeMobileActionAdapterProbeEnabled(searchParams: URLSearchParams): boolean {
  return searchParams.get('mobileActionAdapterProbe') === '1'
}

export async function nativeMobileActionAdapterProof(request: ActionAdapterProbeRequest): Promise<NativeMobileActionAdapterProofShape> {
  const { dependencies = {}, repositoryRequest, snapshot } = request
  const note = selectedActionAdapterNote(snapshot)
  const vaultRootUri = repositoryRequest.vaultRootUri
  const links = await actionAdapterLinkProof(note, snapshot.source, vaultRootUri, dependencies)
  const operations = await actionAdapterOperationProof({ dependencies, note, snapshot, vaultRootUri })
  return { ...links, ...operations, selectedNoteId: note?.id ?? '' }
}

async function actionAdapterLinkProof(
  note: MobileNote | null,
  source: MobileWorkspaceSnapshot['source'],
  vaultRootUri: ReadOnlyWorkspaceRequest['vaultRootUri'],
  dependencies: NativeMobileActionAdapterProbeDependencies,
) {
  const filePath = buildMobileFilePathForNote({ note, vaultRootUri })
  const deepLink = buildMobileDeepLinkForNote({
    note,
    source,
    vaultRootUri,
  })
  const pdfPayload = mobilePdfPayloadForNote(note)
  const clipboardFilePathRoundTrip = filePath.ok
    ? await clipboardRoundTrip(filePath.path, dependencies)
    : false
  const clipboardDeepLinkRoundTrip = deepLink.ok
    ? await clipboardRoundTrip(deepLink.url, dependencies)
    : false
  return {
    clipboardDeepLinkRoundTrip,
    clipboardFilePathRoundTrip,
    deepLinkBuilt: deepLink.ok && deepLink.url.startsWith('memoria://'),
    filePathBuilt: filePath.ok && filePath.path.length > 0,
    pdfHtmlRendered: Boolean(pdfPayload?.html.includes('<main>') && pdfPayload.html.includes('</html>')),
  }
}

async function actionAdapterOperationProof(request: ActionAdapterOperationRequest) {
  const noteActions = await noteFileActionProof(request)
  const folderAndPdfActions = await folderAndPdfActionProof(request)
  return { ...noteActions, ...folderAndPdfActions }
}

async function noteFileActionProof(request: ActionAdapterOperationRequest) {
  const { dependencies, note, vaultRootUri } = request
  const noteOpen = await openMobileNoteFile({
    note,
    opener: dependencies.fileOpener ?? proofFileOpener,
    vaultRootUri,
  })
  const noteReveal = await revealMobileNoteFile({
    note,
    revealer: dependencies.fileRevealer ?? proofFileRevealer,
    vaultRootUri,
  })
  return {
    noteOpenOpened: noteOpen.ok && noteOpen.opened,
    noteRevealOpened: noteReveal.ok && noteReveal.opened,
  }
}

async function folderAndPdfActionProof(request: ActionAdapterOperationRequest) {
  const { dependencies, note, snapshot, vaultRootUri } = request
  const folderReveal = await revealMobileFolderPath({
    folderPath: firstActionAdapterFolderPath(snapshot, note),
    revealer: dependencies.folderRevealer ?? proofFileRevealer,
    vaultRootUri,
  })
  const pdfExport = await exportMobileNoteAsPdf(
    note,
    dependencies.pdfExporter ?? proofPdfExporter,
  )

  return {
    folderRevealOpened: folderReveal.ok && folderReveal.opened,
    pdfExported: pdfExport.ok && pdfExport.uri !== null,
  }
}

function selectedActionAdapterNote(snapshot: MobileWorkspaceSnapshot): MobileNote | null {
  const notes = snapshot.allNotes ?? snapshot.notes
  return notes.find((note) => note.id === snapshot.selectedNoteId)
    ?? fallbackActionAdapterNote(snapshot.notes, notes)
}

function fallbackActionAdapterNote(visibleNotes: MobileNote[], allNotes: MobileNote[]) {
  return visibleNotes[0] ?? allNotes[0] ?? null
}

function firstActionAdapterFolderPath(snapshot: MobileWorkspaceSnapshot, note: MobileNote | null): string | null {
  return snapshot.folderPaths?.find((path) => path.trim().length > 0)
    ?? parentFolderPath(note?.path)
    ?? null
}

function parentFolderPath(path: string | undefined): string | null {
  const segments = path?.split('/').filter(Boolean) ?? []
  if (segments.length <= 1) return null

  return segments.slice(0, -1).join('/')
}

async function clipboardRoundTrip(
  text: ActionAdapterProbeText,
  dependencies: NativeMobileActionAdapterProbeDependencies,
): Promise<boolean> {
  try {
    await writeMobileClipboardText(text, dependencies.clipboardWriter)
    return await readMobileClipboardText(dependencies.clipboardReader) === text
  } catch {
    return false
  }
}

async function proofFileOpener() {
  return { opened: true, shared: false }
}

async function proofFileRevealer() {
  return { opened: true, shared: false }
}

async function proofPdfExporter(payload: Parameters<MobilePdfExporter>[0]) {
  return {
    shared: false,
    uri: `file:///memoria-mobile-qa/${encodeURIComponent(payload.fileName)}`,
  }
}
