import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { StatusBar } from './StatusBar'
import { UpdateBanner } from './UpdateBanner'
import { FeedbackDialog } from './FeedbackDialog'
import { TooltipProvider } from './ui/tooltip'

describe('Memoria quiet workspace', () => {
  it('keeps workspace and settings accessible without developer or promotional controls', () => {
    const openSettings = vi.fn()
    render(<StatusBar noteCount={12} vaultPath="/tmp/meeting" vaults={[{ label: 'Meeting', path: '/tmp/meeting' }]}
      onSwitchVault={vi.fn()} onOpenSettings={openSettings} onOpenFeedback={vi.fn()} onOpenDocs={vi.fn()}
      onClickPulse={vi.fn()} onCommitPush={vi.fn()} buildNumber="0.1.0" mcpStatus="not_installed" />)
    fireEvent.click(screen.getByTestId('status-settings'))
    expect(openSettings).toHaveBeenCalledOnce()
    for (const id of ['status-build-number', 'status-discord', 'status-feedback', 'status-docs', 'status-theme-mode']) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument()
    }
  })

  it('does not show community promotions while idle', () => {
    render(<UpdateBanner status={{ state: 'idle' }} actions={{ checkForUpdates: vi.fn(), startDownload: vi.fn(), openReleaseNotes: vi.fn(), dismiss: vi.fn() }} />)
    expect(screen.queryByTestId('community-banner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('update-banner')).not.toBeInTheDocument()
  })

  it('retains upstream attribution instead of sponsorship and newsletter prompts', () => {
    render(<TooltipProvider><FeedbackDialog open onClose={vi.fn()} /></TooltipProvider>)
    expect(screen.getByRole('link', { name: /upstream source/i })).toHaveAttribute('href', 'https://github.com/refactoringhq/tolaria')
    expect(screen.getByText(/AGPL-3.0-or-later/)).toBeInTheDocument()
    expect(screen.queryByText(/newsletter/i)).not.toBeInTheDocument()
  })
})
