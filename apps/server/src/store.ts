import { createHash, createHmac } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { LookupFunction } from 'node:net'
import { dirname, join } from 'node:path'
import { type AddressPolicy, type AddressResolver, guardedLookup, isPublicAddress, isRefusedLiteral } from './publicAddress.ts'

/** A `/`-separated key, like an S3 object key. */
export type StoreKey = string

/**
 * Key/value storage for server-side state that is not part of the vault's git history
 * (the doc index, later Y.Doc snapshots). Keys are `/`-separated, so the same interface maps
 * onto an S3-compatible bucket; the spike only ships the local-disk implementation.
 */
export interface BlobStore {
  get(key: StoreKey): Promise<Uint8Array | null>
  put(key: StoreKey, bytes: Uint8Array): Promise<void>
  delete(key: StoreKey): Promise<void>
  list(prefix: StoreKey): Promise<string[]>
}

const SAFE_KEY = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/

/** Keys are a closed alphabet with no dot-led segment, so a key cannot leave the root or the bucket. */
function checkedKey(key: StoreKey): StoreKey {
  if (!SAFE_KEY.test(key)) throw new Error(`invalid store key: ${key}`)
  return key
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

export class LocalDiskStore implements BlobStore {
  private readonly root: string
  private writes = 0

  constructor(root: string) {
    this.root = root
  }

  async get(key: StoreKey): Promise<Uint8Array | null> {
    try {
      return await readFile(this.file(key))
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  /** Atomic: readers see the old or the new value, never a torn one. */
  async put(key: StoreKey, bytes: Uint8Array): Promise<void> {
    const file = this.file(key)
    const temp = `${file}.${process.pid}.${this.writes++}.tmp`
    await mkdir(dirname(file), { recursive: true })
    await writeFile(temp, bytes)
    await rename(temp, file)
  }

  async delete(key: StoreKey): Promise<void> {
    await rm(this.file(key), { force: true })
  }

  async list(prefix: StoreKey): Promise<string[]> {
    try {
      const names = await readdir(this.file(prefix))
      return names.filter((name) => !name.endsWith('.tmp')).map((name) => `${prefix}/${name}`)
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
  }

  private file(key: StoreKey): string {
    return join(this.root, checkedKey(key))
  }
}

export interface R2Config {
  bucket: string
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
}

const EMPTY_SHA256 = createHash('sha256').digest('hex')

/** A path segment as SigV4 canonicalizes it: RFC 3986, unreserved characters left alone. */
const SUB_DELIMS = /[!\x27()*]/g

function uriEncode(segment: string): string {
  return encodeURIComponent(segment).replace(SUB_DELIMS, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** How a store request is sent: the clock it signs with and the addresses it may connect to. */
export interface R2Options {
  now?: () => Date
  /** Defaults to public addresses only (TOL-207); tests and a development MinIO widen it. */
  isAllowedAddress?: AddressPolicy
  /** The DNS lookup each connection's addresses come from; tests swap it. */
  resolveHost?: AddressResolver
}

interface StoreResponse {
  status: number
  statusText: string
  body: Buffer
}

const SIGV4_SERVICE = 's3'

export type StoreMethod = 'GET' | 'PUT' | 'DELETE'
type Operation = StoreMethod | 'LIST'

function refusedEndpoint(): Error {
  return new Error('R2 endpoint refused: private, loopback, link-local and metadata addresses are not allowed')
}

function isOk(response: StoreResponse): boolean {
  return response.status >= 200 && response.status < 300
}

function failed(operation: Operation, response: StoreResponse): Error {
  return new Error(`R2 ${operation} failed: ${response.status} ${response.statusText}`)
}

function listedKeys(xml: string): string[] {
  return Array.from(xml.matchAll(/<Key>([^<]+)<\/Key>/g), (match) => match[1])
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

/**
 * S3-compatible BlobStore implementation for Cloudflare R2 (or any S3-compatible service).
 * Uses AWS Signature Version 4 for authentication. Every connection goes through the
 * address policy after its own DNS lookup, so the endpoint cannot be rebound to an internal host.
 */
export class R2BlobStore implements BlobStore {
  private readonly config: R2Config
  private readonly now: () => Date
  private readonly isAllowedAddress: AddressPolicy
  private readonly lookup: LookupFunction

  constructor(config: R2Config, options: R2Options = {}) {
    this.config = config
    this.now = options.now ?? (() => new Date())
    this.isAllowedAddress = options.isAllowedAddress ?? isPublicAddress
    this.lookup = guardedLookup(this.isAllowedAddress, refusedEndpoint, options.resolveHost)
  }

  async get(key: StoreKey): Promise<Uint8Array | null> {
    const response = await this.request('GET', this.objectUrl(key))
    if (response.status === 404) return null
    if (!isOk(response)) throw failed('GET', response)
    return new Uint8Array(response.body)
  }

  async put(key: StoreKey, bytes: Uint8Array): Promise<void> {
    const response = await this.request('PUT', this.objectUrl(key), bytes)
    if (!isOk(response)) throw failed('PUT', response)
  }

  async delete(key: StoreKey): Promise<void> {
    const response = await this.request('DELETE', this.objectUrl(key))
    if (!isOk(response) && response.status !== 404) throw failed('DELETE', response)
  }

  async list(prefix: StoreKey): Promise<string[]> {
    const url = new URL(this.config.endpoint)
    url.pathname = `/${this.config.bucket}/`
    // As SigV4 canonicalizes it: sorted by name, values RFC 3986-encoded (URLSearchParams would send `+`).
    url.search = `list-type=2&prefix=${uriEncode(`${checkedKey(prefix)}/`)}`
    const response = await this.request('GET', url)
    if (!isOk(response)) throw failed('LIST', response)
    return listedKeys(response.body.toString('utf8'))
  }

  /** A signed request to the configured endpoint: its URL always comes from `objectUrl` or `list`. */
  private request(method: StoreMethod, url: URL, body?: Uint8Array): Promise<StoreResponse> {
    if (isRefusedLiteral(url, this.isAllowedAddress)) return Promise.reject(refusedEndpoint())
    const headers: Record<string, string> = { ...this.signRequest(method, url, body) }
    if (body) headers['Content-Length'] = String(body.byteLength)
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest
    return new Promise((resolve, reject) => {
      const outgoing = send(url, { method, headers, lookup: this.lookup }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('error', reject)
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, statusText: response.statusMessage ?? '', body: Buffer.concat(chunks) }),
        )
      })
      outgoing.on('error', reject)
      outgoing.end(body)
    })
  }

  private objectUrl(key: StoreKey): URL {
    const url = new URL(this.config.endpoint)
    url.pathname = `/${uriEncode(this.config.bucket)}/${checkedKey(key).split('/').map(uriEncode).join('/')}`
    return url
  }

  /**
   * Sign an S3 request using AWS Signature Version 4.
   * This implements the canonical request signing process without external dependencies.
   * Node sends the host header itself; it is signed all the same.
   */
  signRequest(method: StoreMethod, url: URL, body?: Uint8Array): Record<string, string> {
    const amzDate = this.now().toISOString().replace(/[:-]|\.\d{3}/g, '')
    const dateStamp = amzDate.slice(0, 8)
    const payloadHash = body ? createHash('sha256').update(body).digest('hex') : EMPTY_SHA256
    const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
    const canonicalRequest = [method, url.pathname, url.search.slice(1), canonicalHeaders, signedHeaders, payloadHash].join('\n')
    const canonicalRequestHash = createHash('sha256').update(canonicalRequest).digest('hex')
    const credentialScope = `${dateStamp}/${this.config.region}/${SIGV4_SERVICE}/aws4_request`
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, canonicalRequestHash].join('\n')
    const signature = createHmac('sha256', this.signingKey(dateStamp)).update(stringToSign).digest('hex')
    const authorizationHeader = [
      `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(', ')
    return {
      'X-Amz-Date': amzDate,
      'X-Amz-Content-Sha256': payloadHash,
      'Authorization': authorizationHeader,
    }
  }

  private signingKey(dateStamp: string): Buffer {
    const kDate = hmac(`AWS4${this.config.secretAccessKey}`, dateStamp)
    const kRegion = hmac(kDate, this.config.region)
    const kService = hmac(kRegion, SIGV4_SERVICE)
    return hmac(kService, 'aws4_request')
  }
}
