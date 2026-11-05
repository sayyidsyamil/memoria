import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { WelcomeScreen } from './WelcomeScreen'
import memoriaIcon from '@/assets/memoria-icon.svg'

const dragRegionMouseDown = vi.fn()

vi.mock('../hooks/useDragRegion', () => ({
  useDragRegion: () => ({ onMouseDown: dragRegionMouseDown }),
}))

const defaultProps = {
  mode: 'welcome' as const,
  defaultVaultPath: '~/Documents/Laputa',
  onCreateEmptyVault: vi.fn(),
  onOpenFolder: vi.fn(),
  creatingAction: null as 'template' | 'empty' | null,
  error: null,
}

describe('WelcomeScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('welcome mode', () => {
    it('says what Memoria does in one line', () => {
      render(<WelcomeScreen {...defaultProps} />)
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Memoria$/)
      expect(screen.getByText('Remembers what your meetings decided, with the words that prove it. Everything stays on this Mac.')).toBeInTheDocument()
      expect(screen.queryByText(/Markdown knowledge management/)).not.toBeInTheDocument()
    })

    it('renders the local Memoria branding icon', () => {
      render(<WelcomeScreen {...defaultProps} />)

      const brandIcon = screen.getByAltText('Memoria icon')
      expect(brandIcon).toHaveAttribute('src', memoriaIcon)
    })

    it('offers two actions: open a workspace, then create one', () => {
      render(<WelcomeScreen {...defaultProps} />)

      const optionButtons = screen.getAllByRole('button')
      expect(optionButtons).toHaveLength(2)
      expect(optionButtons[0]).toBe(screen.getByTestId('welcome-open-folder'))
      expect(optionButtons[0]).toHaveTextContent('Open a workspace')
      expect(optionButtons[1]).toBe(screen.getByTestId('welcome-create-new'))
      expect(optionButtons[1]).toHaveTextContent('Create a workspace')
    })

    it('downloads nothing and links nowhere at first run', () => {
      render(<WelcomeScreen {...defaultProps} />)
      expect(screen.queryByTestId('welcome-create-vault')).not.toBeInTheDocument()
      expect(screen.queryByTestId('welcome-docs-link')).not.toBeInTheDocument()
      expect(screen.queryByText(/template|Getting Started|Download|internet/i)).not.toBeInTheDocument()
    })

    it('focuses the first action for keyboard users', () => {
      render(<WelcomeScreen {...defaultProps} />)
      expect(screen.getByTestId('welcome-open-folder')).toHaveFocus()
    })

    it('calls onCreateEmptyVault when create button is clicked', () => {
      const onCreateEmptyVault = vi.fn()
      render(<WelcomeScreen {...defaultProps} onCreateEmptyVault={onCreateEmptyVault} />)
      fireEvent.click(screen.getByTestId('welcome-create-new'))
      expect(onCreateEmptyVault).toHaveBeenCalledOnce()
    })

    it('calls onCreateEmptyVault when create button is activated with Enter', () => {
      const onCreateEmptyVault = vi.fn()
      render(<WelcomeScreen {...defaultProps} onCreateEmptyVault={onCreateEmptyVault} />)
      const button = screen.getByTestId('welcome-create-new')

      button.focus()
      fireEvent.keyDown(button, { key: 'Enter' })

      expect(onCreateEmptyVault).toHaveBeenCalledOnce()
    })

    it('calls onCreateEmptyVault when create button is activated with Space', () => {
      const onCreateEmptyVault = vi.fn()
      render(<WelcomeScreen {...defaultProps} onCreateEmptyVault={onCreateEmptyVault} />)
      const button = screen.getByTestId('welcome-create-new')

      button.focus()
      fireEvent.keyDown(button, { key: ' ' })

      expect(onCreateEmptyVault).toHaveBeenCalledOnce()
    })

    it('calls onOpenFolder when open folder button is clicked', () => {
      const onOpenFolder = vi.fn()
      render(<WelcomeScreen {...defaultProps} onOpenFolder={onOpenFolder} />)
      fireEvent.click(screen.getByTestId('welcome-open-folder'))
      expect(onOpenFolder).toHaveBeenCalledOnce()
    })

    it('cycles the actions with Tab and arrows, and activates the selected action with Enter', () => {
      const onCreateEmptyVault = vi.fn()
      const onOpenFolder = vi.fn()
      render(<WelcomeScreen {...defaultProps} onCreateEmptyVault={onCreateEmptyVault} onOpenFolder={onOpenFolder} />)

      fireEvent.keyDown(window, { key: 'Tab' })
      fireEvent.keyDown(window, { key: 'Enter' })
      expect(onCreateEmptyVault).toHaveBeenCalledOnce()

      fireEvent.keyDown(window, { key: 'ArrowDown' })
      expect(screen.getByTestId('welcome-open-folder')).toHaveFocus()
      fireEvent.keyDown(window, { key: 'Enter' })
      expect(onOpenFolder).toHaveBeenCalledOnce()
    })

    it('disables both actions while creating', () => {
      render(<WelcomeScreen {...defaultProps} creatingAction="empty" />)
      expect(screen.getByTestId('welcome-create-new')).toBeDisabled()
      expect(screen.getByTestId('welcome-open-folder')).toBeDisabled()
    })

    it('shows loading text on the create button while creating a workspace', () => {
      render(<WelcomeScreen {...defaultProps} creatingAction="empty" />)
      expect(screen.getByTestId('welcome-create-new')).toHaveTextContent(/Creating workspace/)
    })

    it('shows error message when error is set', () => {
      render(<WelcomeScreen {...defaultProps} error="Permission denied" />)
      expect(screen.getByTestId('welcome-error')).toHaveTextContent('Permission denied')
      expect(screen.getByTestId('welcome-error')).toHaveAttribute('aria-live', 'assertive')
    })

    it('does not show error when error is null', () => {
      render(<WelcomeScreen {...defaultProps} />)
      expect(screen.queryByTestId('welcome-error')).not.toBeInTheDocument()
    })

    it('does not show path badge in welcome mode', () => {
      render(<WelcomeScreen {...defaultProps} />)
      expect(screen.queryByText('~/Laputa')).not.toBeInTheDocument()
    })
  })

  describe('vault-missing mode', () => {
    const missingProps = {
      ...defaultProps,
      mode: 'vault-missing' as const,
      missingPath: '~/Laputa',
    }

    it('keeps the missing-workspace state framed as welcome', () => {
      render(<WelcomeScreen {...missingProps} />)
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Memoria$/)
      expect(screen.getByText(/folder you used before may have moved or been deleted/)).toBeInTheDocument()
    })

    it('does not show the missing vault path in a badge', () => {
      render(<WelcomeScreen {...missingProps} />)
      expect(screen.queryByText('~/Laputa')).not.toBeInTheDocument()
    })

    it('offers to open a workspace in the friendly recovery state', () => {
      render(<WelcomeScreen {...missingProps} />)
      expect(screen.getByTestId('welcome-open-folder')).toHaveTextContent('Open a workspace')
    })
  })

  describe('data-testid', () => {
    it('has welcome-screen container testid', () => {
      render(<WelcomeScreen {...defaultProps} />)
      expect(screen.getByTestId('welcome-screen')).toBeInTheDocument()
    })

    it('uses the surrounding surface as a drag region and excludes the card', () => {
      render(<WelcomeScreen {...defaultProps} />)

      const screenContainer = screen.getByTestId('welcome-screen')
      fireEvent.mouseDown(screenContainer)

      expect(dragRegionMouseDown).toHaveBeenCalledOnce()
      expect(screenContainer.querySelector('[data-no-drag]')).not.toBeNull()
    })
  })
})
