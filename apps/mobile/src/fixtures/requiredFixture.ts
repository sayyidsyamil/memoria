import assert from 'node:assert/strict'

export function requiredFixture<T>(value: T | null | undefined): T {
  assert(value !== undefined && value !== null, 'Expected fixture value')
  return value
}
