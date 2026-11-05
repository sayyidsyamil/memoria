import { describe, expect, it, vi } from 'vitest'
import { DOC_ID_HEADER } from '../../protocol/src/index.ts'
import type { SocketLike } from '../src/collabProvider.ts'
import { createRemoteVaultBackend } from '../src/remoteVaultBackend.ts'

/**
 * TOL-237: a vault shared with the user is served under `/vaults/<id>` of the hosted front end.
 * Its ticket paths already carry that prefix, so the socket goes to the origin plus the path;
 * a refused ticket closes the document.
 */

const BASE = 'https://front.invalid/vaults/v_1'
const NOTE = 'notes/shared.md'

function socket(): SocketLike {
  return { binaryType: '', readyState: 0, onopen: null, onmessage: null, onclose: null, onerror: null, send: () => {}, close: () => {} }
}

function frontEnd(ticketStatus: number) {
  const calls: string[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (url.endsWith(`/v1/files/${NOTE}`)) return new Response('# Shared\n', { headers: { [DOC_ID_HEADER]: 'doc-1' } })
    if (ticketStatus !== 200) return new Response('{"error":{"code":"not_found"}}', { status: ticketStatus })
    return Response.json({ path: '/vaults/v_1/v1/collab/docs/doc-1', ticket: 't-1', access: 'read', expiresAt: 0 })
  })
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch }
}

describe('a remote vault under a path prefix', () => {
  it('asks the prefix for tickets and opens the socket on the ticket path, joined to read', async () => {
    const front = frontEnd(200)
    const urls: string[] = []
    const backend = createRemoteVaultBackend({
      baseUrl: BASE,
      token: 'via-front',
      fetch: front.fetch,
      createSocket: (url) => {
        urls.push(url)
        return socket()
      },
    })

    const doc = await backend.collab?.openDoc(NOTE, { readOnly: true })
    await vi.waitFor(() => expect(urls).toHaveLength(1))

    expect(front.calls).toContain(`POST ${BASE}/v1/collab/tickets`)
    expect(urls[0]).toBe('wss://front.invalid/vaults/v_1/v1/collab/docs/doc-1?ticket=t-1')
    doc?.close()
  })

  it('closes a document whose ticket is refused, without retrying', async () => {
    const front = frontEnd(404)
    const createSocket = vi.fn(socket)
    const backend = createRemoteVaultBackend({ baseUrl: BASE, token: 'via-front', fetch: front.fetch, createSocket })

    const doc = await backend.collab?.openDoc(NOTE)
    await vi.waitFor(() => expect(doc?.provider.status).toBe('closed'))
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(front.calls.filter((call) => call.startsWith('POST'))).toHaveLength(1)
    expect(createSocket).not.toHaveBeenCalled()
    doc?.close()
  })
})
