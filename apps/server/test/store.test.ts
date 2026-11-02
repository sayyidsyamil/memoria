import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalDiskStore, R2BlobStore, type StoreMethod } from '../src/store.ts'
import { text } from './helpers.ts'

function listEntry(key: string): string {
  return `<Contents><Key>${key}</Key></Contents>`
}

/**
 * Minimal in-process S3-compatible fake for testing R2BlobStore.
 * Implements GET/PUT/DELETE/LIST without real credentials.
 */
class FakeS3Server {
  private server: Server
  private storage = new Map<string, Uint8Array>()
  readonly paths: string[] = []
  /** When set, every request is answered with this status. */
  failWith = 0
  private port = 0

  constructor() {
    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        res.statusCode = 500
        res.end(String(error))
      })
    })
  }

  async start(): Promise<string> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server.address()
        if (address && typeof address === 'object') {
          this.port = address.port
          resolve(`http://127.0.0.1:${this.port}`)
        }
      })
    })
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve())
    })
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = req.url ?? '/'
    const url = new URL(path, 'http://fake-s3')
    this.paths.push(path)
    // A fresh connection per request, so each one goes through the store's address check.
    res.shouldKeepAlive = false
    if (this.failWith) return void res.writeHead(this.failWith, 'Unavailable').end()
    return this.route(req, res, url)
  }

  private async route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const key = url.pathname.split('/').slice(2).join('/')
    if (req.method === 'PUT') return this.write(key, req, res)
    if (req.method === 'DELETE') return this.remove(key, res)
    if (req.method !== 'GET') return void res.writeHead(405).end()
    if (url.searchParams.has('list-type')) return this.list(url.searchParams.get('prefix') ?? '', res)
    this.read(key, res)
  }

  private list(prefix: string, res: ServerResponse): void {
    const keys = Array.from(this.storage.keys()).filter((k) => k.startsWith(prefix))
    const xml = `<?xml version="1.0"?><ListBucketResult>${keys.map(listEntry).join('')}</ListBucketResult>`
    res.writeHead(200, { 'Content-Type': 'application/xml' }).end(xml)
  }

  private read(key: string, res: ServerResponse): void {
    const value = this.storage.get(key)
    if (value) res.writeHead(200).end(value)
    else res.writeHead(404).end()
  }

  private async write(key: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Uint8Array[] = []
    for await (const chunk of req) chunks.push(chunk as Uint8Array)
    this.storage.set(key, new Uint8Array(Buffer.concat(chunks)))
    res.writeHead(200).end()
  }

  private remove(key: string, res: ServerResponse): void {
    this.storage.delete(key)
    res.writeHead(204).end()
  }
}

/** The fake listens on loopback, which the store refuses by default (TOL-207). */
const LOOPBACK = { isAllowedAddress: (address: string) => address === '127.0.0.1' }

describe('LocalDiskStore', () => {
  let root: string
  let store: LocalDiskStore

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'memoria-store-test-'))
    store = new LocalDiskStore(root)
  })

  afterEach(() => rm(root, { recursive: true, force: true }))

  it('returns null for a key that was never written', async () => {
    expect(await store.get('docs/missing')).toBeNull()
  })

  it('stores, overwrites and deletes values', async () => {
    await store.put('docs/a.bin', text('one'))
    await store.put('docs/a.bin', text('two'))
    expect(Buffer.from((await store.get('docs/a.bin')) as Uint8Array).toString()).toBe('two')

    await store.delete('docs/a.bin')
    await store.delete('docs/a.bin')
    expect(await store.get('docs/a.bin')).toBeNull()
  })

  it('lists the keys under a prefix and leaves no temporary files behind', async () => {
    await store.put('docs/a', text('a'))
    await store.put('docs/b', text('b'))
    expect((await store.list('docs')).sort()).toEqual(['docs/a', 'docs/b'])
    expect(await store.list('nothing')).toEqual([])
    expect((await readdir(join(root, 'docs'))).sort()).toEqual(['a', 'b'])
  })

  it.each(['../escape', '/absolute', 'a/../b', 'a//b', '.hidden', 'a/.b', '', 'a b'])(
    'rejects the unsafe key %j',
    async (key) => {
      await expect(store.put(key, text('x'))).rejects.toThrowError(/invalid store key/)
      await expect(store.get(key)).rejects.toThrowError(/invalid store key/)
    },
  )

  it('reports failures other than a missing file', async () => {
    await store.put('docs/a', text('a'))
    await expect(store.get('docs')).rejects.toThrowError(/EISDIR/)
    await expect(store.list('docs/a')).rejects.toThrowError(/ENOTDIR/)
  })
})

