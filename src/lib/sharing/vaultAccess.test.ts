import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertSharedVaultWritable,
  canChangeVault,
  canWritePath,
  checkVaultAccess,
  getVaultAccess,
  isViewOnly,
  reportAccessDenied,
  resetVaultAccessForTests,
  roleOn,
  sharedRoleOf,
  subscribeVaultAccess,
  ViewOnlyAccessError,
  type VaultAccessState,
} from './vaultAccess'
import { applySharedVaultBase, remoteVaultConfig } from '../vaultBackend/remoteConfig'

type RemoteWindow = { MEMORIA_REMOTE_URL?: string; MEMORIA_REMOTE_TOKEN?: string }

const NOTE = 'projects/alpha.md'
const viewerOfNote: VaultAccessState = { kind: 'shared', access: { subject: 'u_1', grants: [{ scope: NOTE, role: 'viewer' }] } }
const editorOfNote: VaultAccessState = { kind: 'shared', access: { subject: 'u_1', grants: [{ scope: NOTE, role: 'editor' }] } }
const vaultViewerNoteEditor: VaultAccessState = {
  kind: 'shared',
  access: { subject: 'u_1', grants: [{ scope: '*', role: 'viewer' }, { scope: NOTE, role: 'editor' }] },
}
const vaultEditor: VaultAccessState = { kind: 'shared', access: { subject: 'u_1', grants: [{ scope: '*', role: 'editor' }] } }

function openPage(path: string): void {
  window.history.replaceState(null, '', path)
  Object.assign(window as RemoteWindow, { MEMORIA_REMOTE_URL: 'https://front.test', MEMORIA_REMOTE_TOKEN: 'via-front' })
  applySharedVaultBase()
}

beforeEach(() => resetVaultAccessForTests())

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
  delete (window as RemoteWindow).MEMORIA_REMOTE_URL
  delete (window as RemoteWindow).MEMORIA_REMOTE_TOKEN
  resetVaultAccessForTests()
})

describe('what a share lets the user do', () => {
  it('takes the strongest role covering a path', () => {
    expect(roleOn(vaultViewerNoteEditor.kind === 'shared' ? vaultViewerNoteEditor.access.grants : [], NOTE)).toBe('editor')
    expect(roleOn([{ scope: NOTE, role: 'viewer' }], 'other.md')).toBeNull()
  })

  it('lets the owner do everything', () => {
    const owner: VaultAccessState = { kind: 'owner' }
    expect(canWritePath(owner, NOTE)).toBe(true)
    expect(canChangeVault(owner)).toBe(true)
    expect(isViewOnly(owner)).toBe(false)
    expect(sharedRoleOf(owner)).toBeNull()
  })

  it('lets a note editor change that note only, and not the vault', () => {
    expect(canWritePath(editorOfNote, NOTE)).toBe(true)
    expect(canWritePath(editorOfNote, 'other.md')).toBe(false)
    expect(canChangeVault(editorOfNote)).toBe(false)
    expect(sharedRoleOf(editorOfNote)).toBe('editor')
    expect(canWritePath(vaultViewerNoteEditor, NOTE)).toBe(true)
    expect(canChangeVault(vaultEditor)).toBe(true)
  })

  it('makes a viewer, a share being checked and a revoked one read only', () => {
    expect(canWritePath(viewerOfNote, NOTE)).toBe(false)
    expect(isViewOnly(viewerOfNote)).toBe(true)
    expect(sharedRoleOf(viewerOfNote)).toBe('viewer')
    expect(isViewOnly({ kind: 'checking' })).toBe(true)
    expect(canWritePath({ kind: 'revoked' }, NOTE)).toBe(false)
  })
})

describe('the remote of a shared vault page', () => {
  it('is the same server under the vault prefix, applied once', () => {
    openPage('/vaults/v_1/')
    applySharedVaultBase()
    expect(remoteVaultConfig()).toEqual({ baseUrl: 'https://front.test/vaults/v_1', token: 'via-front' })
  })

  it('stays the server itself on the own vault and without a remote', () => {
    window.history.replaceState(null, '', '/vaults/v_1/')
    applySharedVaultBase()
    expect(remoteVaultConfig()).toBeNull()
    openPage('/')
    expect(remoteVaultConfig()).toEqual({ baseUrl: 'https://front.test', token: 'via-front' })
  })
})

