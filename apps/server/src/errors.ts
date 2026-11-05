import type { ErrorCode } from '../../../packages/protocol/src/index.ts'

/** An error with a stable protocol code and the HTTP status it maps to. */
export class VaultError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly details?: unknown

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'VaultError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export function notFound(path: string): VaultError {
  return new VaultError(404, 'not_found', `${path} does not exist`)
}

export function stale(path: string, etag: string): VaultError {
  return new VaultError(412, 'precondition_failed', `${path} changed since the given revision`, {
    current: { path, etag },
  })
}
