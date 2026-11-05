import { afterEach, describe, expect, it, vi } from 'vitest'

const tauriInvoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauriInvoke }))

import { MOCK_ENTRIES } from '../../mock-tauri/mock-entries'
import {
  contentRevision,
  createMockVaultBackend,
  createRemoteAttachmentClient,
  createTauriVaultBackend,
  createVaultBackend,
} from './index'

const VAULT = '/Users/mock/demo-vault-v2'

function setTauriRuntime(value: boolean | undefined) {
  ;(globalThis as { isTauri?: boolean }).isTauri = value
}

afterEach(() => {
  setTauriRuntime(undefined)
  tauriInvoke.mockReset()
})

describe('vault backend factories', () => {
  it('routes the desktop backend through Tauri invoke', async () => {
    tauriInvoke.mockResolvedValue('# From disk')

    const file = await createTauriVaultBackend(VAULT).files.read(`${VAULT}/note.md`)

    expect(file.content).toBe('# From disk')
    expect(tauriInvoke).toHaveBeenCalledWith('get_note_content', { path: `${VAULT}/note.md`, vaultPath: VAULT })
  })

  it('selects the backend that matches the runtime', () => {
    setTauriRuntime(true)
    expect(createVaultBackend(VAULT).kind).toBe('tauri')

    setTauriRuntime(false)
    expect(createVaultBackend(VAULT).kind).toBe('mock')
  })

  it('serves the mock vault through the same interface', async () => {
    const backend = createMockVaultBackend(VAULT)
    const path = `${VAULT}/vault-backend-spec.md`

    expect(await backend.files.list()).toBe(MOCK_ENTRIES)

    const created = await backend.files.write(path, '# Spec', { baseRevision: null })
    expect(created).toEqual({ status: 'written', revision: contentRevision('# Spec') })
    expect(await backend.files.read(path)).toEqual({ path, content: '# Spec', revision: contentRevision('# Spec') })

    const stale = await backend.files.write(path, '# Mine', { baseRevision: contentRevision('# Older') })
    expect(stale).toMatchObject({ status: 'conflict', current: { content: '# Spec' } })

    const fresh = await backend.files.write(path, '# Mine', { baseRevision: contentRevision('# Spec') })
    expect(fresh.status).toBe('written')
    expect((await backend.files.read(path)).content).toBe('# Mine')

    expect(await backend.files.delete([path])).toEqual([path])
  })
})

describe('the remote attachment client (TOL-204)', () => {
  const target = window as { MEMORIA_REMOTE_URL?: string; MEMORIA_REMOTE_TOKEN?: string }

  afterEach(() => {
    delete target.MEMORIA_REMOTE_URL
    delete target.MEMORIA_REMOTE_TOKEN
  })

  it('exists only when a remote serves the vault', () => {
    expect(createRemoteAttachmentClient()).toBeNull()

    target.MEMORIA_REMOTE_URL = 'https://vault.example'
    target.MEMORIA_REMOTE_TOKEN = 'token-for-tests'
    expect(createRemoteAttachmentClient()).toMatchObject({ save: expect.any(Function), read: expect.any(Function) })

    setTauriRuntime(true)
    expect(createRemoteAttachmentClient()).toBeNull()
  })
})
