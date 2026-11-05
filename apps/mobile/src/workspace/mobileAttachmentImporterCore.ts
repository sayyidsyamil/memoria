import {
  mobileAttachmentRelativePath,
  uniqueMobileAttachmentFileName,
  type MobileAttachmentImport,
} from './mobileAttachments'

export type MobileAttachmentImporterDependencies = {
  fileSystem: MobileAttachmentFileSystem
  nowMs?: () => number
  pickDocument: MobileDocumentPicker
}

export type MobileAttachmentFileSystem = {
  copyAsync: (options: { from: string; to: string }) => Promise<void>
  makeDirectoryAsync: (uri: string, options?: { intermediates?: boolean }) => Promise<void>
  readDirectoryAsync: (uri: string) => Promise<string[]>
}

export type MobileDocumentPicker = (options: {
  copyToCacheDirectory: boolean
  multiple: boolean
  type: string
}) => Promise<MobileDocumentPickerResult>

export type MobileDocumentPickerAsset = {
  mimeType?: string | null
  name?: string | null
  uri?: string | null
}

export type MobileDocumentPickerResult = {
  assets?: MobileDocumentPickerAsset[] | null
  canceled: boolean
}

export const MOBILE_ATTACHMENT_IMPORTS_GLOBAL_KEY = '__MEMORIA_MOBILE_ATTACHMENT_IMPORTS__'

export async function importMobileAttachment({
  fileSystem,
  nowMs = Date.now,
  pickDocument,
  vaultRootUri,
}: MobileAttachmentImporterDependencies & {
  vaultRootUri?: string | null
}): Promise<MobileAttachmentImport | null> {
  const rootUri = normalizedVaultRootUri(vaultRootUri)
  if (!rootUri) return null

  try {
    const result = await pickDocument({
      copyToCacheDirectory: true,
      multiple: false,
      type: '*/*',
    })
    if (result.canceled) return null

    const asset = firstPickedAttachmentAsset(result.assets)
    if (!asset) return null

    const attachmentsUri = `${rootUri}attachments/`
    await fileSystem.makeDirectoryAsync(attachmentsUri, { intermediates: true })

    const existingNames = await readExistingAttachmentNames(fileSystem, attachmentsUri)
    const fileName = uniqueMobileAttachmentFileName({
      existingNames,
      name: asset.name,
      nowMs: nowMs(),
    })
    const relativePath = mobileAttachmentRelativePath(fileName)

    await fileSystem.copyAsync({
      from: asset.uri,
      to: `${rootUri}${relativePath}`,
    })

    return {
      mimeType: asset.mimeType ?? null,
      name: asset.name,
      path: relativePath,
    }
  } catch {
    return null
  }
}

export function readMobileAttachmentImportFromGlobal(): MobileAttachmentImport | null {
  const target = globalThis as Record<string, unknown>
  const imports = target[MOBILE_ATTACHMENT_IMPORTS_GLOBAL_KEY]
  if (Array.isArray(imports)) return readNextAttachmentImport(target, imports)

  Reflect.deleteProperty(target, MOBILE_ATTACHMENT_IMPORTS_GLOBAL_KEY)
  return isMobileAttachmentImport(imports) ? imports : null
}

function readNextAttachmentImport(
  target: Record<string, unknown>,
  imports: unknown[],
): MobileAttachmentImport | null {
  const [nextImport, ...remainingImports] = imports
  target[MOBILE_ATTACHMENT_IMPORTS_GLOBAL_KEY] = remainingImports
  return isMobileAttachmentImport(nextImport) ? nextImport : null
}

function isMobileAttachmentImport(value: unknown): value is MobileAttachmentImport {
  if (!isRecord(value)) return false

  return typeof value.name === 'string'
    && typeof value.path === 'string'
    && (
      value.mimeType === undefined
      || value.mimeType === null
      || typeof value.mimeType === 'string'
    )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function firstPickedAttachmentAsset(
  assets: MobileDocumentPickerAsset[] | null | undefined,
): { mimeType?: string | null; name: string; uri: string } | null {
  const asset = assets?.[0]
  if (!asset) return null

  const name = asset.name?.trim()
  const uri = asset.uri?.trim()
  if (!name || !uri) return null

  return {
    mimeType: asset.mimeType,
    name,
    uri,
  }
}

async function readExistingAttachmentNames(
  fileSystem: MobileAttachmentFileSystem,
  attachmentsUri: string,
): Promise<string[]> {
  try {
    return await fileSystem.readDirectoryAsync(attachmentsUri)
  } catch {
    return []
  }
}

function normalizedVaultRootUri(vaultRootUri: string | null | undefined): string | null {
  const trimmed = vaultRootUri?.trim()
  if (!trimmed) return null

  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}