describe("the page's access", () => {
  it('is the owner on the own vault, with no request', async () => {
    openPage('/')
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    await checkVaultAccess()

    expect(getVaultAccess()).toEqual({ kind: 'owner' })
    expect(fetch).not.toHaveBeenCalled()
    expect(remoteVaultConfig()?.baseUrl).toBe('https://front.test')
  })

  it('is read only on a shared vault until the server says what is granted', async () => {
    openPage('/vaults/v_1/?note=projects%2Falpha.md')
    const access = { subject: 'u_1', grants: [{ scope: NOTE, role: 'editor' }] }
    const fetch = vi.fn(async () => Response.json({ protocolVersion: '1.10', access }))
    vi.stubGlobal('fetch', fetch)
    const changed = vi.fn()
    subscribeVaultAccess(changed)

    expect(getVaultAccess()).toEqual({ kind: 'checking' })
    expect(() => assertSharedVaultWritable('creating a note')).toThrow(ViewOnlyAccessError)
    await checkVaultAccess()

    expect(fetch).toHaveBeenCalledWith('https://front.test/vaults/v_1/v1/vault', expect.objectContaining({ headers: { authorization: 'Bearer via-front' } }))
    expect(getVaultAccess()).toEqual({ kind: 'shared', access })
    expect(changed).toHaveBeenCalled()
    expect(() => assertSharedVaultWritable('creating a note')).not.toThrow()
  })

  it('treats a token answer on a shared path as the owner', async () => {
    openPage('/vaults/v_1/')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ access: { subject: null, grants: [{ scope: '*', role: 'owner' }] } })))

    await checkVaultAccess()

    expect(getVaultAccess()).toEqual({ kind: 'owner' })
  })

  it.each([
    ['no access field', { protocolVersion: '1.8' }],
    ['a body that is not JSON', 'not json'],
    ['grants that are not a list', { access: { subject: 'u_1', grants: 'all' } }],
    ['an unknown role', { access: { subject: 'u_1', grants: [{ scope: '*', role: 'admin' }] } }],
    ['no subject without owner rights', { access: { subject: null, grants: [{ scope: '*', role: 'editor' }] } }],
  ])('stays read only when the answer has %s', async (_case, body) => {
    openPage('/vaults/v_1/')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body))))

    await checkVaultAccess()

    expect(getVaultAccess()).toEqual({ kind: 'checking' })
    expect(isViewOnly(getVaultAccess())).toBe(true)
  })

  it.each([401, 403, 404])('is revoked when the vault answers %i, and stops asking', async (status) => {
    openPage('/vaults/v_1/')
    const fetch = vi.fn(async () => new Response('{}', { status }))
    vi.stubGlobal('fetch', fetch)

    reportAccessDenied()
    await vi.waitFor(() => expect(getVaultAccess()).toEqual({ kind: 'revoked' }))
    await checkVaultAccess()

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('tries again later while a failing server leaves the access unknown', async () => {
    vi.useFakeTimers()
    openPage('/vaults/v_1/')
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(Response.json({ access: { subject: 'u_1', grants: [{ scope: '*', role: 'viewer' }] } }))
    vi.stubGlobal('fetch', fetch)

    await checkVaultAccess()
    expect(getVaultAccess()).toEqual({ kind: 'checking' })
    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(fetch).toHaveBeenCalledTimes(3)
    expect(sharedRoleOf(getVaultAccess())).toBe('viewer')
  })

  it('asks once while a check is running', async () => {
    openPage('/vaults/v_1/')
    const fetch = vi.fn(async () => Response.json({ access: { subject: 'u_1', grants: [{ scope: '*', role: 'viewer' }] } }))
    vi.stubGlobal('fetch', fetch)

    await Promise.all([checkVaultAccess(), checkVaultAccess()])

    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
