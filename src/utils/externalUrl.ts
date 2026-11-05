export type ExternalUrlCandidate = string

function parseHttpUrl(candidate: ExternalUrlCandidate): URL | null {
  try {
    const parsedUrl = new URL(candidate)
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:' ? parsedUrl : null
  } catch {
    return null
  }
}

function hasBareDomainHost(parsedUrl: URL): boolean {
  const dotIndex = parsedUrl.hostname.lastIndexOf('.')
  return dotIndex > 0 && dotIndex <= parsedUrl.hostname.length - 3
}

function startsWithHttpProtocol(url: ExternalUrlCandidate): boolean {
  const lowerUrl = url.toLowerCase()
  return lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://')
}

export function normalizeExternalUrl(value: ExternalUrlCandidate): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  for (const char of trimmed) {
    if (char.trim() === '') return null
  }

  if (parseHttpUrl(trimmed)) return trimmed
  if (!trimmed.includes('.')) return null

  const bareDomainCandidate = `https://${trimmed}`
  const parsedBareDomain = parseHttpUrl(bareDomainCandidate)
  if (!parsedBareDomain || !hasBareDomainHost(parsedBareDomain)) return null
  return bareDomainCandidate
}

export function isUrlValue(value: ExternalUrlCandidate): boolean {
  return normalizeExternalUrl(value) !== null
}

export function normalizeUrl(url: ExternalUrlCandidate): string {
  const normalized = normalizeExternalUrl(url)
  if (normalized) return normalized
  if (startsWithHttpProtocol(url)) return url
  return `https://${url}`
}
