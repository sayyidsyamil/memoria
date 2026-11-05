import { useCallback } from 'react'
import type { MobileAttachmentImport } from './mobileAttachments'
import {
  importMobileAttachment,
  readMobileAttachmentImportFromGlobal,
  type MobileAttachmentFileSystem,
  type MobileDocumentPicker,
} from './mobileAttachmentImporterCore'

type ExpoDocumentPickerModule = {
  getDocumentAsync: MobileDocumentPicker
}

declare const require: (moduleName: string) => unknown

let expoDocumentPickerModule: ExpoDocumentPickerModule | null = null
let expoLegacyFileSystemModule: MobileAttachmentFileSystem | null = null

export type MobileAttachmentImporter = () => Promise<MobileAttachmentImport | null>

export function useMobileAttachmentImporter(vaultRootUri?: string | null): MobileAttachmentImporter {
  return useCallback(async () => {
    const deterministicImport = readMobileAttachmentImportFromGlobal()
    if (deterministicImport) return deterministicImport

    return importMobileAttachment({
      fileSystem: expoLegacyFileSystem(),
      pickDocument: expoDocumentPicker().getDocumentAsync,
      vaultRootUri,
    })
  }, [vaultRootUri])
}

function expoDocumentPicker(): ExpoDocumentPickerModule {
  expoDocumentPickerModule ??= require('expo-document-picker') as ExpoDocumentPickerModule
  return expoDocumentPickerModule
}

function expoLegacyFileSystem(): MobileAttachmentFileSystem {
  expoLegacyFileSystemModule ??= require('expo-file-system/legacy') as MobileAttachmentFileSystem
  return expoLegacyFileSystemModule
}
