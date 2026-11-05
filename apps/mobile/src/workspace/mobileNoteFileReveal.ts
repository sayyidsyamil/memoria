import type { SharingOptions } from 'expo-sharing'
import type { MobileNote } from './mobileWorkspaceModel'
import { buildMobileFilePathForNote, buildMobileFilePathForRelativePath } from './mobileNoteFilePath'

export const MOBILE_FILE_REVEAL_ATTEMPTS_GLOBAL_KEY = '__MEMORIA_MOBILE_FILE_REVEAL_ATTEMPTS__'
export const MOBILE_FILE_REVEALS_GLOBAL_KEY = '__MEMORIA_MOBILE_FILE_REVEALS__'

export type MobileFileRevealResult =
  | { ok: true; opened: boolean; path: string; shared: boolean }
  | { ok: false; reason: 'missingNote' | 'missingPath' | 'unsafePath' }

export type MobileFileRevealer = (path: string) => Promise<MobileFileRevealerResult>
export type MobileFileRevealerResult = boolean | undefined | {
  opened?: boolean
  shared?: boolean
}

type ExpoSharingModule = {
  isAvailableAsync: () => Promise<boolean>
  shareAsync: (url: string, options?: SharingOptions) => Promise<void>
}
type LinkingModule = {
  Linking: {
    openURL: (url: string) => Promise<unknown>
  }
}
type MobileNoteRevealInput = {
  note: MobileNote | null
  revealer?: MobileFileRevealer
  vaultRootUri?: string | null
}
type MobileFolderRevealInput = {
  folderPath: string | null | undefined
  revealer?: MobileFileRevealer
  vaultRootUri?: string | null
}
type MobileRevealInput = MobileFolderRevealInput | MobileNoteRevealInput

declare const require: (moduleName: string) => unknown

export const revealMobileNoteFile: (input: MobileNoteRevealInput) => Promise<MobileFileRevealResult> = revealMobileFile

export const revealMobileFolderPath: (input: MobileFolderRevealInput) => Promise<MobileFileRevealResult> = revealMobileFile

async function revealMobileFile(input: MobileRevealInput): Promise<MobileFileRevealResult> {
  if ('note' in input) return revealNoteTarget(input)
  return revealFolderTarget(input)
}

async function revealNoteTarget(input: MobileNoteRevealInput): Promise<MobileFileRevealResult> {
  const result = buildMobileFilePathForNote({ note: input.note, vaultRootUri: input.vaultRootUri })
  if (!result.ok) return { ok: false, reason: result.error === 'missing_note' ? 'missingNote' : 'unsafePath' }
  return revealMobileSafePath({
    evidence: revealEvidence(result.path, input.note),
    path: result.path,
    revealer: input.revealer ?? revealNativeMobileFile,
  })
}

async function revealFolderTarget(input: MobileFolderRevealInput): Promise<MobileFileRevealResult> {
  const result = buildMobileFilePathForRelativePath({ path: input.folderPath, vaultRootUri: input.vaultRootUri })
  if (!result.ok) return { ok: false, reason: result.error === 'missing_path' ? 'missingPath' : 'unsafePath' }
  return revealMobileSafePath({
    evidence: revealFolderEvidence({ folderPath: input.folderPath, path: result.path }),
    path: result.path,
    revealer: input.revealer ?? revealNativeMobileFile,
  })
}

async function revealMobileSafePath({
  evidence,
  path,
  revealer,
}: {
  evidence: unknown
  path: string
  revealer: MobileFileRevealer
}): Promise<MobileFileRevealResult> {
  recordGlobalValue(MOBILE_FILE_REVEAL_ATTEMPTS_GLOBAL_KEY, evidence)
  if (isBrowserRuntime()) return { ok: true, opened: false, path, shared: false }

  const revealResult = await revealer(path)
  const revealed = revealedMobileFileResult(path, revealResult)
  recordGlobalValue(MOBILE_FILE_REVEALS_GLOBAL_KEY, revealed)
  return revealed
}

async function revealNativeMobileFile(path: string): Promise<MobileFileRevealerResult> {
  const sharing = require('expo-sharing') as ExpoSharingModule
  if (await sharing.isAvailableAsync()) {
    await sharing.shareAsync(path, { dialogTitle: fileNameFromPath(path) })
    return { opened: true, shared: true }
  }

  const { Linking } = require('react-native') as LinkingModule
  await Linking.openURL(path)
  return { opened: true, shared: false }
}

function revealedMobileFileResult(path: string, nativeResult: MobileFileRevealerResult): Extract<MobileFileRevealResult, { ok: true }> {
  if (nativeResult && typeof nativeResult === 'object') {
    return {
      ok: true,
      opened: nativeResult.opened !== false,
      path,
      shared: nativeResult.shared === true,
    }
  }

  return {
    ok: true,
    opened: nativeResult !== false,
    path,
    shared: false,
  }
}

function revealEvidence(path: string, note: MobileNote | null) {
  return {
    noteId: note?.id ?? null,
    path,
    title: note?.title ?? null,
  }
}

function revealFolderEvidence({
  folderPath,
  path,
}: {
  folderPath: string | null | undefined
  path: string
}) {
  return {
    folderPath: folderPath ?? null,
    path,
  }
}

function fileNameFromPath(path: string): string {
  const fileName = path.split(/[/?#]/u).filter(Boolean).at(-1)
  return fileName ? decodeURIComponent(fileName) : 'note'
}

function isBrowserRuntime(): boolean {
  return typeof document !== 'undefined'
}

function recordGlobalValue(key: string, value: unknown) {
  const target = globalThis as Record<string, unknown>
  const current = target[key]
  const values = Array.isArray(current) ? current : []
  values.push(value)
  target[key] = values
}
