// @vitest-environment jsdom
import { act, createElement, useContext, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MobileVaultProvider } from './MobileVaultProvider'
import { NativeWorkspaceContext } from './NativeWorkspaceContext'

const state = vi.hoisted(() => ({ failed: false, busy: false, pending: false, retry: vi.fn(), catalogRetry: vi.fn() }))
vi.mock('./git/useMobileVaults', () => ({ useMobileVaults: () => ({
  active: { selection: { vaultRootUri: 'file:///owned' }, git: null },
  refreshFailed: state.failed, retryWorkspace: state.retry, busy: state.busy, revision: 0,
  restorePending: state.pending,
  catalog: { pending: false, error: null, retry: state.catalogRetry, vaults: [], localVaults: [] },
  syncHistory: { record: {}, ready: true }, notices: {},
}) }))
vi.mock('../settings/useMobileSettings', () => ({ useMobileSettings: () => ({ open: vi.fn() }) }))
vi.mock('../settings/MobileSettingsSheet', () => ({ MobileSettingsSheet: () => null }))
vi.mock('../components/vaults/MobileVaultNotice', () => ({ MobileVaultNotice: () => null }))
vi.mock('./WorkspaceLoadBoundary', () => ({ WorkspaceLoadBoundary: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('../components/workspace/MobileWorkspaceStartup', () => ({ MobileWorkspaceStartup: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('../components/vaults/MobileWorkspaceLoadFailure', () => ({
  MobileWorkspaceLoadFailure: ({ onRetry }: { onRetry: () => void }) => createElement('button', { type: 'button', onClick: onRetry }, 'Retry'),
}))
let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
  state.failed = false
  state.busy = false
  state.pending = false
  container = document.createElement('div')
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  vi.unstubAllGlobals()
})

it('keeps an active workspace visible during preparation failure and retry', async () => {
  await render()
  expect(container.textContent).toBe('Fresh workspace')
  state.failed = true
  await render()
  expect(container.textContent).toBe('Fresh workspace')
  expect(state.retry).not.toHaveBeenCalled()
  expect(state.catalogRetry).not.toHaveBeenCalled()
  state.busy = true
  await render()
  expect(container.textContent).toBe('Fresh workspace')
  state.failed = false
  await render()
  expect(container.textContent).toBe('Fresh workspace')
})

it('never renders the full-screen reload state or remounts an existing editor on pending lifecycle changes', async () => {
  let mounts = 0
  function Workspace() {
    const workspace = useContext(NativeWorkspaceContext)
    useEffect(() => { mounts++ }, [])
    return workspace.restorePending ? createElement('div', { 'data-testid': 'dev-vault-status' }, 'Reloading vault from disk')
      : createElement('textarea', { defaultValue: 'Retained draft' })
  }
  const child = createElement(Workspace)
  await act(async () => root.render(createElement(MobileVaultProvider, null, child)))
  for (const lifecycle of ['startup', 'foreground', 'post-sync', 'vault-switch']) {
    state.pending = true
    await act(async () => root.render(createElement(MobileVaultProvider, null, child)))
    expect(container.querySelector('[data-testid="dev-vault-status"]'), lifecycle).toBeNull()
    expect(container.querySelector('textarea')?.value).toBe('Retained draft')
    state.pending = false
    await act(async () => root.render(createElement(MobileVaultProvider, null, child)))
  }
  expect(mounts).toBe(1)
})

async function render() {
  await act(async () => root.render(createElement(MobileVaultProvider, null, 'Fresh workspace')))
}
