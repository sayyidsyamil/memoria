import type { GitHubDeviceCode, GitHubRepository, GitHubSession } from './githubAuth'
import { githubFailure } from './githubFailure'

export type GitHubAccountServices = {
  restore: () => Promise<GitHubSession | null>
  save: (session: GitHubSession) => Promise<void>
  clear: () => Promise<void>
  begin: (signal: AbortSignal) => Promise<GitHubDeviceCode>
  finish: (code: GitHubDeviceCode, signal: AbortSignal) => Promise<GitHubSession>
  refresh: (session: GitHubSession, signal?: AbortSignal) => Promise<GitHubSession>
  list: (session: GitHubSession, page: number, signal: AbortSignal) => Promise<GitHubRepository[]>
}

type AccountSnapshot = {
  session: GitHubSession | null
  code: GitHubDeviceCode | null
  repositories: GitHubRepository[]
  busy: boolean
  hasMore: boolean
  error: ReturnType<typeof githubFailure> | null
}

export function createGitHubAccountState(services: GitHubAccountServices) { return new GitHubAccountState(services) }

class GitHubAccountState {
  private state: AccountSnapshot = { session: null, code: null, repositories: [], busy: false, hasMore: false, error: null }
  private listeners = new Set<() => void>()
  private generation = 0
  private page = 1
  private request: AbortController | null = null
  private writes: Promise<void> = Promise.resolve()
  private refreshing: Promise<GitHubSession | null> | null = null
  private signingOut = false

  constructor(private services: GitHubAccountServices) {}
  snapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }

  private update(patch: Partial<AccountSnapshot>) {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  private persist(operation: () => Promise<void>) {
    const result = this.writes.then(operation).catch(() => { throw new Error('githubCredentialStoreFailed') })
    this.writes = result.catch(() => {})
    return result
  }

  async restore() {
    const generation = this.generation
    try {
      const session = await this.services.restore()
      if (generation === this.generation) this.update({ session })
    } catch {
      if (generation === this.generation) this.update({ error: 'mobile.vaults.credentialFailed' })
    }
  }

  cancelSignIn = () => {
    if (this.signingOut) return
    this.generation += 1
    this.request?.abort()
    this.request = null
    this.update({ busy: false, code: null })
  }

  signIn = async () => {
    if (this.state.busy) return
    this.cancelSignIn()
    const generation = this.generation
    const request = new AbortController()
    this.request = request
    this.update({ busy: true, error: null })
    try {
      const code = await this.services.begin(request.signal)
      if (generation !== this.generation) return
      this.update({ code })
      const session = await this.services.finish(code, request.signal)
      if (generation !== this.generation) return
      await this.persist(() => this.services.save(session))
      if (generation === this.generation) this.update({ session, repositories: [], hasMore: false })
    } catch (error) {
      if (generation === this.generation) this.update({ error: githubFailure(error) })
    } finally {
      if (generation === this.generation) this.update({ busy: false, code: null })
    }
  }

  signOut = async () => {
    if (this.signingOut) return
    this.cancelSignIn()
    this.signingOut = true
    const generation = this.generation
    this.update({ busy: true, error: null })
    try {
      await this.persist(this.services.clear)
      if (generation === this.generation) this.update({ session: null, repositories: [], hasMore: false })
    }
    catch (error) { if (generation === this.generation) this.update({ error: githubFailure(error) }) }
    finally {
      this.signingOut = false
      if (generation === this.generation) this.update({ busy: false })
    }
  }

  currentSession = () => {
    if (this.signingOut) return Promise.resolve(null)
    if (!this.refreshing) this.refreshing = this.refreshSession().finally(() => { this.refreshing = null })
    return this.refreshing
  }

  private async refreshSession() {
    const { session } = this.state
    if (!session) return null
    const generation = this.generation
    const next = await this.services.refresh(session, this.request?.signal)
    if (generation !== this.generation) throw new Error('cancelled')
    if (next !== session) {
      await this.persist(() => this.services.save(next))
      if (generation !== this.generation) throw new Error('cancelled')
      this.update({ session: next })
    }
    return next
  }

  loadRepositories = async (more = false) => {
    if (this.state.busy) return
    const generation = ++this.generation
    const request = new AbortController()
    this.request = request
    this.update({ busy: true, error: null })
    try {
      const session = await this.currentSession()
      if (!session) return
      const page = more ? this.page + 1 : 1
      const repositories = await this.services.list(session, page, request.signal)
      if (generation !== this.generation) return
      this.publishRepositories(repositories, page, more)
    } catch (error) {
      if (generation === this.generation) this.update({ error: githubFailure(error) })
    } finally {
      if (generation === this.generation) this.update({ busy: false })
    }
  }

  private publishRepositories(repositories: GitHubRepository[], page: number, more: boolean) {
    this.page = page
    this.update({ repositories: more ? [...this.state.repositories, ...repositories] : repositories, hasMore: repositories.length === 100 })
  }
}
