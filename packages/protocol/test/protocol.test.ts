import { describe, expect, it } from 'vitest'
import {
  API_PREFIX,
  COLLAB_CAPABILITIES,
  FILE_CAPABILITIES,
  hasCapability,
  isSupportedProtocolVersion,
  PROTOCOL_MAJOR,
  PROTOCOL_VERSION,
  ROUTES,
} from '../src/index.ts'

describe('protocol version', () => {
  it('declares a version whose major matches the route prefix', () => {
    expect(PROTOCOL_VERSION.startsWith(`${PROTOCOL_MAJOR}.`)).toBe(true)
    expect(API_PREFIX).toBe(`/v${PROTOCOL_MAJOR}`)
    for (const path of Object.values(ROUTES)) expect(path.startsWith(`${API_PREFIX}/`)).toBe(true)
  })

  it('supports every minor of its own major', () => {
    expect(isSupportedProtocolVersion(PROTOCOL_VERSION)).toBe(true)
    expect(isSupportedProtocolVersion('1.7')).toBe(true)
    expect(isSupportedProtocolVersion(' 1.0 ')).toBe(true)
  })

  it.each(['2.0', '0.9', '1', '1.x', 'v1.0', '', '1.0.0'])('does not support %j', (version) => {
    expect(isSupportedProtocolVersion(version)).toBe(false)
  })
})

describe('capabilities', () => {
  it('keeps file and collaboration capabilities apart so collaboration is additive', () => {
    const fileOnly = { capabilities: [...FILE_CAPABILITIES] }
    expect(hasCapability(fileOnly, 'files.conflict-copy')).toBe(true)
    expect(hasCapability(fileOnly, 'collab.yjs')).toBe(false)
    expect(hasCapability({ capabilities: [...FILE_CAPABILITIES, ...COLLAB_CAPABILITIES] }, 'collab.yjs')).toBe(true)
  })
})
