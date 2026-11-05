import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Access } from '../src/access.ts'
import { ChangeEmitter } from '../src/changeEmitter.ts'
import { DocIndex } from '../src/docIndex.ts'
import { route, type Services } from '../src/routes.ts'
import { createVaultServer } from '../src/server.ts'
import { LocalDiskStore } from '../src/store.ts'
import type { Vault } from '../src/vault.ts'
import { createFixture, type Fixture } from './helpers.ts'

// TOL-204: attachments are served only to an authorized client, and imported only from public hosts.

const TOKEN = 'test-token-0123456789'
const IMAGE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9])

let fixture: Fixture
let vault: Vault
let server: Server
let origin: string

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
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await vault.idle()
  await fixture.cleanup()
})

interface TestRequest {
  path: string
  init?: RequestInit
}

/** Calls the test server, which is always bound to loopback. */
function call({ path, init = {} }: TestRequest): Promise<Response> {
  return fetch(new URL(path, origin), init)
}

const AUTH = { authorization: `Bearer ${TOKEN}` }

describe('serving attachments', () => {
  it('serves an attachment to a client with the token', async () => {
    const response = await call({ path: '/v1/files/attachments/pixel.bin', init: { headers: AUTH } })
    expect(response.status).toBe(200)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it.each([
    ['no credentials', {}],
    ['a wrong token', { authorization: 'Bearer wrong-token-0123456789' }],
    ['a malformed header', { authorization: TOKEN }],
    ['basic credentials', { authorization: `Basic ${Buffer.from(`x:${TOKEN}`).toString('base64')}` }],
  ])('refuses an attachment request with %s', async (_name, headers) => {
    const response = await call({ path: '/v1/files/attachments/pixel.bin', init: { headers } })
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe('Bearer')
    expect(await response.json()).toMatchObject({ error: { code: 'unauthorized' } })
  })

  it('does not take the token from the query string', async () => {
    const response = await call({ path: `/v1/files/attachments/pixel.bin?token=${TOKEN}&ticket=${TOKEN}` })
    expect(response.status).toBe(401)
  })

  it('refuses an upload without the token', async () => {
    const response = await call({ path: '/v1/files/attachments/new.png', init: {
      method: 'PUT',
      headers: { 'if-none-match': '*' },
      body: IMAGE,
    } })
    expect(response.status).toBe(401)
  })
})

describe('importing a remote image', () => {
  it('announces the capability', async () => {
    const body = await (await call({ path: '/v1/vault', init: { headers: AUTH } })).json()
    expect(body.capabilities).toContain('attachments.import')
  })

  it('refuses a request without the token', async () => {
    const response = await call({ path: '/v1/attachments/imports', init: {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/a.png' }),
    } })
    expect(response.status).toBe(401)
  })

  it.each([
    'http://127.0.0.1/a.png',
    'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    'http://[fe80::1]/a.png',
    'http://192.168.1.1/a.png',
    'http://localhost/a.png',
  ])('refuses the internal address %s and stores nothing', async (url) => {
    const response = await call({ path: '/v1/attachments/imports', init: {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ url }),
    } })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } })
    const { files } = await vault.list('attachments/')
    expect(files.map((file) => file.path)).toEqual(['attachments/pixel.bin'])
  })

  it('needs a url', async () => {
    const response = await call({ path: '/v1/attachments/imports', init: { method: 'POST', headers: AUTH, body: '{}' } })
    expect(response.status).toBe(400)
  })

  it('commits the image and pushes it for the desktop app to pull', async () => {
    const docs = await DocIndex.open(new LocalDiskStore(join(fixture.root, 'route-state')))
    const remoteImages = async (url: string) => {
      expect(url).toBe('https://images.example/cat.png')
      return { path: 'attachments/1-cat.png', bytes: IMAGE }
    }
    const services = { vault, docs, remoteImages } as unknown as Services
    const reply = await route(
      {
        method: 'POST',
        url: new URL('http://vault.invalid/v1/attachments/imports'),
        headers: {},
        body: async () => Buffer.from(JSON.stringify({ url: 'https://images.example/cat.png' })),
        access: Access.OWNER,
      },
      services,
    )
    expect(reply.status).toBe(201)
    expect(reply.body).toMatchObject({ outcome: 'created', path: 'attachments/1-cat.png' })
    await vault.flushAndPush()
    await fixture.desktop.run(['pull', '-q', '--ff-only'])
    const { stdout } = await fixture.desktop.run(['cat-file', '-s', 'HEAD:attachments/1-cat.png'])
    expect(Number(stdout.trim())).toBe(IMAGE.byteLength)
  })
})
