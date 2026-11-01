import { hasRemoteVault } from '../lib/vaultBackend'
import { importRemoteImages, type RemoteImageImportResult, type RemotePasteImage } from '../utils/remoteImagePaste'
import { vaultAttachmentAssetUrl } from '../utils/vaultAttachments'

export type ImportRemoteImages = (request: {
  images: RemotePasteImage[]
  vaultPath: string
}) => Promise<RemoteImageImportResult>

/** Where pasted remote images go, and the URL an image block gets for a stored one. */
export type RemoteImageImportTarget = {
  importImages: (images: RemotePasteImage[]) => Promise<RemoteImageImportResult>
  attachmentUrl: (attachmentPath: string) => string
}

type RemoteImageImportOptions = {
  importImages?: ImportRemoteImages
  vaultPath?: string
}

/** On a Memoria remote the server downloads the images and notes link their portable path (TOL-204). */
async function importImagesToRemoteVault(images: RemotePasteImage[]): Promise<RemoteImageImportResult> {
  const { importRemoteImagesToVault } = await import('../lib/remoteAttachments')
  return importRemoteImagesToVault(images)
}

/** Null when pasted remote images stay remote: no remote and no open vault. */
export function remoteImageImportTarget(options: RemoteImageImportOptions): RemoteImageImportTarget | null {
  if (hasRemoteVault()) {
    return { importImages: importImagesToRemoteVault, attachmentUrl: attachmentPath => attachmentPath }
  }
  const { vaultPath } = options
  if (!vaultPath) return null

  const importImages = options.importImages ?? importRemoteImages
  return {
    importImages: images => importImages({ images, vaultPath }),
    attachmentUrl: attachmentPath => vaultAttachmentAssetUrl({ attachmentPath, vaultPath }),
  }
}
