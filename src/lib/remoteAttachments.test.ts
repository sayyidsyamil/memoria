import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importRemoteImagesToVault, resolveRemoteAttachmentUrl, uploadRemoteImage } from './remoteAttachments'

const trackEvent = vi.hoisted(() => vi.fn())
vi.mock('./telemetry', () => ({ trackEvent }))

// TOL-204: images on a Memoria remote are files under attachments/, read with the session token.

interface Call {
  method: string
  path: string
  headers: Record<string, string>
  body?: BodyInit | null
}

let calls: Call[]
let answer: (call: Call) => Response | Promise<Response>
let objectUrlCount: number

function configureRemote(on: boolean) {
  const target = window as { MEMORIA_REMOTE_URL?: string; MEMORIA_REMOTE_TOKEN?: string }
  if (on) {
    target.MEMORIA_REMOTE_URL = 'https://vault.example'
    target.MEMORIA_REMOTE_TOKEN = 'token-for-tests'
  } else {
    delete target.MEMORIA_REMOTE_URL
    delete target.MEMORIA_REMOTE_TOKEN
  }
}

/** jsdom's File has no arrayBuffer(); browsers do. */
function imageFile(name: string, bytes: number[]): File {
  const file = new File([new Uint8Array(bytes)], name, { type: 'image/png' })
  return Object.assign(file, { arrayBuffer: async () => new Uint8Array(bytes).buffer })
}

function written(path: string, status = 201): Response {
  return new Response(JSON.stringify({ outcome: 'created', path }), { status })
}

beforeEach(() => {
  calls = []
  objectUrlCount = 0
  answer = () => new Response(new Uint8Array([1, 2, 3]))
  configureRemote(true)
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const call = {
      method: init.method ?? 'GET',
      path: decodeURIComponent(new URL(url).pathname),
      headers: init.headers as Record<string, string>,
      body: init.body,
    }
    calls.push(call)
    return answer(call)
  }))
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:vault/${++objectUrlCount}`)
})

afterEach(() => {
  configureRemote(false)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('uploading an image to the remote', () => {
  it('stores it under attachments/ with the token and resolves with the path the note links', async () => {
    answer = (call) => written(call.path.replace('/v1/files/', ''))
    const file = imageFile('Screen Shot.png', [7, 7])

    const path = await uploadRemoteImage(file)

    expect(path).toMatch(/^attachments\/\d+-Screen_Shot\.png$/u)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: 'PUT', path: `/v1/files/${path}` })
    expect(calls[0].headers).toMatchObject({ authorization: 'Bearer token-for-tests', 'if-none-match': '*' })
    expect(trackEvent).toHaveBeenCalledWith('web_attachment_uploaded', { mime_type: 'image/png', size_bytes: 2 })
  })

  it('refuses while the vault is offline and read-only', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const file = imageFile('a.png', [7])
    await expect(uploadRemoteImage(file)).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })

  it('needs a configured remote', async () => {
    configureRemote(false)
    const file = imageFile('a.png', [7])
    await expect(uploadRemoteImage(file)).rejects.toThrow('No Memoria remote')
  })
})

describe('showing an attachment', () => {
  it('reads it once with the token and reuses the object URL', async () => {
    const first = await resolveRemoteAttachmentUrl('attachments/cache-me.png')
    const again = await resolveRemoteAttachmentUrl('./attachments/cache-me.png')

    expect(first).toBe('blob:vault/1')
    expect(again).toBe(first)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/v1/files/attachments/cache-me.png' })
    expect(calls[0].headers).toMatchObject({ authorization: 'Bearer token-for-tests' })
  })

  it('tries again after a failed read', async () => {
    answer = () => new Response(null, { status: 401 })
    await expect(resolveRemoteAttachmentUrl('attachments/retry.png')).rejects.toMatchObject({ status: 401 })

    answer = () => new Response(new Uint8Array([1]))
    await expect(resolveRemoteAttachmentUrl('attachments/retry.png')).resolves.toMatch(/^blob:vault\//u)
    expect(calls).toHaveLength(2)
  })

  it('shows any other URL as it is', async () => {
    await expect(resolveRemoteAttachmentUrl('https://example.com/a.png')).resolves.toBe('https://example.com/a.png')
    expect(calls).toHaveLength(0)
  })
})

describe('importing pasted remote images', () => {
  it('has the server download each one and counts the ones it refused', async () => {
    answer = (call) => {
      const { url } = JSON.parse(String(call.body)) as { url: string }
      if (url.includes('169.254')) return new Response('{}', { status: 400 })
      return written('attachments/1-cat.png')
    }

    const result = await importRemoteImagesToVault([
      { alt: 'cat', url: 'https://images.example/cat.png' },
      { alt: '', url: 'http://169.254.169.254/latest/meta-data/' },
    ])

    expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'POST /v1/attachments/imports',
      'POST /v1/attachments/imports',
    ])
    expect(result).toEqual({
      failedCount: 1,
      totalCount: 2,
      replacements: new Map([['https://images.example/cat.png', 'attachments/1-cat.png']]),
    })
  })
})
