import { useCallback } from 'react'
import type { MobileAttachmentImport } from './mobileAttachments'
import { readMobileAttachmentImportFromGlobal } from './mobileAttachmentImporterCore'

export {
  importMobileAttachment,
  MOBILE_ATTACHMENT_IMPORTS_GLOBAL_KEY,
  readMobileAttachmentImportFromGlobal,
  type MobileAttachmentFileSystem,
  type MobileAttachmentImporterDependencies,
  type MobileDocumentPicker,
  type MobileDocumentPickerAsset,
  type MobileDocumentPickerResult,
} from './mobileAttachmentImporterCore'

export type MobileAttachmentImporter = () => Promise<MobileAttachmentImport | null>

export function useMobileAttachmentImporter(vaultRootUri?: string | null): MobileAttachmentImporter {
  void vaultRootUri
  return useCallback(async () => readMobileAttachmentImportFromGlobal(), [])
}
