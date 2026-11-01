import type { RemoteAttachments } from '../../packages/collab-client/src/remoteAttachments'
import { type RemoteImageImportResult, type RemotePasteImage, importRemoteImagesWith } from '../utils/remoteImagePaste'
import { resolveWebAttachmentUrl } from '../utils/vaultAttachments'
import { assertVaultWritable } from './offline/offlineMode'
import { trackEvent } from './telemetry'
import { createRemoteAttachmentClient } from './vaultBackend'

/**
 * Images on a Memoria remote (TOL-204), loaded only once an editor needs them: uploads and
 * imports become files under `attachments/` on the server, and notes link them with the same
 * portable `attachments/...` path the desktop app writes. Display goes through an object URL
 * because the server only answers requests that carry the session's bearer token.
 */

const objectUrls = new Map<string, Promise<string>>()

function attachments(): RemoteAttachments {
  const client = createRemoteAttachmentClient()
  if (!client) throw new Error('No Memoria remote is configured')
  return client
}

/** Stores a pasted, dropped or picked image; resolves with the path the note links. */
export async function uploadRemoteImage(file: File): Promise<string> {
  assertVaultWritable('uploading an image')
  const client = attachments()
  const bytes = new Uint8Array(await file.arrayBuffer())
  const { path } = await client.save({ filename: file.name, bytes })
  trackEvent('web_attachment_uploaded', { mime_type: file.type || 'unknown', size_bytes: bytes.byteLength })
  return path
}

function attachmentObjectUrl(attachmentPath: string): Promise<string> {
  const cached = objectUrls.get(attachmentPath)
  if (cached) return cached

  const loaded = attachments().read(attachmentPath).then(blob => URL.createObjectURL(blob))
  objectUrls.set(attachmentPath, loaded)
  // A failed read is retried the next time the image renders.
  loaded.catch(() => objectUrls.delete(attachmentPath))
  return loaded
}

/** The URL an editor shows for an image: an object URL for vault attachments. */
export function resolveRemoteAttachmentUrl(url: string): Promise<string> {
  return resolveWebAttachmentUrl({ url, loadAttachmentUrl: attachmentObjectUrl })
}

/** Has the server download pasted remote images into the vault, within its SSRF limits. */
export function importRemoteImagesToVault(images: RemotePasteImage[]): Promise<RemoteImageImportResult> {
  assertVaultWritable('importing images')
  const client = attachments()
  return importRemoteImagesWith(images, image => client.importFromUrl(image.url).then(({ path }) => path))
}
