import { afterEach, describe, expect, it, vi } from 'vitest'

const remoteGlobals = globalThis as { MEMORIA_REMOTE_URL?: string; MEMORIA_REMOTE_TOKEN?: string }

async function loadMockEntries() {
  vi.resetModules()
  return (await import('./mock-entries')).MOCK_ENTRIES
}

describe('mock entries', () => {
  afterEach(() => {
    delete remoteGlobals.MEMORIA_REMOTE_URL
    delete remoteGlobals.MEMORIA_REMOTE_TOKEN
  })

  it('include a large generated vault for demo data', async () => {
    expect((await loadMockEntries()).length).toBeGreaterThan(9000)
  })

  it('skip the generated vault on a Memoria remote, which never lists demo data (TOL-206)', async () => {
    remoteGlobals.MEMORIA_REMOTE_URL = 'https://memoria.example'
    remoteGlobals.MEMORIA_REMOTE_TOKEN = 'token-not-a-secret'

    expect((await loadMockEntries()).length).toBeLessThan(100)
  })
})
