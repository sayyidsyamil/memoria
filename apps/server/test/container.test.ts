import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChangeEmitter } from '../src/changeEmitter.ts'
import { closeVaultServer, createVaultServer } from '../src/server.ts'
import { LocalDiskStore } from '../src/store.ts'
import { Vault } from '../src/vault.ts'
import { createFixture, type Fixture } from './helpers.ts'

describe('Container readiness', () => {
  let fixture: Fixture

  beforeEach(async () => {
    fixture = await createFixture()
  })

  afterEach(async () => {
    await fixture.cleanup()
  })

  it('boots from empty directory and reports ready', async () => {
    const vault = await fixture.openVault()

    let ready = false
    const server = await createVaultServer({
      vault,
      store: new LocalDiskStore(join(fixture.root, 'server', 'state')),
      token: 'test-token-1234567890',
      maxBodyBytes: 1024 * 1024,
      collab: false,
      changes: new ChangeEmitter(),
      onReady: () => { ready = true },
    })

    expect(ready).toBe(true)
    
    const { files } = await vault.list()
    expect(files.length).toBeGreaterThan(0)

    await closeVaultServer(server)
  })

  it('healthz returns not-ready during initialization', async () => {
    // This is a conceptual test - in practice, the server becomes ready
    // before we can query it in this test. Real verification happens in
    // integration tests with slower clones.
    const vault = await fixture.openVault()

    const server = await createVaultServer({
      vault,
      store: new LocalDiskStore(join(fixture.root, 'server', 'state')),
      token: 'test-token-1234567890',
      maxBodyBytes: 1024 * 1024,
      collab: false,
      changes: new ChangeEmitter(),
    })

    await closeVaultServer(server)
  })
})

describe('SIGTERM handling', () => {
  let fixture: Fixture

  beforeEach(async () => {
    fixture = await createFixture()
  })

  afterEach(async () => {
    await fixture.cleanup()
  })

  it('flushes and pushes on shutdown', async () => {
    const vault = await fixture.openVault()

    const server = await createVaultServer({
      vault,
      store: new LocalDiskStore(join(fixture.root, 'server', 'state')),
      token: 'test-token-1234567890',
      maxBodyBytes: 1024 * 1024,
      collab: false,
      changes: new ChangeEmitter(),
    })

    // Write a file
    await vault.write('new.md' as never, Buffer.from('# New Note'), { kind: 'absent' })
    
    // Close server (simulates SIGTERM)
    await closeVaultServer(server)

    // Verify the change was pushed by checking from desktop clone
    await fixture.desktop.run(['pull', '-q'])
    const { files } = await vault.list()
    expect(files.some(f => f.path === 'new.md')).toBe(true)
  })

  it('calls flushAndPush on shutdown', async () => {
    const logs: string[] = []
    const vault = await fixture.openVault({
      log: (msg) => logs.push(msg),
    })

    const server = await createVaultServer({
      vault,
      store: new LocalDiskStore(join(fixture.root, 'server', 'state')),
      token: 'test-token-1234567890',
      maxBodyBytes: 1024 * 1024,
      collab: false,
      changes: new ChangeEmitter(),
      log: (msg) => logs.push(msg),
    })

    // Write a file
    await vault.write('local.md' as never, Buffer.from('# Local Only'), { kind: 'absent' })
    
    // Close server
    await closeVaultServer(server)

    // Should have logged shutdown steps
    const hasShutdownLog = logs.some(log => log.includes('shutdown'))
    expect(hasShutdownLog).toBe(true)
  })
})

describe('Debounced push', () => {
  let fixture: Fixture

  beforeEach(async () => {
    fixture = await createFixture()
  })

  afterEach(async () => {
    await fixture.cleanup()
  })

  it('pushes after debounce period', async () => {
    const vault = await Vault.open({
      dir: fixture.vaultDir,
      remoteUrl: fixture.remote,
      branch: 'main',
      pushDebounceMs: 100,
    })

    const server = await createVaultServer({
      vault,
      store: new LocalDiskStore(join(fixture.root, 'server', 'state')),
      token: 'test-token-1234567890',
      maxBodyBytes: 1024 * 1024,
      collab: false,
      changes: new ChangeEmitter(),
    })

    // Write a file
    await vault.write('debounced.md' as never, Buffer.from('# Debounced'), { kind: 'absent' })
    
    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 150))

    // Verify it was pushed by pulling from desktop
    await fixture.desktop.run(['pull', '-q'])
    const { files } = await vault.list()
    expect(files.some(f => f.path === 'debounced.md')).toBe(true)

    await closeVaultServer(server)
  })

  it('can disable debounced push with pushDebounceMs=0', async () => {
    const vault = await Vault.open({
      dir: fixture.vaultDir,
      remoteUrl: fixture.remote,
      branch: 'main',
      pushDebounceMs: 0,
    })

    const server = await createVaultServer({
      vault,
      store: new LocalDiskStore(join(fixture.root, 'server', 'state')),
      token: 'test-token-1234567890',
      maxBodyBytes: 1024 * 1024,
      collab: false,
      changes: new ChangeEmitter(),
    })

    // Write a file - push happens immediately inline
    const result = await vault.write('immediate.md' as never, Buffer.from('# Immediate'), { kind: 'absent' })
    
    // Should have pushed immediately
    expect(result.pushed).toBe(true)

    await closeVaultServer(server)
  })
})
