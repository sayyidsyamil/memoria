export type GitHubRequest = typeof fetch

export function githubApi<T>(path: string, token: string, request: GitHubRequest, signal?: AbortSignal): Promise<T> {
  return boundedRequest<T>(request, `https://api.github.com/${path}`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
    signal,
  })
}

export async function githubForm<T>(path: string, fields: Record<string, string>, request: GitHubRequest, signal?: AbortSignal): Promise<T> {
  return boundedRequest<T>(request, `https://github.com/login/${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
    signal,
  })
}

async function boundedRequest<T>(request: GitHubRequest, url: string, options: RequestInit): Promise<T> {
  if (options.signal?.aborted) throw new Error('cancelled')
  const controller = new AbortController()
  let rejectStopped!: (error: Error) => void
  const stopped = new Promise<never>((_, reject) => { rejectStopped = reject })
  const stop = (reason: string) => { rejectStopped(new Error(reason)); controller.abort() }
  const abort = () => stop('cancelled')
  const timeout = setTimeout(() => stop('githubRequestTimeout'), 30_000)
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    return await Promise.race([requestJson<T>(request, url, { ...options, signal: controller.signal, redirect: 'error' }), stopped])
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abort)
  }
}

async function requestJson<T>(request: GitHubRequest, url: string, options: RequestInit): Promise<T> {
  let response: Response
  try { response = await request(url, options) }
  catch { throw new Error('githubNetworkFailed') }
  if (!response.ok) throw new Error(response.status === 401 ? 'githubAuthorizationExpired' : 'githubRequestFailed')
  try { return await response.json() }
  catch { throw new Error('githubRequestFailed') }
}
