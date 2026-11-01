import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SocketLike } from '../../../packages/collab-client/src/collabProvider'
import { readCache, writeCache } from '../../../packages/collab-client/src/entriesCache'
import type { VaultEntry as ProtocolEntry } from '../../../packages/protocol/src/index'

/**
 * TOL-202: the remote backend's note lifecycle as the web shell runs it (jsdom, a stubbed
 * server): cached listing and its revalidation, creates and their conflict copies, renames
 * that move open documents, and the collaboration ticket it trusts.
 */

vi.mock('../../../packages/collab-client/src/entriesCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../packages/collab-client/src/entriesCache')>()),
  readCache: vi.fn(),
  writeCache: vi.fn(async () => {}),
}))

type Handler = (method: string, path: string, init: RequestInit) => Response | Promise<Response>

let handle: Handler
let sockets: string[]

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

function protocolEntry(path: string, extra: Partial<ProtocolEntry> = {}): ProtocolEntry {
  return { path, filename: path, title: path, fileSize: 1, snippet: '', wordCount: 0, hasH1: true, fileKind: 'markdown', ...extra }
}

function fakeSocket(): SocketLike {
  return { binaryType: '', readyState: 0, onopen: null, onmessage: null, onclose: null, onerror: null, send: () => {}, close: () => {} }
}

async function openNote(collab: Awaited<ReturnType<typeof backend>>['collab'], path: string) {
  if (!collab) throw new Error('the remote backend has a collaboration channel')
  return collab.openDoc(path)
}

async function backend() {
  const { createRemoteVaultBackend } = await import('../../../packages/collab-client/src/remoteVaultBackend')
  return createRemoteVaultBackend({
    baseUrl: 'https://vault.example',
    token: 'token-for-tests',
    fetch: (async (url: string, init: RequestInit = {}) =>
      handle(init.method ?? 'GET', new URL(url).pathname + new URL(url).search, init)) as typeof fetch,
    createSocket: (url) => {
      sockets.push(url)
      return fakeSocket()
    },
  })
}

beforeEach(() => {
  vi.resetModules()
  sockets = []
  handle = () => json({}, 404)
  vi.mocked(readCache).mockReset()
  vi.mocked(writeCache).mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the cached note list', () => {
  it('opens from the cache and folds in what changed since, in chunks', async () => {
    vi.stubGlobal('indexedDB', {})
    vi.mocked(readCache).mockResolvedValue({
      head: 'h1',
      entries: [protocolEntry('gone.md'), protocolEntry('kept.md', { isA: 'Project', aliases: ['k'], relationships: { owner: ['ada'] } })],
    } as Awaited<ReturnType<typeof readCache>>)
    const changed = Array.from({ length: 60 }, (_, index) => protocolEntry(`new-${index}.md`))
    handle = (_method, path) => (path.startsWith('/v1/entries?since=h1') ? json({ head: 'h2', changed, deleted: ['gone.md'] }) : json({}, 404))

    const listed = await (await backend()).files.list()

    expect(listed.map((entry) => entry.path)).toEqual(['gone.md', 'kept.md'])
    expect(listed[1]).toMatchObject({ isA: 'Project', aliases: ['k'], belongsTo: [], status: null, fileKind: 'markdown' })
    await vi.waitFor(() => expect(writeCache).toHaveBeenCalled())
    const [head, cached] = vi.mocked(writeCache).mock.calls[0]
    expect(head).toBe('h2')
    expect(cached.map((entry) => entry.path)).toEqual(['kept.md', ...changed.map((entry) => entry.path)])
    expect(cached[0]).toMatchObject({ isA: 'Project', aliases: ['k'], relationships: { owner: ['ada'] } })
    expect(cached[1]).not.toHaveProperty('aliases', [])
    expect(cached[1].isA).toBeUndefined()
  })
})

