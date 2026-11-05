import { hasRemoteVault } from '../lib/vaultBackend'
import { webAttachmentPath } from '../utils/vaultAttachments'

export type RichEditorFileUrlResolver = (url: string) => Promise<string>

/** A vault attachment is fetched with the session's token, in code loaded only then. */
async function resolveRemoteFileUrl(url: string): Promise<string> {
  if (!webAttachmentPath({ url })) return url
  const { resolveRemoteAttachmentUrl } = await import('../lib/remoteAttachments')
  return resolveRemoteAttachmentUrl(url)
}

/**
 * BlockNote's `resolveFileUrl` (TOL-204): only a Memoria remote needs one, because its
 * attachments need the token. Desktop and the mock browser get none, so BlockNote keeps
 * showing and opening their URLs directly, exactly as before.
 */
export function richEditorFileUrlResolver(): RichEditorFileUrlResolver | undefined {
  return hasRemoteVault() ? resolveRemoteFileUrl : undefined
}
