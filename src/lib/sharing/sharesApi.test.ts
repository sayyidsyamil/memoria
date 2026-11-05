import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  changeShareRole,
  createShare,
  listIncomingShares,
  listOutgoingShares,
  parseInvitee,
  personLabel,
  revokeShare,
  ShareApiError,
  type OutgoingShare,
} from './sharesApi'

const SHARE: OutgoingShare = {
  id: 's_1',
  scope: 'notes/a.md',
  role: 'editor',
  grantee: { userId: 'u_ana', email: 'ana@example.com', github: 'ana' },
}

function answer(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }))
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(() => null, (failure: unknown) => failure)
  expect(error).toBeInstanceOf(ShareApiError)
  return (error as ShareApiError).code
}

afterEach(() => vi.unstubAllGlobals())

describe('who to invite', () => {
  it('reads an email address or a GitHub login', () => {
    expect(parseInvitee(' ana@example.com ')).toEqual({ email: 'ana@example.com' })
    expect(parseInvitee('@ana-e2e')).toEqual({ github: 'ana-e2e' })
    expect(parseInvitee('ana')).toEqual({ github: 'ana' })
    expect(parseInvitee('not a login')).toBeNull()
    expect(parseInvitee('')).toBeNull()
  })

  it('names a person by GitHub login, else by email', () => {
    expect(personLabel(SHARE.grantee)).toBe('@ana')
    expect(personLabel({ userId: 'u_2', email: 'bo@example.com', github: null })).toBe('bo@example.com')
    expect(personLabel({ userId: 'u_3', email: null, github: null })).toBe('u_3')
    expect(personLabel(null)).toBe('')
  })
})

describe('the share API', () => {
  it('lists the own vault and what is shared with the user', async () => {
    vi.stubGlobal('fetch', answer(200, { vaultId: 'v_1', shares: [SHARE] }))
    await expect(listOutgoingShares()).resolves.toEqual({ vaultId: 'v_1', shares: [SHARE] })

    vi.stubGlobal('fetch', answer(200, { shares: [] }))
    await expect(listOutgoingShares()).resolves.toEqual({ vaultId: null, shares: [] })
    await expect(listIncomingShares()).resolves.toEqual([])
  })

  it('shares a note, changes a role by user id, and revokes', async () => {
    const fetch = answer(201, { share: SHARE })
    vi.stubGlobal('fetch', fetch)

    await createShare({ vaultId: 'v_1', invitee: { email: 'ana@example.com' }, role: 'editor', path: 'notes/a.md' })
    await changeShareRole('v_1', SHARE, 'viewer')
    await changeShareRole('v_1', { ...SHARE, scope: '*' }, 'viewer')
    await revokeShare('s_1')

    const bodies = fetch.mock.calls.map(([, init]) => (init as RequestInit).body)
    expect(JSON.parse(String(bodies[0]))).toEqual({ email: 'ana@example.com', role: 'editor', vaultId: 'v_1', path: 'notes/a.md' })
    expect(JSON.parse(String(bodies[1]))).toEqual({ userId: 'u_ana', role: 'viewer', vaultId: 'v_1', path: 'notes/a.md' })
    expect(JSON.parse(String(bodies[2]))).toEqual({ userId: 'u_ana', role: 'viewer', vaultId: 'v_1' })
    expect(fetch.mock.calls[3]).toEqual(['/api/shares/s_1', expect.objectContaining({ method: 'DELETE', credentials: 'same-origin' })])
  })

  it.each([
    [404, { error: { code: 'user_not_found' } }, 'user_not_found'],
    [409, { error: { code: 'share_limit' } }, 'share_limit'],
    [429, { error: { code: 'rate_limited' } }, 'rate_limited'],
    [400, { error: { code: 'invalid_request' } }, 'invalid_request'],
    [401, { error: { code: 'unauthorized' } }, 'unavailable'],
    [404, { error: 'No API in the static web build' }, 'unavailable'],
    [500, { error: { code: 'internal_error' } }, 'failed'],
  ])('tells why a %i failed', async (status, body, code) => {
    vi.stubGlobal('fetch', answer(status, body))
    expect(await codeOf(createShare({ vaultId: 'v_1', invitee: { github: 'x' }, role: 'viewer', path: null }))).toBe(code)
  })

  it('treats no network as a failure and a page that is not the API as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    expect(await codeOf(listIncomingShares())).toBe('failed')

    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html></html>', { status: 200 })))
    expect(await codeOf(listOutgoingShares())).toBe('unavailable')

    vi.stubGlobal('fetch', answer(200, { something: 'else' }))
    expect(await codeOf(listIncomingShares())).toBe('unavailable')
  })
})
