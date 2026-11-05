import { expect, it, vi } from 'vitest'
import { createGitHubAccountState, type GitHubAccountServices } from './githubAccountState'
import type { GitHubSession } from './githubAuth'

const session: GitHubSession = { accessToken: 'test-only', login: 'tester', userId: 42 }

function services(): GitHubAccountServices {
  return {
    restore: async () => session, save: async () => {}, clear: async () => {},
    begin: async () => ({ device_code: 'device', user_code: 'code', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 60 }),
    finish: async () => session, refresh: async (value) => value, list: async () => [],
  }
}

it('keeps the account visible when its stored credential could not be removed', async () => {
  const deps = services()
  deps.clear = vi.fn().mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValueOnce(undefined)
  const account = createGitHubAccountState(deps)
  await account.restore()
  await account.signOut()
  expect(account.snapshot()).toMatchObject({ session, busy: false, error: 'mobile.vaults.credentialFailed' })
  await account.signOut()
  expect(account.snapshot()).toMatchObject({ session: null, error: null })
})

it('does not hand out a session while credential deletion is pending', async () => {
  const deps = services()
  let finish!: () => void
  deps.clear = () => new Promise((resolve) => { finish = resolve })
  const account = createGitHubAccountState(deps)
  await account.restore()
  const signOut = account.signOut()
  account.cancelSignIn()
  await expect(account.currentSession()).resolves.toBeNull()
  finish()
  await signOut
  await expect(account.currentSession()).resolves.toBeNull()
})

it('cancels the initial device-code request before a code has arrived', async () => {
  const deps = services()
  const begin = vi.fn<GitHubAccountServices['begin']>().mockImplementation(() => new Promise(() => {}))
  deps.begin = begin
  const account = createGitHubAccountState(deps)
  void account.signIn()
  account.cancelSignIn()
  expect(begin.mock.calls[0][0]?.aborted).toBe(true)
  expect(account.snapshot()).toMatchObject({ busy: false, code: null, error: null })
})

it('does not tell users to sign in again after a network failure', async () => {
  const deps = services()
  deps.list = async () => { throw new Error('githubNetworkFailed') }
  const account = createGitHubAccountState(deps)
  await account.restore()
  await account.loadRepositories()
  expect(account.snapshot()).toMatchObject({ session, error: 'mobile.vaults.networkFailed', busy: false })
})

it('cancels an outstanding repository request when the manager closes', async () => {
  const deps = services()
  const list = vi.fn<GitHubAccountServices['list']>().mockImplementation(() => new Promise(() => {}))
  deps.list = list
  const account = createGitHubAccountState(deps)
  await account.restore()
  void account.loadRepositories()
  await vi.waitFor(() => expect(list).toHaveBeenCalledOnce())
  account.cancelSignIn()
  expect(list.mock.calls[0][2]?.aborted).toBe(true)
  expect(account.snapshot().busy).toBe(false)
})