describe('the cached note list at startup (TOL-206)', () => {
  function cacheWith(head: string, paths: string[]) {
    vi.stubGlobal('indexedDB', {})
    vi.mocked(readCache).mockResolvedValue({ head, entries: paths.map((path) => protocolEntry(path)) } as Awaited<ReturnType<typeof readCache>>)
  }

  it('reads the cache once for listings that start together, and they get the same entries', async () => {
    cacheWith('h1', ['a.md', 'b.md'])
    handle = () => json({ head: 'h1', changed: [], deleted: [] })
    const { files } = await backend()

    const [first, second] = await Promise.all([files.list(), files.list()])

    expect(readCache).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
    expect(first.map((entry) => entry.path)).toEqual(['a.md', 'b.md'])
  })

  it('uses the read started at boot instead of reading again', async () => {
    cacheWith('h1', ['early.md'])
    handle = () => json({ head: 'h1', changed: [], deleted: [] })
    const { prefetchCache } = await import('../../../packages/collab-client/src/entriesCachePrefetch')
    prefetchCache()
    prefetchCache()

    const listed = await (await backend()).files.list()

    expect(readCache).toHaveBeenCalledTimes(1)
    expect(listed.map((entry) => entry.path)).toEqual(['early.md'])
  })

  it('leaves the snapshot alone when nothing changed since its head', async () => {
    cacheWith('h1', ['a.md'])
    const requests: string[] = []
    handle = (_method, path) => {
      requests.push(path)
      return json({ head: 'h1', changed: [], deleted: [] })
    }

    await (await backend()).files.list()

    await vi.waitFor(() => expect(requests).toEqual(['/v1/entries?since=h1']))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(writeCache).not.toHaveBeenCalled()
  })
})

describe('creating notes', () => {
  it('reports the conflict copy, and copes with a conflict without a body', async () => {
    let body: unknown = { outcome: 'conflict', path: 'plan (conflict 2026-10-23 2130).md' }
    handle = (method) => {
      if (method === 'PUT') return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 409 })
      return new Response('# Desktop plan\n', { headers: { etag: '"e2"' } })
    }
    const { files } = await backend()

    expect(await files.write('plan.md', '# Web\n', { baseRevision: null })).toMatchObject({
      status: 'conflict',
      copyPath: 'plan (conflict 2026-10-23 2130).md',
      current: { content: '# Desktop plan\n', revision: 'e2' },
    })
    body = 'not json'
    expect(await files.write('plan.md', '# Web\n', { baseRevision: null })).toMatchObject({ status: 'conflict', copyPath: undefined })
  })

  it('refuses a path that is not a vault path before any request', async () => {
    const requests: string[] = []
    handle = (method, path) => {
      requests.push(`${method} ${path}`)
      return json({})
    }
    const { files, collab } = await backend()

    await expect(files.write('../outside.md', '#\n', { baseRevision: null })).rejects.toMatchObject({ status: 400 })
    await expect(collab?.openDoc('a//b.md')).rejects.toMatchObject({ status: 400 })
    expect(await files.delete(['/abs.md'])).toEqual([])
    expect(requests).toEqual([])
  })

  it('raises the status of a refused request', async () => {
    const { files } = await backend()

    await expect(files.read('missing.md')).rejects.toMatchObject({ name: 'RemoteError', status: 404, message: expect.stringContaining('404') })
  })
})

describe('live documents', () => {
  function serveNote(ticketPath = '/v1/collab/docs/doc-1') {
    handle = (method, path) => {
      if (method === 'PUT') return json({ outcome: 'created', path: 'untitled-note-1.md' }, 201, { etag: '"e1"' })
      if (method === 'GET') return new Response('# Idea\n', { headers: { etag: '"e1"', 'memoria-doc-id': 'doc-1' } })
      if (path === '/v1/rename') return json({ from: 'untitled-note-1.md', path: 'idea.md' })
      if (path === '/v1/collab/tickets') return json({ path: ticketPath, ticket: 't-1' })
      return json({}, 404)
    }
  }

  it('opens a new note once it exists, connects with a ticket, and follows a rename', async () => {
    serveNote()
    const { files, collab } = await backend()

    const creating = files.write('untitled-note-1.md', '# Idea\n', { baseRevision: null })
    const doc = await openNote(collab, 'untitled-note-1.md')
    await creating
    await vi.waitFor(() => expect(sockets).toEqual(['wss://vault.example/v1/collab/docs/doc-1?ticket=t-1']))

    expect(await files.rename({ path: 'untitled-note-1.md', newTitle: 'Idea' })).toMatchObject({ newPath: 'idea.md' })
    expect(doc.path).toBe('idea.md')
    doc.close()
  })

  it.each(['https://elsewhere.example/v1/collab/docs/doc-1', '//elsewhere.example/doc-1'])(
    'never connects to a ticket path off the server: %s',
    async (ticketPath) => {
      serveNote(ticketPath)
      const { collab } = await backend()

      const doc = await openNote(collab, 'untitled-note-1.md')
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(sockets).toEqual([])
      doc.close()
    },
  )
})
