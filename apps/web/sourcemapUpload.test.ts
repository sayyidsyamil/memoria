import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { uploadConfigFromEnv, uploadSourceMaps, type SentryUploadConfig } from './sourcemapUpload.ts'

const TOKEN = 'test-token-not-a-secret'

interface RecordedRequest {
  authorization: string | undefined
  body: string
  method: string | undefined
  url: string | undefined
}

const requests: RecordedRequest[] = []
const statusQueue: number[] = []
let baseUrl = ''

const server = createServer((req: IncomingMessage, res) => {
  const chunks: Buffer[] = []
  req.on('data', (chunk: Buffer) => chunks.push(chunk))
  req.on('end', () => {
    requests.push({
      authorization: req.headers.authorization,
      body: Buffer.concat(chunks).toString('utf8'),
      method: req.method,
      url: req.url,
    })
    res.statusCode = statusQueue.shift() ?? 201
    res.end('{}')
  })
})

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(() => {
  server.close()
})

function buildOutput(release: string): { distDir: string; mapsDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'memoria-upload-'))
  const distDir = join(root, 'dist')
  const mapsDir = join(root, 'sourcemaps')
  mkdirSync(join(distDir, 'assets'), { recursive: true })
  mkdirSync(join(mapsDir, 'assets'), { recursive: true })
  writeFileSync(join(distDir, 'assets/index-a.js'), 'console.log(1)')
  writeFileSync(join(mapsDir, 'assets/index-a.js.map'), '{"version":3}')
  const files = [{ file: 'assets/index-a.js', map: 'assets/index-a.js.map' }]
  writeFileSync(join(mapsDir, 'manifest.json'), JSON.stringify({ release, files }))
  return { distDir, mapsDir }
}

function config(): SentryUploadConfig {
  return { baseUrl, org: 'memoria', project: 'memoria-web', token: TOKEN }
}

function resetServer(statuses: number[] = []): void {
  requests.length = 0
  statusQueue.length = 0
  statusQueue.push(...statuses)
}

describe('upload configuration', () => {
  it('is skipped without an upload token', () => {
    assert.equal(uploadConfigFromEnv({}), null)
    assert.equal(uploadConfigFromEnv({ SENTRY_AUTH_TOKEN: '  ', SENTRY_ORG: 'o' }), null)
  })

  it('needs the organization and project once a token is set', () => {
    assert.throws(() => uploadConfigFromEnv({ SENTRY_AUTH_TOKEN: TOKEN, SENTRY_PROJECT: 'p' }), /SENTRY_ORG/)
    assert.throws(() => uploadConfigFromEnv({ SENTRY_AUTH_TOKEN: TOKEN, SENTRY_ORG: 'o' }), /SENTRY_PROJECT/)
  })

  it('defaults to sentry.io and accepts a self-hosted URL', () => {
    const env = { SENTRY_AUTH_TOKEN: TOKEN, SENTRY_ORG: 'o', SENTRY_PROJECT: 'p' }
    assert.equal(uploadConfigFromEnv(env)?.baseUrl, 'https://sentry.io')
    assert.equal(uploadConfigFromEnv({ ...env, SENTRY_URL: 'https://sentry.example.com/' })?.baseUrl, 'https://sentry.example.com')
  })
})

describe('source map upload', () => {
  it('creates the release, then uploads each bundle file with its map', async () => {
    resetServer()
    const result = await uploadSourceMaps({ config: config(), ...buildOutput('memoria-web@abc1234') })

    assert.deepEqual(result, { release: 'memoria-web@abc1234', files: 2 })
    assert.equal(requests.length, 3)
    assert.ok(requests.every((request) => request.authorization === `Bearer ${TOKEN}`))
    assert.equal(requests[0].url, '/api/0/organizations/memoria/releases/')
    assert.deepEqual(JSON.parse(requests[0].body), { version: 'memoria-web@abc1234', projects: ['memoria-web'] })

    const uploads = requests.slice(1)
    assert.ok(uploads.every((request) => request.url === '/api/0/organizations/memoria/releases/memoria-web%40abc1234/files/'))
    const bundleFile = uploads.find((request) => request.body.includes('~/assets/index-a.js\r\n'))
    assert.match(bundleFile?.body ?? '', /Sourcemap:index-a\.js\.map/)
    assert.ok(uploads.some((request) => request.body.includes('~/assets/index-a.js.map')))
  })

  it('accepts files already uploaded to the release and retries busy responses', async () => {
    resetServer([208, 503, 409, 201])
    const result = await uploadSourceMaps({ config: config(), retryDelayMs: 1, ...buildOutput('memoria-web@abc1234') })

    assert.equal(result.files, 2)
    assert.equal(requests.length, 4)
  })

  it('fails when Sentry rejects a file', async () => {
    resetServer([201, 403, 403])
    await assert.rejects(
      uploadSourceMaps({ config: config(), ...buildOutput('memoria-web@abc1234') }),
      /HTTP 403/,
    )
  })

  it('fails when the release cannot be created', async () => {
    resetServer([400])
    await assert.rejects(
      uploadSourceMaps({ config: config(), ...buildOutput('memoria-web@abc1234') }),
      /creating release memoria-web@abc1234 failed: HTTP 400/,
    )
  })

  it('refuses a build without a release', async () => {
    resetServer()
    await assert.rejects(uploadSourceMaps({ config: config(), ...buildOutput('') }), /names no release/)
    assert.equal(requests.length, 0)
  })
})
