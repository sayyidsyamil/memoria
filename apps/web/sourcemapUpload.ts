import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

// TOL-232: uploads the web build's hidden source maps to Sentry through its HTTP API (release
// files), so web stack traces map back to source. The deploy runs it after `pnpm build:web`;
// without SENTRY_AUTH_TOKEN it does nothing. Each bundle file is uploaded with a `Sourcemap`
// header naming its map, because the served file carries no sourceMappingURL comment.

const DEFAULT_SENTRY_URL = 'https://sentry.io'
const MANIFEST_FILE = 'manifest.json'
const UPLOAD_CONCURRENCY = 8
const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 1_000

type Env = Record<string, string | undefined>
type EnvName = string
type ApiPath = string
type DirectoryPath = string
type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface SentryUploadConfig {
  baseUrl: string
  org: string
  project: string
  token: string
}

interface ManifestEntry {
  file: string
  map: string
}

interface Manifest {
  release: string
  files: ManifestEntry[]
}

interface ReleaseFile {
  name: string
  path: string
  sourcemap?: string
}

export interface UploadOptions {
  config: SentryUploadConfig
  distDir: DirectoryPath
  mapsDir: DirectoryPath
  fetchImpl?: FetchLike
  retryDelayMs?: number
}

interface BuildOutput {
  distDir: DirectoryPath
  mapsDir: DirectoryPath
}

interface UploadContext {
  config: SentryUploadConfig
  fetchImpl: FetchLike
  release: string
  retryDelayMs: number
}

function required(env: Env, name: EnvName): string {
  const value = (env[name] ?? '').trim()
  if (!value) throw new Error(`${name} is not set (needed with SENTRY_AUTH_TOKEN)`)
  return value
}

/** null when no upload token is configured: the upload is skipped, nothing else is required. */
export function uploadConfigFromEnv(env: Env): SentryUploadConfig | null {
  const token = (env.SENTRY_AUTH_TOKEN ?? '').trim()
  if (!token) return null
  return {
    baseUrl: (env.SENTRY_URL ?? '').trim().replace(/\/+$/, '') || DEFAULT_SENTRY_URL,
    org: required(env, 'SENTRY_ORG'),
    project: required(env, 'SENTRY_PROJECT'),
    token,
  }
}

async function readManifest({ mapsDir }: BuildOutput): Promise<Manifest> {
  const manifest = JSON.parse(await readFile(join(mapsDir, MANIFEST_FILE), 'utf8')) as Manifest
  if (!manifest.release) throw new Error('the source map manifest names no release (no git commit at build time?)')
  return manifest
}

function releaseFiles(manifest: Manifest, { distDir, mapsDir }: BuildOutput): ReleaseFile[] {
  return manifest.files.flatMap(({ file, map }) => [
    { name: `~/${file}`, path: join(distDir, file), sourcemap: basename(map) },
    { name: `~/${map}`, path: join(mapsDir, map) },
  ])
}

function apiUrl(config: SentryUploadConfig, path: ApiPath): string {
  return `${config.baseUrl}/api/0/organizations/${encodeURIComponent(config.org)}/${path}`
}

function isRetryable(response: Response): boolean {
  return response.status === 429 || response.status >= 500
}

function pauseBeforeRetry(context: UploadContext, attempt: number): Promise<void> {
  return delay(context.retryDelayMs * attempt)
}

async function send(context: UploadContext, path: ApiPath, init: () => RequestInit): Promise<Response> {
  const headers = { Authorization: `Bearer ${context.config.token}` }
  for (let attempt = 1; ; attempt += 1) {
    const requestInit = init()
    const response = await context.fetchImpl(apiUrl(context.config, path), {
      ...requestInit,
      headers: { ...headers, ...requestInit.headers },
    })
    if (!isRetryable(response) || attempt >= MAX_ATTEMPTS) return response
    await pauseBeforeRetry(context, attempt)
  }
}

async function createRelease(context: UploadContext): Promise<void> {
  const { release } = context
  const body = JSON.stringify({ version: release, projects: [context.config.project] })
  const response = await send(context, 'releases/', () => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }))
  if (!response.ok) throw new Error(`creating release ${release} failed: HTTP ${response.status}`)
}

function releaseFileForm(file: ReleaseFile, content: Buffer): FormData {
  const form = new FormData()
  form.set('name', file.name)
  if (file.sourcemap) form.set('header', `Sourcemap:${file.sourcemap}`)
  form.set('file', new Blob([new Uint8Array(content)]), basename(file.path))
  return form
}

async function uploadFile(context: UploadContext, file: ReleaseFile): Promise<void> {
  const content = await readFile(file.path)
  const path = `releases/${encodeURIComponent(context.release)}/files/`
  const response = await send(context, path, () => ({ method: 'POST', body: releaseFileForm(file, content) }))
  // 409: the file is already in this release (a redeploy of the same commit).
  if (!response.ok && response.status !== 409) {
    throw new Error(`uploading ${file.name} failed: HTTP ${response.status}`)
  }
}

/** Stops taking files after the first failure and returns only once no request is in flight. */
async function uploadAll(context: UploadContext, files: ReleaseFile[]): Promise<void> {
  const queue = [...files]
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      try {
        await uploadFile(context, file)
      } catch (error) {
        queue.length = 0
        throw error
      }
    }
  }
  const results = await Promise.allSettled(Array.from({ length: UPLOAD_CONCURRENCY }, worker))
  const failure = results.find((result) => result.status === 'rejected')
  if (failure) throw failure.reason
}

/** Creates the release named in the manifest and uploads every bundle file with its map. */
export async function uploadSourceMaps(options: UploadOptions): Promise<{ release: string; files: number }> {
  const manifest = await readManifest(options)
  const context: UploadContext = {
    config: options.config,
    fetchImpl: options.fetchImpl ?? fetch,
    release: manifest.release,
    retryDelayMs: options.retryDelayMs ?? RETRY_DELAY_MS,
  }
  const files = releaseFiles(manifest, options)
  await createRelease(context)
  await uploadAll(context, files)
  return { release: manifest.release, files: files.length }
}
