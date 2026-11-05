type HtmlAttribute = string
type MobileAttachmentHref = string
type MobileAttachmentPath = string
type VaultRootUri = string | null | undefined

const attachmentsPrefix = 'attachments/'

export function mobileAttachmentUriForHref(
  href: MobileAttachmentHref,
  vaultRootUri?: VaultRootUri,
): string | null {
  const path = mobilePortableAttachmentPath(href) ?? mobilePortableAttachmentPathFromUri(href, vaultRootUri)
  if (!path || !vaultRootUri?.trim()) return null

  return joinVaultUri(vaultRootUri, path)
}

export function mobileHtmlWithResolvedAttachmentUris(
  html: string,
  vaultRootUri?: VaultRootUri,
): string {
  if (!vaultRootUri?.trim()) return html

  return html.replace(/\b(href|src)="([^"]*)"/gu, (_match, attribute: string, value: string) => {
    const resolved = mobileResolvedAttachmentHref(value, vaultRootUri)
    return `${attribute}="${escapeHtmlAttribute(resolved)}"`
  })
}

export function mobilePortableAttachmentHref(
  href: MobileAttachmentHref,
  vaultRootUri?: VaultRootUri,
): MobileAttachmentHref {
  return mobilePortableAttachmentPath(href)
    ?? mobilePortableAttachmentPathFromUri(href, vaultRootUri)
    ?? href
}

export function mobileResolvedAttachmentHref(
  href: MobileAttachmentHref,
  vaultRootUri?: VaultRootUri,
): MobileAttachmentHref {
  return mobileAttachmentUriForHref(href, vaultRootUri) ?? href
}

export function mobilePortableAttachmentPath(href: MobileAttachmentHref): MobileAttachmentPath | null {
  const path = stripMarkdownAngles(decodeHtmlAttribute(href).trim())
  return isSafePortableAttachmentPath(path) ? path : null
}

function mobilePortableAttachmentPathFromUri(
  href: MobileAttachmentHref,
  vaultRootUri?: VaultRootUri,
): MobileAttachmentPath | null {
  if (!vaultRootUri?.trim()) return null

  const uri = decodeUri(stripMarkdownAngles(decodeHtmlAttribute(href).trim()))
  const root = ensureTrailingSlash(decodeUri(vaultRootUri.trim()))
  if (!uri.startsWith(root)) return null

  return mobilePortableAttachmentPath(uri.slice(root.length))
}

function isSafePortableAttachmentPath(path: MobileAttachmentPath): boolean {
  if (!path.startsWith(attachmentsPrefix)) return false
  if (path.includes('\\') || path.includes('\0')) return false

  const segments = path.split('/')
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function joinVaultUri(rootUri: string, path: MobileAttachmentPath): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  return `${ensureTrailingSlash(rootUri.trim())}${encodedPath}`
}

function stripMarkdownAngles(value: MobileAttachmentHref): MobileAttachmentHref {
  return value.startsWith('<') && value.endsWith('>') ? value.slice(1, -1) : value
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

function decodeUri(value: string): string {
  try {
    return decodeURI(value)
  } catch {
    return value
  }
}

function decodeHtmlAttribute(value: HtmlAttribute): HtmlAttribute {
  return value
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&')
}

function escapeHtmlAttribute(value: HtmlAttribute): HtmlAttribute {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
}
