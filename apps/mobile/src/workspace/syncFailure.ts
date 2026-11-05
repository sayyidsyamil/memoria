export type SyncFailureKind = 'retry' | 'authentication' | 'conflict' | 'provider' | 'local'

const namedFailures = new Map<string, SyncFailureKind>([
  ...['githubNetworkFailed', 'githubRequestTimeout', 'pushRejected', 'syncDeferred'].map(code => [code, 'retry'] as const),
  ...['githubAuthorizationExpired', 'githubAuthorizationFailed', 'githubCredentialStoreFailed'].map(code => [code, 'authentication'] as const),
  ...['linkedFolderUnavailable', 'mergeConflict', 'linkedFolderConflict'].map(code => [code, code === 'linkedFolderUnavailable' ? 'provider' : 'conflict'] as const),
])
const statusFailures = new Map<number, SyncFailureKind>([[401, 'authentication'], [403, 'authentication'], [408, 'retry'], [429, 'retry']])

export function syncFailureKind(error: unknown): SyncFailureKind {
  if (!(error instanceof Error)) return 'local'
  const named = namedFailures.get(error.message) ?? namedFailure(error)
  if (named) return named
  const status = httpFailure(httpStatus(error))
  if (status) return status
  return isNetworkFailure(error) ? 'retry' : 'local'
}

function namedFailure(error: Error): SyncFailureKind | null {
  return error.name === 'FolderOpenFailure' ? 'provider' : null
}

function isNetworkFailure(error: Error) {
  return error.name === 'AbortError' || /network request failed|failed to fetch|network connection|timed out/i.test(error.message)
}

function httpFailure(status: number): SyncFailureKind | null {
  return statusFailures.get(status) ?? (status >= 500 ? 'retry' : null)
}

function httpStatus(error: Error) {
  if (!('data' in error)) return 0
  return numericStatus(error.data)
}

function numericStatus(data: unknown) {
  if (typeof data !== 'object' || data === null) return 0
  if (!('statusCode' in data)) return 0
  const status = data.statusCode
  return typeof status === 'number' ? status : 0
}

export function retryRequested(value: unknown) {
  return typeof value === 'object' && value !== null && 'retry' in value && value.retry === true
}
