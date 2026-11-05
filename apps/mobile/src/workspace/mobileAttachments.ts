export type MobileAttachmentImport = {
  mimeType?: string | null
  name: string
  path: string
}

type UniqueAttachmentNameInput = {
  existingNames?: readonly string[]
  name: string
  nowMs: number
}

const attachmentsPrefix = 'attachments/'
const imageExtensions = new Set(['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'tif', 'tiff', 'webp'])

export function mobileAttachmentRelativePath(fileName: string): string {
  return `${attachmentsPrefix}${fileName}`
}

export function uniqueMobileAttachmentFileName({
  existingNames = [],
  name,
  nowMs,
}: UniqueAttachmentNameInput): string {
  const safeName = safeMobileAttachmentFileName(name)
  const baseName = `${Math.max(0, Math.trunc(nowMs))}-${safeName}`
  const names = new Set(existingNames)
  if (!names.has(baseName)) return baseName

  for (let index = 2; index < Number.MAX_SAFE_INTEGER; index += 1) {
    const candidate = `${Math.max(0, Math.trunc(nowMs))}-${index}-${safeName}`
    if (!names.has(candidate)) return candidate
  }

  return baseName
}

export function safeMobileAttachmentFileName(name: string): string {
  const sanitized = name.trim().replaceAll(/[^A-Za-z0-9._-]/gu, '_').replaceAll(/_+/gu, '_')
  return sanitized.replaceAll(/^\.+/gu, '') || 'attachment'
}

export function mobileAttachmentMarkdown(attachment: MobileAttachmentImport): string {
  const destination = escapedMarkdownDestination(attachment.path)
  if (isMobileImageAttachment(attachment)) return `![${escapedMarkdownLabel(attachment.name)}](${destination})`

  return `[${escapedMarkdownLabel(attachment.name)}](${destination})`
}

export function isMobileImageAttachment({
  mimeType,
  name,
  path,
}: Pick<MobileAttachmentImport, 'mimeType' | 'name' | 'path'>): boolean {
  if (mimeType?.toLowerCase().startsWith('image/')) return true

  return imageExtensions.has(attachmentExtension(path) || attachmentExtension(name))
}

function attachmentExtension(value: string): string {
  const path = value.split(/[?#]/u)[0] ?? value
  const name = path.split('/').at(-1) ?? path
  const extension = name.includes('.') ? name.split('.').at(-1) : ''
  return extension?.toLowerCase() ?? ''
}

function escapedMarkdownLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll(']', '\\]')
}

function escapedMarkdownDestination(value: string): string {
  const escaped = value.replaceAll('>', '%3E')
  return /[\s<>]/u.test(value) ? `<${escaped}>` : escaped.replaceAll('\\', '\\\\').replaceAll(')', '\\)')
}
