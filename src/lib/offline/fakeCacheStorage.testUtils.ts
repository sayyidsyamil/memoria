/** In-memory Cache Storage for the offline unit tests: keys keep insertion order, like browsers. */

function keyOf(request: RequestInfo | URL): string {
  if (typeof request === 'string') return new URL(request, 'https://memoria.test').href
  if (request instanceof URL) return request.href
  return request.url
}

function headersOf(request: RequestInfo | URL): Headers {
  return request instanceof Request ? request.headers : new Headers()
}

/** The Vary rule of the Cache API: each listed request header must be the same as when stored. */
function varyMatches(stored: StoredResponse, request: RequestInfo | URL): boolean {
  const vary = stored.response.headers.get('vary')
  if (!vary) return true
  const headers = headersOf(request)
  return vary.split(',').map((name) => name.trim()).every((name) => headers.get(name) === stored.requestHeaders.get(name))
}

interface StoredResponse {
  response: Response
  requestHeaders: Headers
}

export class FakeCache {
  readonly entries = new Map<string, StoredResponse>()

  async match(request: RequestInfo | URL, options: CacheQueryOptions = {}): Promise<Response | undefined> {
    const stored = this.entries.get(keyOf(request))
    if (!stored || (!options.ignoreVary && !varyMatches(stored, request))) return undefined
    return stored.response.clone()
  }

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    this.entries.set(keyOf(request), { response, requestHeaders: headersOf(request) })
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(keyOf(request))
  }

  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((url) => new Request(url))
  }
}

export class FakeCacheStorage {
  readonly stores = new Map<string, FakeCache>()

  async open(name: string): Promise<FakeCache> {
    const existing = this.stores.get(name)
    if (existing) return existing
    const created = new FakeCache()
    this.stores.set(name, created)
    return created
  }

  async has(name: string): Promise<boolean> {
    return this.stores.has(name)
  }

  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name)
  }

  async keys(): Promise<string[]> {
    return [...this.stores.keys()]
  }

  asCacheStorage(): CacheStorage {
    return this as unknown as CacheStorage
  }
}
