import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gitTestEnvironment } from './gitTestServer'

afterEach(() => vi.unstubAllEnvs())

function gitConfig(key: string) {
  return execFileSync('git', ['config', '--get', key], {
    env: gitTestEnvironment(), encoding: 'utf8',
  }).trim()
}

describe('isolated native Git fixtures', () => {
  it('does not start automatic repacks while constructing large history', () => {
    expect(gitConfig('gc.auto')).toBe('0')
    expect(gitConfig('maintenance.auto')).toBe('false')
  })

  it('bounds host pack workers so native measurements do not compete with every CPU', () => {
    expect(gitConfig('pack.threads')).toBe('2')
  })

  it('ignores inherited Git overrides without changing the parent environment', () => {
    vi.stubEnv('GIT_DIR', '/not-a-fixture')
    vi.stubEnv('GIT_CONFIG_COUNT', '1')
    vi.stubEnv('GIT_CONFIG_KEY_0', 'gc.auto')
    vi.stubEnv('GIT_CONFIG_VALUE_0', '1')
    expect(gitTestEnvironment()).not.toHaveProperty('GIT_DIR')
    expect(gitConfig('gc.auto')).toBe('0')
    expect(process.env.GIT_CONFIG_VALUE_0).toBe('1')
  })
})
