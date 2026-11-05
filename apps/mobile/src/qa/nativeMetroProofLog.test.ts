import { appendFileSync, mkdtempSync, renameSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { captureNativeMetroLog } from './nativeMetroProofLog'

const directories: string[] = []

function createLog() {
  const directory = mkdtempSync(join(tmpdir(), 'memoria-metro-proof-'))
  directories.push(directory)
  const path = join(directory, 'metro.log')
  writeFileSync(path, 'previous proof\n')
  return path
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

it('ignores previous output and retains fresh bytes across repeated polls', () => {
  const path = createLog()
  const read = captureNativeMetroLog(path)
  expect(read()).toBe('')
  appendFileSync(path, 'fresh proof: \u2713\n')
  expect(read()).toBe('fresh proof: \u2713\n')
  expect(read()).toBe('fresh proof: \u2713\n')
  appendFileSync(path, 'next line\n')
  expect(read()).toBe('fresh proof: \u2713\nnext line\n')
})

it('rejects a replaced file instead of accepting unrelated proof', () => {
  const path = createLog()
  const read = captureNativeMetroLog(path)
  renameSync(path, `${path}.old`)
  writeFileSync(path, 'unrelated replacement proof\n')
  expect(read).toThrow('replaced or truncated')
})

it('rejects a truncated file', () => {
  const path = createLog()
  const read = captureNativeMetroLog(path)
  truncateSync(path, 0)
  expect(read).toThrow('replaced or truncated')
})

it('bounds the amount of newly appended output', () => {
  const path = createLog()
  const read = captureNativeMetroLog(path)
  appendFileSync(path, Buffer.alloc(2 * 1024 * 1024 + 1, 65))
  expect(read).toThrow('exceeds 2 MiB')
})

it('allows no Metro source but reports an explicitly missing source', () => {
  expect(captureNativeMetroLog(undefined)()).toBe('')
  const path = createLog()
  rmSync(path)
  expect(() => captureNativeMetroLog(path)).toThrow()
})
