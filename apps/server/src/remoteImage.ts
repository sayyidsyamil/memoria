import { type IncomingMessage, type RequestOptions, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { LookupFunction } from 'node:net'
import { posix } from 'node:path'
import { VaultError } from './errors.ts'
import { type AddressPolicy, guardedLookup, isPublicAddress, isRefusedLiteral } from './publicAddress.ts'

/**
 * Imports an image a pasted page points at into the vault (TOL-204), the way the desktop
 * app's `download_remote_image_to_vault` does. The URL comes from a client, so the fetch
 * only goes to public internet hosts: http(s) only, no credentials, every resolved address
 * checked (and the socket pinned to the checked address, so DNS cannot rebind it to an
 * internal one), every redirect checked again, and the size and the time capped.
 */

export interface RemoteImageLimits {
  maxBytes: number
  timeoutMs: number
  maxRedirects: number
}

export const REMOTE_IMAGE_LIMITS: RemoteImageLimits = {
  maxBytes: 15 * 1024 * 1024,
  timeoutMs: 15_000,
  maxRedirects: 5,
}

export interface RemoteImageOptions {
  limits?: Partial<RemoteImageLimits>
  isAllowedAddress?: AddressPolicy
  now?: () => number
}

export interface RemoteImage {
  /** Where the image goes: `attachments/<millis>-<name>.<ext>`, like the desktop app names it. */
  path: string
  bytes: Buffer
}

export type RemoteImageFetcher = (url: string) => Promise<RemoteImage>

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const IMAGE_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
  ['image/bmp', 'bmp'],
  ['image/x-ms-bmp', 'bmp'],
  ['image/tiff', 'tiff'],
])
const FALLBACK_NAME = 'remote-image'
const UNSAFE_NAME_CHARACTERS = /[^\p{L}\p{N}._-]/gu

function refused(message: string): VaultError {
  return new VaultError(400, 'invalid_request', message)
}

function unavailable(message: string): VaultError {
  return new VaultError(502, 'remote_unavailable', message)
}

function refusedAddress(): VaultError {
  return refused('private, loopback, link-local and metadata addresses are refused')
}

function parsedUrl(raw: string): URL {
  try {
    return new URL(raw)
  } catch {
    throw refused('url must be an absolute http or https URL')
  }
}

function hasCredentials(url: URL): boolean {
  return `${url.username}${url.password}` !== ''
}

function checkedUrl(url: URL, isAllowedAddress: AddressPolicy): URL {
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) throw refused('url must be an absolute http or https URL')
  if (hasCredentials(url)) throw refused('url must not carry credentials')
  if (isRefusedLiteral(url, isAllowedAddress)) throw refusedAddress()
  return url
}

interface FetchContext {
  lookup: LookupFunction
  signal: AbortSignal
  isAllowedAddress: AddressPolicy
}

function get(url: URL, { lookup, signal }: FetchContext): Promise<IncomingMessage> {
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest
  const options: RequestOptions = {
    method: 'GET',
    lookup,
    signal,
    agent: false,
    headers: { accept: 'image/*', 'user-agent': 'Memoria' },
  }
  return new Promise((resolve, reject) => {
    const outgoing = send(url, options, resolve)
    outgoing.on('error', reject)
    outgoing.end()
  })
}

function redirectTarget(response: IncomingMessage, current: URL): URL | null {
  const location = response.headers.location
  if (!REDIRECT_STATUSES.has(response.statusCode ?? 0) || !location) return null
  response.resume()
  return parsedUrl(new URL(location, current).href)
}

async function finalResponse(start: URL, context: FetchContext, maxRedirects: number): Promise<{ response: IncomingMessage; url: URL }> {
  let url = start
  for (let hops = 0; hops <= maxRedirects; hops++) {
    const response = await get(url, context)
    const next = redirectTarget(response, url)
    if (!next) return { response, url }
    url = checkedUrl(next, context.isAllowedAddress)
  }
  throw unavailable('the image redirects too many times')
}

function imageExtension(response: IncomingMessage): string {
  if (response.statusCode !== 200) throw unavailable(`the image host answered ${response.statusCode}`)
  const contentType = (response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  const extension = IMAGE_EXTENSIONS.get(contentType)
  if (!extension) throw refused('the url does not point to a supported image')
  return extension
}

function tooLarge(maxBytes: number): VaultError {
  return new VaultError(413, 'payload_too_large', `the image is larger than ${maxBytes} bytes`)
}

async function imageBytes(response: IncomingMessage, maxBytes: number): Promise<Buffer> {
  if (Number(response.headers['content-length'] ?? 0) > maxBytes) throw tooLarge(maxBytes)
  const chunks: Buffer[] = []
  let received = 0
  for await (const chunk of response) {
    received += (chunk as Buffer).byteLength
    if (received > maxBytes) throw tooLarge(maxBytes)
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

function lastSegment(url: URL): string {
  const segment = url.pathname.split('/').pop() ?? ''
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/** The URL's last segment without its extension (the content type picks that), made filename-safe. */
function attachmentName(url: URL, extension: string): string {
  const segment = lastSegment(url)
  const stem = posix.parse(segment).name.replace(UNSAFE_NAME_CHARACTERS, '_')
  return `${stem || FALLBACK_NAME}.${extension}`
}

function failure(error: unknown, signal: AbortSignal): VaultError {
  if (error instanceof VaultError) return error
  if (signal.aborted) return unavailable('the image took too long to download')
  return unavailable('the image could not be downloaded')
}

async function download(url: URL, context: FetchContext, limits: RemoteImageLimits): Promise<{ url: URL; extension: string; bytes: Buffer }> {
  const { response, url: finalUrl } = await finalResponse(url, context, limits.maxRedirects)
  try {
    const extension = imageExtension(response)
    return { url: finalUrl, extension, bytes: await imageBytes(response, limits.maxBytes) }
  } finally {
    response.destroy()
  }
}

/** Builds the fetcher the import route uses. */
export function remoteImageFetcher(options: RemoteImageOptions = {}): RemoteImageFetcher {
  const limits = { ...REMOTE_IMAGE_LIMITS, ...options.limits }
  const isAllowedAddress = options.isAllowedAddress ?? isPublicAddress
  const now = options.now ?? Date.now
  return async (raw) => {
    const start = checkedUrl(parsedUrl(raw), isAllowedAddress)
    const signal = AbortSignal.timeout(limits.timeoutMs)
    const context: FetchContext = { lookup: guardedLookup(isAllowedAddress, refusedAddress), signal, isAllowedAddress }
    try {
      const { url, extension, bytes } = await download(start, context, limits)
      return { path: `attachments/${now()}-${attachmentName(url, extension)}`, bytes }
    } catch (error) {
      throw failure(error, signal)
    }
  }
}
