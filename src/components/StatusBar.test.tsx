import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { StatusBar } from './StatusBar'
import type { VaultOption } from './StatusBar'

const vaults: VaultOption[] = [
  { label: 'Main Vault', path: '/Users/luca/Laputa', alias: 'main', mounted: true },
  { label: 'Work Vault', path: '/Users/luca/Work', alias: 'work', mounted: false },
]

const DEFAULT_WINDOW_WIDTH = 1280

function setWindowWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  })
}

function renderDenseStatusBar() {
  return render(
    <StatusBar
      noteCount={100}
      modifiedCount={5}
      vaultPath="/Users/luca/Laputa"
      vaults={vaults}
      onSwitchVault={vi.fn()}
      remoteStatus={{ branch: 'main', ahead: 0, behind: 0, hasRemote: false }}
      onCommitPush={vi.fn()}
      onClickPulse={vi.fn()}
      onOpenFeedback={vi.fn()}
      buildNumber="b281"
      onCheckForUpdates={vi.fn()}
      mcpStatus="not_installed"
    />
  )
}

describe('StatusBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setWindowWidth(DEFAULT_WINDOW_WIDTH)
  })

  it('does not display the bottom-bar note count readout', () => {
    render(<StatusBar noteCount={9200} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} />)
    expect(screen.queryByText('9,200 notes')).not.toBeInTheDocument()
  })

  it('shows the vault reload badge while a reload is active', () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} isVaultReloading />)
    expect(screen.getByTestId('status-vault-reloading')).toHaveAccessibleName('Reloading vault from disk')
  })

  it('displays active vault name', () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} />)
    expect(screen.getByText('Main Vault')).toBeInTheDocument()
  })

  it('shows fallback "Vault" when vault path does not match', () => {
    render(<StatusBar noteCount={100} vaultPath="/unknown/path" vaults={vaults} onSwitchVault={vi.fn()} />)
    expect(screen.getByText('Vault')).toBeInTheDocument()
  })

  it('opens vault menu on click and shows all vault options', () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} />)

    // Click the vault button to open menu
    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))

    expect(screen.getByText('Work Vault')).toBeInTheDocument()
  })

  it('does not show workspace management or mount controls before opt-in', () => {
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        onUpdateWorkspaceIdentity={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))

    expect(screen.queryByTestId('vault-menu-manage-vaults')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('mounts and unmounts workspaces from the vault menu after opt-in', () => {
    const onSwitchVault = vi.fn()
    const onUpdateWorkspaceIdentity = vi.fn()
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        multiWorkspaceEnabled={true}
        onSwitchVault={onSwitchVault}
        onUpdateWorkspaceIdentity={onUpdateWorkspaceIdentity}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Work Vault in the unified graph' }))

    expect(onUpdateWorkspaceIdentity).toHaveBeenCalledWith('/Users/luca/Work', { mounted: true })
    expect(onSwitchVault).not.toHaveBeenCalled()
    expect(screen.getByText('Work Vault')).toBeInTheDocument()
  })

  it('shows the active workspace real mount state so stale unmounted defaults can be repaired', () => {
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={[
          { ...vaults[0], mounted: false },
          vaults[1],
        ]}
        multiWorkspaceEnabled={true}
        onSwitchVault={vi.fn()}
        onUpdateWorkspaceIdentity={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))

    const activeCheckbox = screen.getByRole('checkbox', { name: 'Include Main Vault in the unified graph' })
    expect(activeCheckbox).not.toBeChecked()
    expect(activeCheckbox).not.toBeDisabled()
  })

  it('uses readable bottom-bar typography in the expanded multi-workspace vault picker', () => {
    const onOpenVaultSettings = vi.fn()
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={[
          { ...vaults[0], color: 'purple' },
          { ...vaults[1], color: 'green' },
        ]}
        multiWorkspaceEnabled={true}
        onSwitchVault={vi.fn()}
        onOpenVaultSettings={onOpenVaultSettings}
        onCreateEmptyVault={vi.fn()}
        onUpdateWorkspaceIdentity={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))

    expect(screen.getByTestId('vault-menu-popover')).toHaveStyle({ minWidth: '340px' })
    expect(screen.getByText('Available vaults')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Manage vaults' }))
    expect(onOpenVaultSettings).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    const activeItem = screen.getByTestId('vault-menu-item-Main Vault')
    const defaultLabel = within(activeItem).getByTestId('vault-menu-default-label')
    const activeBadge = within(activeItem).getByTestId('vault-menu-workspace-badge-Main Vault')
    expect(within(activeItem).getByTestId('vault-menu-item-label-Main Vault').className).toContain('text-sm')
    expect(within(activeItem).getByTestId('vault-menu-item-label-Main Vault').getAttribute('style')).toContain('background: transparent')
    expect(defaultLabel).toHaveTextContent('Default')
    expect(activeBadge).toHaveTextContent('MV')
    expect(defaultLabel.compareDocumentPosition(activeBadge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const workBadge = screen.getByTestId('vault-menu-workspace-badge-Work Vault')
    expect(workBadge).toHaveTextContent('WV')
    expect(workBadge.getAttribute('style')).toContain('border-color: var(--accent-green)')

    const createAction = screen.getByTestId('vault-menu-create-empty')
    expect(createAction.className).toContain('text-sm')
    expect(createAction.getAttribute('style')).toContain('color: var(--muted-foreground)')
  })

  it('calls onSwitchVault when selecting a different vault', () => {
    const onSwitchVault = vi.fn()
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={onSwitchVault} />)

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    // Click "Work Vault"
    fireEvent.click(screen.getByText('Work Vault'))

    expect(onSwitchVault).toHaveBeenCalledWith('/Users/luca/Work')
  })

  it('sets the default workspace instead of switching vaults after multi-workspace opt-in', () => {
    const onSetDefaultWorkspace = vi.fn()
    const onSwitchVault = vi.fn()
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        defaultWorkspacePath="/Users/luca/Laputa"
        vaults={vaults}
        multiWorkspaceEnabled={true}
        onSwitchVault={onSwitchVault}
        onSetDefaultWorkspace={onSetDefaultWorkspace}
        onUpdateWorkspaceIdentity={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    fireEvent.click(screen.getByText('Work Vault'))

    expect(onSetDefaultWorkspace).toHaveBeenCalledWith('/Users/luca/Work')
    expect(onSwitchVault).not.toHaveBeenCalled()
  })

  it('unmounts the current default by moving the default to another included workspace first', () => {
    const onSetDefaultWorkspace = vi.fn()
    const onUpdateWorkspaceIdentity = vi.fn()
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        defaultWorkspacePath="/Users/luca/Laputa"
        vaults={[
          { ...vaults[0], mounted: true },
          { ...vaults[1], mounted: true },
        ]}
        multiWorkspaceEnabled={true}
        onSwitchVault={vi.fn()}
        onSetDefaultWorkspace={onSetDefaultWorkspace}
        onUpdateWorkspaceIdentity={onUpdateWorkspaceIdentity}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Main Vault in the unified graph' }))

    expect(onSetDefaultWorkspace).toHaveBeenCalledWith('/Users/luca/Work')
    expect(onUpdateWorkspaceIdentity).toHaveBeenCalledWith('/Users/luca/Laputa', { mounted: false })
  })

  it('closes vault menu when clicking outside', () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    expect(screen.getByText('Work Vault')).toBeInTheDocument()

    // Click outside the menu
    fireEvent.mouseDown(document.body)

    expect(screen.queryByText('Work Vault')).not.toBeInTheDocument()
  })

  it('toggles vault menu open and closed', () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} />)

    const vaultButton = screen.getByRole('button', { name: 'Switch vault' })
    fireEvent.click(vaultButton)
    expect(screen.getByText('Work Vault')).toBeInTheDocument()

    // Click again to close
    fireEvent.click(vaultButton)
    expect(screen.queryByText('Work Vault')).not.toBeInTheDocument()
  })

  it('shows "Open local folder" option in vault menu', () => {
    render(
      <StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} onOpenLocalFolder={vi.fn()} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    expect(screen.getByText('Open local folder')).toBeInTheDocument()
  })

  it('calls onOpenLocalFolder when clicking "Open local folder"', () => {
    const onOpenLocalFolder = vi.fn()
    render(
      <StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} onOpenLocalFolder={onOpenLocalFolder} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    fireEvent.click(screen.getByText('Open local folder'))
    expect(onOpenLocalFolder).toHaveBeenCalledOnce()
  })

  it('shows "Create empty vault" option in vault menu', () => {
    render(
      <StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} onCreateEmptyVault={vi.fn()} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    expect(screen.getByText('Create empty vault')).toBeInTheDocument()
  })

  it('calls onCreateEmptyVault when clicking "Create empty vault"', () => {
    const onCreateEmptyVault = vi.fn()
    render(
      <StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} onCreateEmptyVault={onCreateEmptyVault} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    fireEvent.click(screen.getByText('Create empty vault'))
    expect(onCreateEmptyVault).toHaveBeenCalledOnce()
  })

  it('shows add-vault options in vault menu', () => {
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        onCreateEmptyVault={vi.fn()}
        onOpenLocalFolder={vi.fn()}
        onCloneVault={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    expect(screen.getByText('Create empty vault')).toBeInTheDocument()
    expect(screen.getByText('Open local folder')).toBeInTheDocument()
    expect(screen.getByText('Clone Git repo')).toBeInTheDocument()
  })

  it('shows the Getting Started clone action in the vault menu when provided', () => {
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        onCloneGettingStarted={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    expect(screen.getByText('Clone Getting Started Vault')).toBeInTheDocument()
  })

  it('calls onCloneGettingStarted when clicking the vault menu action', () => {
    const onCloneGettingStarted = vi.fn()
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        onCloneGettingStarted={onCloneGettingStarted}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    fireEvent.click(screen.getByText('Clone Getting Started Vault'))
    expect(onCloneGettingStarted).toHaveBeenCalledOnce()
  })

  it('keeps the hover-revealed remove action at the far right of each removable vault', () => {
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        onRemoveVault={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))

    const item = screen.getByTestId('vault-menu-item-Work Vault')
    const removeAction = screen.getByTestId('vault-menu-remove-Work Vault')
    const openAction = screen.getByRole('button', { name: 'Open Work Vault in a new window' })

    expect(item.className).toContain('hover:bg-[var(--hover)]')
    expect(openAction.compareDocumentPosition(removeAction) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(item.lastElementChild).toBe(removeAction)
    expect(removeAction.className).not.toContain('absolute')
    expect(removeAction.className).not.toContain('right-1')
    expect(removeAction.className).toContain('group-hover:opacity-100')
    expect(removeAction.className).toContain('group-focus-within:opacity-100')
    expect(removeAction.className).toContain('pointer-events-none')
    expect(screen.getByRole('button', { name: 'Remove Work Vault from list' })).toBeInTheDocument()
  })

  it('opens a vault in a separate app window with its configured accent color', async () => {
    const openVaultWindow = vi.fn()
    window.__mockHandlers = {
      ...window.__mockHandlers,
      open_vault_in_new_window: openVaultWindow,
    }
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={[
          vaults[0],
          { ...vaults[1], color: 'red' },
        ]}
        onSwitchVault={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Work Vault in a new window' }))

    await vi.waitFor(() => {
      expect(openVaultWindow).toHaveBeenCalledWith({
        vaultPath: '/Users/luca/Work',
        vaultColor: 'red',
      })
    })
  })

  it('confirms before removing a vault from the vault menu', () => {
    const onRemoveVault = vi.fn()
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        onRemoveVault={onRemoveVault}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Work Vault from list' }))

    expect(onRemoveVault).not.toHaveBeenCalled()
    expect(screen.getByTestId('confirm-delete-dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove vault' }))

    expect(onRemoveVault).toHaveBeenCalledWith('/Users/luca/Work')
  })

  it('hides Git changes even when modifiedCount is positive', () => {
    render(<StatusBar noteCount={100} modifiedCount={3} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} />)
    expect(screen.queryByTestId('status-modified-count')).not.toBeInTheDocument()
  })

  it('keeps the bottom bar compact and unwrapped at medium widths', () => {
    setWindowWidth(980)
    renderDenseStatusBar()

    expect(screen.getByTestId('status-bar')).toHaveStyle({
      flexWrap: 'nowrap',
      minHeight: '30px',
      height: 'auto',
    })
    expect(screen.getByRole('button', { name: 'Switch vault' })).toBeInTheDocument()
    expect(screen.queryByTestId('status-commit-push')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-pulse')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-feedback')).not.toBeInTheDocument()
    expect(screen.queryByText('Commit')).not.toBeInTheDocument()
    expect(screen.queryByText('History')).not.toBeInTheDocument()
    expect(screen.queryByText('Contribute')).not.toBeInTheDocument()
  })

  it('keeps developer and promotional controls hidden at very narrow widths', () => {
    setWindowWidth(920)
    renderDenseStatusBar()

    expect(screen.getByTestId('status-bar')).toHaveStyle({
      flexWrap: 'nowrap',
      minHeight: '30px',
      height: 'auto',
    })
    expect(screen.getByRole('button', { name: 'Switch vault' })).toBeInTheDocument()
    expect(screen.queryByTestId('status-commit-push')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-pulse')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-feedback')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-build-number')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-claude-code')).not.toBeInTheDocument()
    expect(screen.queryByText('Commit')).not.toBeInTheDocument()
    expect(screen.queryByText('History')).not.toBeInTheDocument()
    expect(screen.queryByText('Contribute')).not.toBeInTheDocument()
    expect(screen.queryByText('No remote')).not.toBeInTheDocument()
    expect(screen.queryByText('MCP')).not.toBeInTheDocument()
    expect(screen.queryByText('b281')).not.toBeInTheDocument()
    expect(screen.queryByText('Claude Code missing')).not.toBeInTheDocument()
  })

  it('keeps the quiet footer on one compact row at narrow widths', () => {
    setWindowWidth(900)
    renderDenseStatusBar()

    expect(screen.getByTestId('status-bar')).toHaveStyle({
      flexWrap: 'nowrap',
      minHeight: '30px',
      height: 'auto',
    })
    expect(screen.getByRole('button', { name: 'Switch vault' })).toBeInTheDocument()
    expect(screen.queryByTestId('status-commit-push')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-pulse')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-feedback')).not.toBeInTheDocument()
  })

  it('does not render the legacy AI agent control in the status bar', () => {
    setWindowWidth(920)
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
      />
    )

    expect(screen.queryByTestId('status-ai-agents')).not.toBeInTheDocument()
    expect(screen.queryByText('Claude')).not.toBeInTheDocument()
  })

  it('does not show Changes badge when modifiedCount is 0', () => {
    render(<StatusBar noteCount={100} modifiedCount={0} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} />)
    expect(screen.queryByTestId('status-modified-count')).not.toBeInTheDocument()
  })

  it('does not show Changes badge when modifiedCount is not provided', () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} />)
    expect(screen.queryByTestId('status-modified-count')).not.toBeInTheDocument()
  })

  it('closes menu after clicking "Open local folder"', () => {
    render(
      <StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} onOpenLocalFolder={vi.fn()} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Switch vault' }))
    fireEvent.click(screen.getByText('Open local folder'))
    // Menu should close after clicking an action
    expect(screen.queryByText('Open local folder')).not.toBeInTheDocument()
  })

  it('hides the external AI setup badge even when MCP is not installed', () => {
    render(
      <StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} mcpStatus="not_installed" />
    )
    expect(screen.queryByTestId('status-mcp')).not.toBeInTheDocument()
  })

  it('hides MCP badge when status is installed', () => {
    render(
      <StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} mcpStatus="installed" />
    )
    expect(screen.queryByTestId('status-mcp')).not.toBeInTheDocument()
  })

  it('hides MCP badge when status is checking', () => {
    render(
      <StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} mcpStatus="checking" />
    )
    expect(screen.queryByTestId('status-mcp')).not.toBeInTheDocument()
  })

  it('hides MCP badge when no mcpStatus prop provided', () => {
    render(
      <StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} />
    )
    expect(screen.queryByTestId('status-mcp')).not.toBeInTheDocument()
  })

  it('hides MCP badge when AI features are disabled', () => {
    render(
      <StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} aiFeaturesEnabled={false} mcpStatus="not_installed" />
    )
    expect(screen.queryByTestId('status-mcp')).not.toBeInTheDocument()
  })

  it('does not expose the Git pull action in the quiet footer', () => {
    render(
      <StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} syncStatus="pull_required" />
    )
    expect(screen.queryByTestId('status-sync')).not.toBeInTheDocument()
  })

  it('shows an offline chip when offline', () => {
    render(
      <StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} isOffline={true} />
    )
    expect(screen.getByTestId('status-offline')).toHaveTextContent('Offline')
  })

  it('does not expose Git remote configuration in the quiet footer', () => {
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        remoteStatus={{ branch: 'main', ahead: 0, behind: 0, hasRemote: false }}
      />
    )
    expect(screen.queryByTestId('status-no-remote')).not.toBeInTheDocument()
  })

  it('hides Git sync controls when multiple vaults are active', () => {
    render(
      <StatusBar
        noteCount={100}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        multiWorkspaceEnabled={true}
        onSwitchVault={vi.fn()}
        repositories={[
          { path: '/Users/luca/Laputa', label: 'Main Vault', defaultForNewNotes: true },
          { path: '/Users/luca/Work', label: 'Work Vault', defaultForNewNotes: false },
        ]}
        selectedRepositoryPath="/Users/luca/Work"
        onRepositoryChange={vi.fn()}
        syncStatus="idle"
        remoteStatus={{ branch: 'main', ahead: 0, behind: 0, hasRemote: true }}
      />
    )

    expect(screen.queryByTestId('status-sync')).not.toBeInTheDocument()
    expect(screen.queryByTestId('git-status-repository-select')).not.toBeInTheDocument()
  })

  it('hides Git history in the quiet footer', () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} isGitVault />)
    expect(screen.queryByTestId('status-pulse')).not.toBeInTheDocument()
  })

  it('hides Git controls and warnings when isGitVault is false', () => {
    render(
      <StatusBar
        noteCount={100}
        modifiedCount={5}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        isGitVault={false}
        onClickPulse={vi.fn()}
        onCommitPush={vi.fn()}
      />
    )

    expect(screen.queryByTestId('status-missing-git')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-pulse')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-commit-push')).not.toBeInTheDocument()
  })

  it('hides all git controls when Git features are disabled globally', () => {
    render(
      <StatusBar
        noteCount={100}
        modifiedCount={5}
        vaultPath="/Users/luca/Laputa"
        vaults={vaults}
        onSwitchVault={vi.fn()}
        gitFeaturesEnabled={false}
        isGitVault={false}
        onInitializeGit={vi.fn()}
        onClickPulse={vi.fn()}
        onCommitPush={vi.fn()}
      />
    )

    expect(screen.queryByTestId('status-missing-git')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-pulse')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-commit-push')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-changes')).not.toBeInTheDocument()
  })

  it('hides Commit even when a callback is supplied', () => {
    render(<StatusBar noteCount={100} modifiedCount={0} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} onCommitPush={vi.fn()} />)
    expect(screen.queryByTestId('status-commit-push')).not.toBeInTheDocument()
  })

  it('hides Commit button when no onCommitPush callback', () => {
    render(<StatusBar noteCount={100} modifiedCount={5} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} />)
    expect(screen.queryByTestId('status-commit-push')).not.toBeInTheDocument()
  })

  it('does not render the legacy Claude Code badge in the status bar', () => {
    render(<StatusBar noteCount={100} vaultPath="/Users/luca/Laputa" vaults={vaults} onSwitchVault={vi.fn()} />)
    expect(screen.queryByTestId('status-claude-code')).not.toBeInTheDocument()
  })

})