describe('R2BlobStore', () => {
  let server: FakeS3Server
  let store: R2BlobStore
  let endpoint: string

  beforeEach(async () => {
    server = new FakeS3Server()
    endpoint = await server.start()
    store = new R2BlobStore({
      bucket: 'test-bucket',
      endpoint,
      region: 'auto',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
    }, LOOPBACK)
  })

  afterEach(async () => {
    await server.stop()
  })

  it('returns null for a key that was never written', async () => {
    expect(await store.get('docs/missing')).toBeNull()
  })

  it('stores, overwrites and deletes values', async () => {
    await store.put('docs/a.bin', text('one'))
    await store.put('docs/a.bin', text('two'))
    expect(Buffer.from((await store.get('docs/a.bin')) as Uint8Array).toString()).toBe('two')

    await store.delete('docs/a.bin')
    await store.delete('docs/a.bin')
    expect(await store.get('docs/a.bin')).toBeNull()
  })

  it('lists the keys under a prefix', async () => {
    await store.put('docs/a', text('a'))
    await store.put('docs/b', text('b'))
    expect((await store.list('docs')).sort()).toEqual(['docs/a', 'docs/b'])
    expect(await store.list('nothing')).toEqual([])
  })

  it('survives restart with fresh disk - data persists in R2', async () => {
    await store.put('docs/index.bin', text('persistent-doc-index'))
    await store.put('snapshots/note-1.bin', text('persistent-snapshot'))
    
    const store2 = new R2BlobStore({
      bucket: 'test-bucket',
      endpoint,
      region: 'auto',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
    }, LOOPBACK)
    
    const indexData = await store2.get('docs/index.bin')
    const snapshotData = await store2.get('snapshots/note-1.bin')
    
    expect(Buffer.from(indexData as Uint8Array).toString()).toBe('persistent-doc-index')
    expect(Buffer.from(snapshotData as Uint8Array).toString()).toBe('persistent-snapshot')
  })

  it('throws readable errors on failures', async () => {
    await server.stop()
    await expect(store.get('docs/a')).rejects.toThrow()
  })

  it('never leaks credentials in error messages', async () => {
    await server.stop()
    try {
      await store.get('docs/test')
      throw new Error('should have thrown')
    } catch (error) {
      const message = String(error)
      expect(message).not.toContain('test-key')
      expect(message).not.toContain('test-secret')
    }
  })
})

