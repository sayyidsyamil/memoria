import type { GitHttpRequest, HttpClient } from 'isomorphic-git'

type FetchReply = Pick<Response, 'body' | 'arrayBuffer' | 'headers' | 'url' | 'status' | 'statusText'>
type GitFetchOptions = Pick<RequestInit, 'method' | 'headers' | 'redirect' | 'credentials'> & { body?: Uint8Array<ArrayBuffer>; signal?: AbortSignal }
export type GitFetch = (url: string, options?: GitFetchOptions) => Promise<FetchReply>

export function createGitFetchClient(request: GitFetch): HttpClient {
  return { request: (options) => sendRequest(request, options) }
}

async function sendRequest(request: GitFetch, options: GitHttpRequest) {
  const lifetime = requestLifetime(options.signal)
  try {
    const response = await request(options.url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: await collectUpload(options.body),
      signal: lifetime.signal,
      redirect: 'error',
      credentials: 'omit',
    })
    const body = await responseBody(response, lifetime)
    return {
      url: response.url,
      statusCode: response.status,
      statusMessage: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    }
  } catch (error) {
    lifetime.finish()
    throw error
  }
}

function requestLifetime(signal?: AbortSignal) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  let timer: ReturnType<typeof setTimeout> | undefined
  const pause = () => clearTimeout(timer)
  const wait = () => { pause(); timer = setTimeout(abort, 120_000) }
  const finish = () => { pause(); signal?.removeEventListener('abort', abort) }
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  wait()
  return { signal: controller.signal, pause, wait, finish }
}

async function collectUpload(body: GitHttpRequest['body']) {
  if (!body) return undefined
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of body) { chunks.push(chunk); size += chunk.length }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}

async function responseBody(response: FetchReply, lifetime: ReturnType<typeof requestLifetime>) {
  if (response.status >= 300 || !response.body) {
    try { return singleChunk(new Uint8Array(await response.arrayBuffer())) }
    finally { lifetime.finish() }
  }
  // Time network waits, not Git's pack processing between streamed chunks.
  lifetime.pause()
  return streamResponse(response.body, lifetime)
}

async function* singleChunk(bytes: Uint8Array) { yield bytes }

async function* streamResponse(body: ReadableStream<Uint8Array>, lifetime: ReturnType<typeof requestLifetime>) {
  const reader = body.getReader()
  try {
    while (true) {
      lifetime.wait()
      const chunk = await reader.read()
      lifetime.pause()
      if (chunk.done) return
      yield chunk.value
    }
  } finally {
    try { await reader.cancel() }
    finally { reader.releaseLock(); lifetime.finish() }
  }
}
