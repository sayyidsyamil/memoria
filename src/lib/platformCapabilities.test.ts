import { describe, expect, test } from 'vitest'
import { resolvePlatformCapabilities } from './platformCapabilities'

describe('resolvePlatformCapabilities', () => {
  test('tauri backend enables all desktop features', () => {
    const capabilities = resolvePlatformCapabilities('tauri')
    
    expect(capabilities.git).toBe(true)
    expect(capabilities.mcp).toBe(true)
    expect(capabilities.updater).toBe(true)
    expect(capabilities.multiWindow).toBe(true)
    expect(capabilities.openCode).toBe(true)
    expect(capabilities.cliAgents).toBe(true)
    expect(capabilities.perNoteEditors).toBe(false)
  })

  test('mock backend enables all desktop features', () => {
    const capabilities = resolvePlatformCapabilities('mock')
    
    expect(capabilities.git).toBe(true)
    expect(capabilities.mcp).toBe(true)
    expect(capabilities.updater).toBe(true)
    expect(capabilities.multiWindow).toBe(true)
    expect(capabilities.openCode).toBe(true)
    expect(capabilities.cliAgents).toBe(true)
    expect(capabilities.perNoteEditors).toBe(false)
  })

  test('remote backend disables desktop-only features', () => {
    const capabilities = resolvePlatformCapabilities('remote')
    
    expect(capabilities.git).toBe(false)
    expect(capabilities.mcp).toBe(false)
    expect(capabilities.updater).toBe(false)
    expect(capabilities.multiWindow).toBe(false)
    expect(capabilities.openCode).toBe(false)
    expect(capabilities.cliAgents).toBe(false)
    expect(capabilities.perNoteEditors).toBe(true)
  })

  test('includes all capability flags', () => {
    const capabilities = resolvePlatformCapabilities('tauri')
    
    expect(capabilities).toHaveProperty('git')
    expect(capabilities).toHaveProperty('mcp')
    expect(capabilities).toHaveProperty('updater')
    expect(capabilities).toHaveProperty('multiWindow')
    expect(capabilities).toHaveProperty('openCode')
    expect(capabilities).toHaveProperty('cliAgents')
    expect(capabilities).toHaveProperty('perNoteEditors')
  })
})
