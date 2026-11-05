import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import git, { type HttpClient } from 'isomorphic-git'
import { cloneGitVault } from './gitRemote'
import { gitTestEnvironment, startGitTestServer } from './gitTestServer'

const author = { name: 'Test', email: 'qa@example.invalid' }
const processOptions = { env: gitTestEnvironment(), stdio: 'pipe' as const }
type Exchange = { requestChunks: Buffer[]; receivedBytes: number }

export function requestText(exchange: Exchange) {
  return Buffer.concat(exchange.requestChunks).toString('utf8')
}

export async function createGitFetchFixture(branch = 'main') {
  const root = await mkdtemp(join(tmpdir(), 'memoria-fetch-base-'))
  let server: Awaited<ReturnType<typeof startGitTestServer>> | undefined
  const close = async () => {
    try { await server?.close() } finally { await rm(root, { recursive: true, force: true }) }
  }
  try {
    const remote = join(root, 'team/vault.git')
    const seed = join(root, 'seed')
    await seedRepository(seed, remote, branch)
    server = await startGitTestServer(root)
    const meter = measureTransport(server.http)
    const context = { fs, dir: join(root, 'client'), http: meter.http }
    await cloneGitVault(context, 'https://github.com/team/vault')
    const base = await git.resolveRef({ ...context, ref: 'HEAD' })
    const cloneBytes = meter.exchanges.reduce((sum, exchange) => sum + exchange.receivedBytes, 0)
    meter.exchanges.splice(0)
    return { context, meter, cloneBytes, base, remote, seed, close }
  } catch (error) {
    await close()
    throw error
  }
}

async function seedRepository(seed: string, remote: string, branch: string) {
  await mkdir(remote, { recursive: true })
  await mkdir(seed)
  execFileSync('git', ['init', '--bare', `--initial-branch=${branch}`, remote], processOptions)
  await git.init({ fs, dir: seed, defaultBranch: branch })
  for (let index = 0; index < 32; index++) {
    const lines = Array.from({ length: 64 }, (_, line) => createHash('sha256').update(`${index}-${line}`).digest('hex'))
    await writeFile(join(seed, `note-${index}.md`), `# Note ${index}\n${lines.join('\n')}\n`)
  }
  await writeFile(join(seed, 'attachment.bin'), new Uint8Array([0, 255, 128, 10]))
  await git.add({ fs, dir: seed, filepath: '.' })
  await git.commit({ fs, dir: seed, author, message: 'Fixture' })
  execFileSync('git', ['-C', seed, 'push', remote, branch], processOptions)
}

function measureTransport(client: HttpClient) {
  const exchanges: Exchange[] = []
  const http: HttpClient = { request: async request => {
    if (!request.url.endsWith('/git-upload-pack')) return client.request(request)
    const exchange: Exchange = { requestChunks: captureBody(request.body), receivedBytes: 0 }
    exchanges.push(exchange)
    const response = await client.request(request)
    return { ...response, body: observe(response.body, chunk => { exchange.receivedBytes += chunk.byteLength }) }
  } }
  return { http, exchanges }
}

function captureBody(body: unknown) {
  if (!Array.isArray(body)) throw new Error('Fixture requires a repeatable packet body')
  return body.map((chunk: unknown) => {
    if (!(chunk instanceof Uint8Array)) throw new Error('Invalid fixture packet chunk')
    return Buffer.from(chunk)
  })
}

async function* observe(body: AsyncIterableIterator<Uint8Array> | undefined, consume: (chunk: Uint8Array) => void) {
  if (!body) return
  for await (const chunk of body) { consume(chunk); yield chunk }
}
