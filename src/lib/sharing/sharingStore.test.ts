import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutgoingShare } from './sharesApi'
import {
  forgetOutgoingShare,
  getSharing,
  refreshSharing,
  rememberOutgoingShare,
  resetSharingForTests,
  scheduleSharingLoad,
  subscribeSharing,
} from './sharingStore'

type RemoteWindow = { MEMORIA_REMOTE_URL?: string; MEMORIA_REMOTE_TOKEN?: string }

const SHARE: OutgoingShare = { id: 's_1', scope: '*', role: 'viewer', grantee: { userId: 'u_2', email: null, github: 'bo' } }
const INCOMING = { id: 's_9', vaultId: 'v_9', scope: 'a.md', role: 'editor', owner: null }

function routes(outgoing: Response, incoming: Response) {
  return vi.fn(async (input: RequestInfo | URL) => (String(input).endsWith('/incoming') ? incoming : outgoing).clone())
}

beforeEach(() => {
  resetSharingForTests()
  Object.assign(window as RemoteWindow, { MEMORIA_REMOTE_URL: 'https://front.test', MEMORIA_REMOTE_TOKEN: 'via-front' })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete (window as RemoteWindow).MEMORIA_REMOTE_URL
  delete (window as RemoteWindow).MEMORIA_REMOTE_TOKEN
  resetSharingForTests()
})

describe('the share records of the page', () => {
  it('knows the own vault, its shares and what is shared with the user', async () => {
    vi.stubGlobal('fetch', routes(Response.json({ vaultId: 'v_1', shares: [SHARE] }), Response.json({ shares: [INCOMING] })))
    const changed = vi.fn()
    subscribeSharing(changed)

    await refreshSharing()

    expect(getSharing()).toEqual({ status: 'available', vaultId: 'v_1', outgoing: [SHARE], incoming: [INCOMING] })
    expect(changed).toHaveBeenCalled()
  })

  it('offers no sharing without the hosted API', async () => {
    vi.stubGlobal('fetch', routes(new Response('{}', { status: 401 }), new Response('{}', { status: 401 })))

    await refreshSharing()

    expect(getSharing().status).toBe('unavailable')
  })

  it('keeps what it knew when a read fails', async () => {
    vi.stubGlobal('fetch', routes(Response.json({ vaultId: 'v_1', shares: [SHARE] }), Response.json({ shares: [] })))
    await refreshSharing()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))

    await refreshSharing()

    expect(getSharing().outgoing).toEqual([SHARE])
  })

  it('does nothing without a remote vault', async () => {
    delete (window as RemoteWindow).MEMORIA_REMOTE_URL
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    scheduleSharingLoad()
    await refreshSharing()

    expect(fetch).not.toHaveBeenCalled()
    expect(getSharing().status).toBe('unknown')
  })

  it('reads once, a moment after startup', async () => {
    vi.useFakeTimers()
    const fetch = routes(Response.json({ vaultId: 'v_1', shares: [] }), Response.json({ shares: [] }))
    vi.stubGlobal('fetch', fetch)

    scheduleSharingLoad()
    scheduleSharingLoad()
    expect(fetch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_500)

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(getSharing().status).toBe('available')
  })

  it('shows a share created, changed or revoked in this page at once', () => {
    rememberOutgoingShare(SHARE)
    rememberOutgoingShare({ ...SHARE, role: 'editor' })
    expect(getSharing().outgoing).toEqual([{ ...SHARE, role: 'editor' }])

    forgetOutgoingShare(SHARE.id)
    expect(getSharing().outgoing).toEqual([])
  })

  it.each(['invite', 'revoke'] as const)('does not let a stale refresh undo a successful %s', async mutation => {
    resetSharingForTests({ status: 'available', vaultId: 'v_1', outgoing: mutation === 'revoke' ? [SHARE] : [], incoming: [] })
    let respond!: (response: Response) => void
    const snapshot = new Promise<Response>(resolve => { respond = resolve })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/incoming')
      ? Response.json({ shares: [] }) : snapshot))

    const refresh = refreshSharing()
    if (mutation === 'invite') rememberOutgoingShare(SHARE)
    else forgetOutgoingShare(SHARE.id)
    // This read reflects the state before the mutation, even though it arrives later.
    respond(Response.json({ vaultId: 'v_1', shares: mutation === 'revoke' ? [SHARE] : [] }))
    await refresh

    expect(getSharing()).toEqual({ status: 'available', vaultId: 'v_1', outgoing: mutation === 'invite' ? [SHARE] : [], incoming: [] })
  })
})