describe('R2BlobStore request signing', () => {
  // SigV4 vectors independently recomputed with Python hashlib/hmac after the
  // fixture bucket rename. Same credentials, date and signed headers
  // (host, x-amz-content-sha256, x-amz-date); the bucket is part of the signed URI.
  const signer = new R2BlobStore(
    {
      bucket: 'memoria-proto',
      endpoint: 'https://acct.r2.cloudflarestorage.com',
      region: 'auto',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    },
    { now: () => new Date('2026-10-23T12:34:56.789Z') },
  )
  const base = 'https://acct.r2.cloudflarestorage.com/memoria-proto'

  it.each([
    ['GET', `${base}/vaults/prototype/vault-index.json`, undefined, '542bac0c3c16cd7a6746ea583d5ce85d3668e537c5f449a5674d079565bd8a9a'],
    ['PUT', `${base}/vaults/prototype/vault-index.json`, '{"version":1}', 'aa15e15810f1543d3808a3216ec74679de79cdaaebc1f4287fbfe29d4237fc73'],
    ['GET', `${base}/?list-type=2&prefix=vaults%2Fprototype%2F`, undefined, '48d8ec590596f6de31f543ce33cafd30602170131c729bd06aa5dbd1e4e73645'],
    ['DELETE', `${base}/a%20b/it%27s.json`, undefined, 'b91bca78618f0e4c862b163974dc79b9ddff68e2141a5db6abdec6ced2e15431'],
  ])('signs %s %s as SigV4 does', (method, url, body, signature) => {
    const headers = signer.signRequest(method as StoreMethod, new URL(url), body === undefined ? undefined : text(body))
    expect(headers['X-Amz-Date']).toBe('20261023T123456Z')
    expect(headers.Authorization).toBe(
      `AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261023/auto/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
    )
  })

  it('sends keys as path segments and the list prefix percent-encoded, as they are signed', async () => {
    const server = new FakeS3Server()
    const endpoint = await server.start()
    const store = new R2BlobStore({ bucket: 'b', endpoint, region: 'auto', accessKeyId: 'k', secretAccessKey: 's' }, LOOPBACK)
    await store.put('vaults/v-1/index_2.json', text('x'))
    await store.list('vaults/v-1')
    await server.stop()
    expect(server.paths).toEqual(['/b/vaults/v-1/index_2.json', '/b/?list-type=2&prefix=vaults%2Fv-1%2F'])
  })

  it.each(['../other-bucket/x', 'a/../../b', '/absolute', 'a//b', '.hidden', '', 'a b', "it's"])(
    'refuses the unsafe key %j before sending anything',
    async (key) => {
      const server = new FakeS3Server()
      const endpoint = await server.start()
      const store = new R2BlobStore({ bucket: 'b', endpoint, region: 'auto', accessKeyId: 'k', secretAccessKey: 's' }, LOOPBACK)
      await expect(store.put(key, text('x'))).rejects.toThrowError(/invalid store key/)
      await expect(store.get(key)).rejects.toThrowError(/invalid store key/)
      await expect(store.delete(key)).rejects.toThrowError(/invalid store key/)
      await expect(store.list(key)).rejects.toThrowError(/invalid store key/)
      await server.stop()
      expect(server.paths).toEqual([])
    },
  )
})

describe('R2BlobStore address policy (TOL-207)', () => {
  let server: FakeS3Server
  let port: string

  beforeEach(async () => {
    server = new FakeS3Server()
    port = new URL(await server.start()).port
  })

  afterEach(() => server.stop())

  const config = (endpoint: string) => ({ bucket: 'b', endpoint, region: 'auto', accessKeyId: 'k', secretAccessKey: 's' })
  const answering = (...answers: string[]) => {
    let calls = 0
    return async () => [{ address: answers[Math.min(calls++, answers.length - 1)], family: 4 }]
  }

  it('refuses a loopback endpoint by default, before sending anything', async () => {
    const store = new R2BlobStore(config(`http://127.0.0.1:${port}`))
    await expect(store.put('docs/a', text('x'))).rejects.toThrowError(/R2 endpoint refused/)
    expect(server.paths).toEqual([])
  })

  it('refuses a host name that resolves to a private address by default', async () => {
    const store = new R2BlobStore(config(`http://minio.internal:${port}`), { resolveHost: answering('10.0.0.7') })
    await expect(store.get('docs/a')).rejects.toThrowError(/R2 endpoint refused/)
  })

  it('checks every connection, so a host rebound to a private address is refused', async () => {
    const store = new R2BlobStore(config(`http://s3.test:${port}`), { ...LOOPBACK, resolveHost: answering('127.0.0.1', '10.0.0.7') })
    await store.put('docs/a', text('x'))
    await expect(store.get('docs/a')).rejects.toThrowError(/R2 endpoint refused/)
    expect(server.paths).toEqual(['/b/docs/a'])
  })

  it('reports the status of a failed request', async () => {
    server.failWith = 503
    const store = new R2BlobStore(config(`http://127.0.0.1:${port}`), LOOPBACK)
    await expect(store.get('docs/a')).rejects.toThrowError('R2 GET failed: 503 Unavailable')
    await expect(store.put('docs/a', text('x'))).rejects.toThrowError('R2 PUT failed: 503 Unavailable')
    await expect(store.delete('docs/a')).rejects.toThrowError('R2 DELETE failed: 503 Unavailable')
    await expect(store.list('docs')).rejects.toThrowError('R2 LIST failed: 503 Unavailable')
  })
})
