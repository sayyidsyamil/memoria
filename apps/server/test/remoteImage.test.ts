import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VaultError } from '../src/errors.ts'
import { remoteImageFetcher } from '../src/remoteImage.ts'

// TOL-204: the server downloads images a client points it at, so every hop is checked.

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const LOOPBACK_ONLY = (address: string) => address === '127.0.0.1'

type Route = (request: IncomingMessage, response: ServerResponse) => void

let server: Server
let origin: string
let routes: Map<string, Route>

beforeEach(async () => {
  routes = new Map()
  server = createServer((request, response) => {
    const route = routes.get(request.url ?? '')
    if (route) return route(request, response)
    response.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})

function image(type = 'image/png', body: Buffer = PNG): Route {
  return (_request, response) => response.writeHead(200, { 'content-type': type }).end(body)
}

function redirect(location: string): Route {
  return (_request, response) => response.writeHead(302, { location }).end()
}

async function refusal(promise: Promise<unknown>): Promise<VaultError> {
  const error = await promise.then(() => null, (caught: unknown) => caught)
  expect(error).toBeInstanceOf(VaultError)
  return error as VaultError
}

const loopbackFetch = (limits = {}) =>
  remoteImageFetcher({ isAllowedAddress: LOOPBACK_ONLY, limits, now: () => 1700000000000 })

describe('the public image fetcher', () => {
  const fetchPublic = remoteImageFetcher()

  it.each([
    'file:///etc/passwd',
    'ftp://example.com/a.png',
    'gopher://example.com/',
    'data:image/png;base64,AAAA',
    'javascript:alert(1)',
    'not a url',
  ])('refuses the scheme of %s', async (url) => {
    const error = await refusal(fetchPublic(url))
    expect(error.status).toBe(400)
    expect(error.message).toContain('http or https')
  })

  it('refuses credentials in the url', async () => {
    const error = await refusal(fetchPublic('https://user:secret@example.com/a.png'))
    expect(error.message).toContain('credentials')
  })

  it.each([
    'http://127.0.0.1/a.png',
    'http://[::1]/a.png',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/a.png',
    'http://192.168.0.10/a.png',
    'http://2130706433/a.png',
    'http://[::ffff:127.0.0.1]/a.png',
    'http://[fd00:ec2::254]/latest/meta-data/',
  ])('refuses the private address %s before connecting', async (url) => {
    const error = await refusal(fetchPublic(url))
    expect(error.status).toBe(400)
    expect(error.message).toContain('private')
  })

  it('refuses a host name that resolves to loopback', async () => {
    routes.set('/a.png', image())
    const port = new URL(origin).port
    const error = await refusal(fetchPublic(`http://localhost:${port}/a.png`))
    expect(error.status).toBe(400)
    expect(error.message).toContain('private')
  })
})

describe('downloading an allowed image', () => {
  it('names it after the url and the content type, like the desktop app', async () => {
    routes.set('/photos/My%20Cat.jpeg?size=2', image('image/png'))
    const fetched = await loopbackFetch()(`${origin}/photos/My%20Cat.jpeg?size=2`)
    expect(fetched.path).toBe('attachments/1700000000000-My_Cat.png')
    expect(fetched.bytes.equals(PNG)).toBe(true)
  })

  it('falls back to a generic name', async () => {
    routes.set('/', image('image/webp; charset=binary'))
    const fetched = await loopbackFetch()(`${origin}/`)
    expect(fetched.path).toBe('attachments/1700000000000-remote-image.webp')
  })

  it('keeps a malformed escape as it is', async () => {
    routes.set('/a%E0.gif', image('image/gif'))
    const fetched = await loopbackFetch()(`${origin}/a%E0.gif`)
    expect(fetched.path).toBe('attachments/1700000000000-a_E0.gif')
  })

  it('follows a redirect and checks where it goes', async () => {
    routes.set('/old.png', redirect('/new.png'))
    routes.set('/new.png', image())
    const fetched = await loopbackFetch()(`${origin}/old.png`)
    expect(fetched.path).toBe('attachments/1700000000000-new.png')
  })

  it('refuses a redirect to a private address', async () => {
    routes.set('/hop.png', redirect('http://169.254.169.254/latest/meta-data/'))
    const error = await refusal(loopbackFetch()(`${origin}/hop.png`))
    expect(error.message).toContain('private')
  })

  it('refuses a redirect to another scheme', async () => {
    routes.set('/hop.png', redirect('file:///etc/passwd'))
    const error = await refusal(loopbackFetch()(`${origin}/hop.png`))
    expect(error.message).toContain('http or https')
  })

  it('gives up after too many redirects', async () => {
    routes.set('/loop.png', redirect('/loop.png'))
    const error = await refusal(loopbackFetch({ maxRedirects: 2 })(`${origin}/loop.png`))
    expect(error.status).toBe(502)
    expect(error.message).toContain('redirects')
  })

  it('refuses what is not a supported image', async () => {
    routes.set('/page', image('text/html'))
    routes.set('/vector.svg', image('image/svg+xml'))
    expect((await refusal(loopbackFetch()(`${origin}/page`))).status).toBe(400)
    expect((await refusal(loopbackFetch()(`${origin}/vector.svg`))).status).toBe(400)
  })

  it('reports a failed answer from the image host', async () => {
    const error = await refusal(loopbackFetch()(`${origin}/missing.png`))
    expect(error.status).toBe(502)
    expect(error.message).toContain('404')
  })

  it('refuses an image announced as too large', async () => {
    routes.set('/big.png', image('image/png', Buffer.alloc(64)))
    const error = await refusal(loopbackFetch({ maxBytes: 32 })(`${origin}/big.png`))
    expect(error.status).toBe(413)
  })

  it('stops reading an image that grows too large without announcing it', async () => {
    routes.set('/stream.png', (_request, response) => {
      response.writeHead(200, { 'content-type': 'image/png' })
      response.write(Buffer.alloc(20))
      response.end(Buffer.alloc(20))
    })
    const error = await refusal(loopbackFetch({ maxBytes: 32 })(`${origin}/stream.png`))
    expect(error.status).toBe(413)
  })

  it('gives up on a host that takes too long', async () => {
    routes.set('/slow.png', () => {})
    const error = await refusal(loopbackFetch({ timeoutMs: 100 })(`${origin}/slow.png`))
    expect(error.status).toBe(502)
    expect(error.message).toContain('too long')
  })

  it('resolves a host name and connects to the address it checked', async () => {
    routes.set('/named.png', image())
    const port = new URL(origin).port
    const loopback = remoteImageFetcher({ isAllowedAddress: (address) => address === '127.0.0.1' || address === '::1' })
    const fetched = await loopback(`http://localhost:${port}/named.png`)
    expect(fetched.bytes.equals(PNG)).toBe(true)
  })

  it('reports a host name that does not resolve', async () => {
    const error = await refusal(loopbackFetch()('http://no-such-host.invalid/a.png'))
    expect(error.status).toBe(502)
  })

  it('reports a host that cannot be reached', async () => {
    const closed = `${origin}/a.png`
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    const error = await refusal(loopbackFetch()(closed))
    expect(error.status).toBe(502)
    server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  })
})
