import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChangeEmitter } from '../../../apps/server/src/changeEmitter.ts'
import { closeVaultServer, createVaultServer } from '../../../apps/server/src/server.ts'
import { LocalDiskStore } from '../../../apps/server/src/store.ts'
import type { Vault } from '../../../apps/server/src/vault.ts'
import { createFixture, type Fixture } from '../../../apps/server/test/helpers.ts'
import { attachmentContentType, attachmentUploadPath } from '../src/remoteAttachments.ts'
import { createRemoteAttachments, createRemoteVaultBackend } from '../src/remoteVaultBackend.ts'

// TOL-204: images pasted on the web are files under attachments/ on the server.

const TOKEN = 'test-token-0123456789'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

let fixture: Fixture
let vault: Vault
let server: Server
let baseUrl: string

beforeEach(async () => {
  fixture = await createFixture()
  vault = await fixture.openVault()
  server = await createVaultServer({
    vault,
    store: new LocalDiskStore(join(fixture.root, 'server', 'state')),
    token: TOKEN,
    maxBodyBytes: 1024 * 1024,
    collab: false,
    changes: new ChangeEmitter(),
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  await closeVaultServer(server)
  await vault.idle()
  await fixture.cleanup()
})

describe('attachment names and types', () => {
  it('names an upload the way the desktop app does', () => {
    expect(attachmentUploadPath('My Cat (1).png', 42)).toBe('attachments/42-My_Cat__1_.png')
    expect(attachmentUploadPath('../../etc/passwd', 42)).toBe('attachments/42-_.._etc_passwd')
    expect(attachmentUploadPath('', 42)).toBe('attachments/42-image')
  })

  it('types an attachment after its extension', () => {
    expect(attachmentContentType('attachments/a.PNG')).toBe('image/png')
    expect(attachmentContentType('attachments/a.jpeg')).toBe('image/jpeg')
    expect(attachmentContentType('attachments/a.svg')).toBe('image/svg+xml')
    expect(attachmentContentType('attachments/a.bin')).toBe('application/octet-stream')
  })
})

describe('attachments on the remote', () => {
  it('uploads an image through the backend and reads it back as a typed blob', async () => {
    const backend = createRemoteVaultBackend({ baseUrl, token: TOKEN })
    const { path } = await backend.files.saveAttachment({ filename: 'shot.png', bytes: PNG })
    expect(path).toMatch(/^attachments\/\d+-shot\.png$/u)

    const blob = await createRemoteAttachments({ baseUrl, token: TOKEN }).read(path)
    expect(blob.type).toBe('image/png')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(PNG)

    await vault.flushAndPush()
    await fixture.desktop.run(['pull', '-q', '--ff-only'])
    const { stdout } = await fixture.desktop.run(['cat-file', '-s', `HEAD:${path}`])
    expect(Number(stdout.trim())).toBe(PNG.byteLength)
  })

  it('keeps both images when two uploads get the same name', async () => {
    const attachments = createRemoteAttachments({ baseUrl, token: TOKEN })
    const sameTime = createRemoteAttachments({ baseUrl, token: TOKEN, now: () => 7 })
    const first = await sameTime.save({ filename: 'a.png', bytes: PNG })
    const second = await sameTime.save({ filename: 'a.png', bytes: new Uint8Array([9]) })
    expect(first.path).toBe('attachments/7-a.png')
    expect(second.path).not.toBe(first.path)
    expect((await attachments.read(second.path)).size).toBe(1)
  })

  it('refuses to read an attachment without a valid token', async () => {
    const intruder = createRemoteAttachments({ baseUrl, token: 'wrong-token-0123456789' })
    await expect(intruder.read('attachments/pixel.bin')).rejects.toMatchObject({ name: 'RemoteError', status: 401 })
    await expect(intruder.save({ filename: 'a.png', bytes: PNG })).rejects.toMatchObject({ status: 401 })
  })

  it('refuses a path that leaves the vault before sending it', async () => {
    const attachments = createRemoteAttachments({ baseUrl, token: TOKEN })
    await expect(attachments.read('attachments/../welcome.md')).rejects.toMatchObject({ status: 400 })
  })

  it('reports the server refusing an import from an internal address', async () => {
    const attachments = createRemoteAttachments({ baseUrl, token: TOKEN })
    await expect(attachments.importFromUrl('http://169.254.169.254/latest/meta-data/')).rejects.toMatchObject({
      name: 'RemoteError',
      status: 400,
    })
  })
})
