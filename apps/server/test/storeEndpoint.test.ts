import { describe, expect, it } from 'vitest'
import type { R2Config } from '../src/store.ts'
import type { AddressResolver } from '../src/publicAddress.ts'
import { assertPublicEndpoint, checkStoreEndpoints, storeEndpoints } from '../src/storeEndpoint.ts'

// TOL-207: the R2/S3 endpoints the server signs requests to must be public hosts.

const PUBLIC = '104.18.0.1'
const REFUSED = /private, loopback, link-local or metadata address/

function resolving(answers: Record<string, string[]>): AddressResolver & { asked: string[] } {
  const asked: string[] = []
  const resolver = async (hostname: string) => {
    asked.push(hostname)
    const addresses = answers[hostname]
    if (!addresses) throw new Error(`ENOTFOUND ${hostname}`)
    return addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
  }
  return Object.assign(resolver, { asked })
}

function r2(endpoint: string): R2Config {
  return { bucket: 'b', endpoint, region: 'auto', accessKeyId: 'id', secretAccessKey: 'secret' }
}

describe('assertPublicEndpoint', () => {
  it.each([`https://${PUBLIC}`, 'https://[2606:4700:4700::1111]:443/bucket'])('allows the public literal %s without a lookup', async (endpoint) => {
    const resolver = resolving({})
    await expect(assertPublicEndpoint(endpoint, resolver)).resolves.toBeUndefined()
    expect(resolver.asked).toEqual([])
  })

  it('allows a host name that resolves to public addresses only', async () => {
    const resolver = resolving({ 'account.r2.cloudflarestorage.com': [PUBLIC, '2606:4700::6812:1'] })
    await expect(assertPublicEndpoint('https://account.r2.cloudflarestorage.com', resolver)).resolves.toBeUndefined()
    expect(resolver.asked).toEqual(['account.r2.cloudflarestorage.com'])
  })

  it.each([
    'http://127.0.0.1:9000',
    'http://10.0.0.5:9000',
    'http://172.20.1.1',
    'http://192.168.1.10:9000',
    'http://100.64.0.1',
    'http://169.254.169.254/latest',
    'http://0.0.0.0:9000',
    'http://[::1]:9000',
    'http://[fd00::5]:9000',
    'http://[fc00::1]',
    'http://[fe80::1]',
    'http://[fd00:ec2::254]',
    'http://[::ffff:10.0.0.1]',
    'http://[::ffff:127.0.0.1]:9000',
  ])('refuses the non-public literal %s', async (endpoint) => {
    await expect(assertPublicEndpoint(endpoint, resolving({}))).rejects.toThrowError(REFUSED)
  })

  it.each([
    ['minio.internal', ['10.0.0.7']],
    ['metadata.example', ['169.254.169.254']],
    ['ula.example', ['fd12:3456::1']],
    ['loopback6.example', ['::1']],
    ['cgnat.example', ['100.100.0.1']],
    ['mixed.example', [PUBLIC, '192.168.0.2']],
  ])('refuses %s, which resolves to %j', async (host, addresses) => {
    await expect(assertPublicEndpoint(`https://${host}`, resolving({ [host]: addresses }))).rejects.toThrowError(REFUSED)
  })

  it('refuses localhost through the real resolver', async () => {
    await expect(assertPublicEndpoint('http://localhost:9000')).rejects.toThrowError(REFUSED)
  })

  it('refuses a host that does not resolve, or resolves to nothing', async () => {
    await expect(assertPublicEndpoint('https://missing.example', resolving({}))).rejects.toThrowError(
      'MEMORIA_R2_ENDPOINT host missing.example could not be resolved',
    )
    await expect(assertPublicEndpoint('https://empty.example', resolving({ 'empty.example': [] }))).rejects.toThrowError(
      'MEMORIA_R2_ENDPOINT host empty.example resolves to no address',
    )
  })
})

describe('checkStoreEndpoints', () => {
  const local = { blobStore: { type: 'local' as const, stateDir: '/tmp/state' }, indexSnapshots: null }

  it('lists the blob store and snapshot endpoints once each', () => {
    expect(storeEndpoints(local)).toEqual([])
    const same = r2('https://a.example')
    expect(storeEndpoints({ blobStore: { type: 'r2', config: same }, indexSnapshots: { r2: same, prefix: 'v' } })).toEqual(['https://a.example'])
    expect(storeEndpoints({ ...local, indexSnapshots: { r2: r2('https://b.example'), prefix: 'v' } })).toEqual(['https://b.example'])
  })

  it('checks nothing for a local blob store without snapshots', async () => {
    const resolver = resolving({})
    await expect(checkStoreEndpoints({ ...local, allowPrivateR2Endpoint: false }, resolver)).resolves.toBeUndefined()
    expect(resolver.asked).toEqual([])
  })

  it('refuses a private snapshot endpoint and allows a public blob store', async () => {
    const resolver = resolving({ 'r2.example': [PUBLIC] })
    const blobStore = { type: 'r2' as const, config: r2('https://r2.example') }
    await expect(checkStoreEndpoints({ blobStore, indexSnapshots: null, allowPrivateR2Endpoint: false }, resolver)).resolves.toBeUndefined()
    const indexSnapshots = { r2: r2('http://127.0.0.1:9000'), prefix: 'v' }
    await expect(checkStoreEndpoints({ blobStore, indexSnapshots, allowPrivateR2Endpoint: false }, resolver)).rejects.toThrowError(REFUSED)
  })

  it('lets development reach a local MinIO when the flag allows it', async () => {
    const blobStore = { type: 'r2' as const, config: r2('http://127.0.0.1:9000') }
    await expect(checkStoreEndpoints({ blobStore, indexSnapshots: null, allowPrivateR2Endpoint: true }, resolving({}))).resolves.toBeUndefined()
  })
})
