const ipv4AddressPattern = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/u
const privateIpv4AddressPattern = /^(?:(?:10|127)\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/u

export function privateDevVaultBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed) throw new Error('Local vault bridge URL is missing')

  const url = new URL(trimmed)
  if (!isPrivateDevVaultUrl(url)) {
    throw new Error('Local vault bridge must use a private network URL')
  }
  url.pathname = url.pathname.replace(/\/snapshot\/?$/u, '').replace(/\/+$/u, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/u, '')
}

export function fetchPrivateDevVault(
  baseUrl: string,
  endpoint: string,
  options: { query?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<Response> {
  const allowedBaseUrls = [privateDevVaultBaseUrl(baseUrl)]
  const requestUrl = new URL(endpoint, `${allowedBaseUrls[0]}/`)
  if (allowedBaseUrls.includes(requestUrl.origin)) {
    appendQuery(requestUrl, options.query)
    return fetch(new Request(requestUrl, { signal: options.signal }))
  }
  throw new Error('Local vault bridge request escaped the allowed origin')
}

function appendQuery(url: URL, query?: Record<string, string>) {
  if (!query) return
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
}

function isPrivateDevVaultUrl(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (url.username || url.password) return false

  const hostname = url.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname === '::1' || hostname.endsWith('.local')) return true
  return isPrivateIpv4Address(hostname)
}

function isPrivateIpv4Address(hostname: string): boolean {
  return ipv4AddressPattern.test(hostname) && privateIpv4AddressPattern.test(hostname)
}
