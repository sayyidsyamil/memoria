import { expect, it } from 'vitest'
import { resolveGitHubClientId } from './githubClientId'

it.each([undefined, '', ' ', '\n\t'])('keeps GitHub sign-in configured without local build configuration (%j)', (override) => {
  expect(resolveGitHubClientId(override)).toBe('Ov23liNOTXRjy9MZr0Fy')
})

it('keeps an explicit public OAuth client override', () => {
  expect(resolveGitHubClientId('  public-test-client\n')).toBe('public-test-client')
})
