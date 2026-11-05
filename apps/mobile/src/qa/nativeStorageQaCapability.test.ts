import { expect, it } from 'vitest'
import { nativeStorageQaEnabled } from './nativeStorageQaCapability'

it('keeps development probes available without custom native support', () => {
  expect(nativeStorageQaEnabled(true, undefined)).toBe(true)
})

it('disables storage probes in an ordinary release binary', () => {
  expect(nativeStorageQaEnabled(false, undefined)).toBe(false)
  expect(nativeStorageQaEnabled(false, false)).toBe(false)
})

it('allows optimized QA only when the binary explicitly exposes its capability', () => {
  expect(nativeStorageQaEnabled(false, true)).toBe(true)
})

it('does not accept string flags or other truthy values as native authorization', () => {
  for (const value of ['true', '1', 1, {}, null]) expect(nativeStorageQaEnabled(false, value)).toBe(false)
})
