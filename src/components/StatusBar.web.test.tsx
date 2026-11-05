import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBar, type VaultOption } from './StatusBar'

const vaults: VaultOption[] = [{ label: 'Vault', path: '/vault', alias: 'vault', mounted: true }]

function setWindowWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
}

describe('StatusBar on the web', () => {
  beforeEach(() => setWindowWidth(1280))
  afterEach(() => vi.unstubAllGlobals())

  function renderStatusBar(props: { web?: boolean; isOffline?: boolean; isVaultReloading?: boolean } = {}) {
    if (props.web !== false) {
      vi.stubGlobal('MEMORIA_REMOTE_URL', 'https://example.com')
      vi.stubGlobal('MEMORIA_REMOTE_TOKEN', 'token')
    }
    return render(
      <StatusBar
        noteCount={3}
        modifiedCount={2}
        vaultPath="/vault"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        onCommitPush={vi.fn()}
        isOffline={props.isOffline}
        isVaultReloading={props.isVaultReloading}
      />,
    )
  }

  it('replaces the git controls with the sync pill', () => {
    renderStatusBar()

    expect(screen.getByTestId('status-sync-pill')).toHaveAttribute('data-state', 'synced')
    expect(screen.queryByTestId('status-commit-push')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-modified-count')).not.toBeInTheDocument()
  })

  it('spins the pill, not a reloading badge, during a background reload', () => {
    renderStatusBar({ isVaultReloading: true })

    expect(screen.getByTestId('status-sync-pill')).toHaveAttribute('data-state', 'syncing')
    expect(screen.queryByTestId('status-vault-reloading')).not.toBeInTheDocument()
    expect(screen.getByTestId('status-bar').querySelectorAll('.animate-spin')).toHaveLength(1)
  })

  it('shows offline in the pill instead of the offline badge', () => {
    renderStatusBar({ isOffline: true })

    expect(screen.getByTestId('status-sync-pill')).toHaveAttribute('data-state', 'offline')
    expect(screen.queryByTestId('status-offline')).not.toBeInTheDocument()
  })

  it('keeps the quiet desktop footer without a remote server', () => {
    renderStatusBar({ web: false })

    expect(screen.queryByTestId('status-sync-pill')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-commit-push')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch vault' })).toBeInTheDocument()
  })
})
