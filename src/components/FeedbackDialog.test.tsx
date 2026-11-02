import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { APP_COMMAND_EVENT_NAME, APP_COMMAND_IDS } from '../hooks/appCommandDispatcher'
import { rememberFeedbackDialogOpener } from '../lib/feedbackDialogOpener'
import { FeedbackDialog } from './FeedbackDialog'
import { TooltipProvider } from './ui/tooltip'

function render(ui: Parameters<typeof rtlRender>[0]) {
  return rtlRender(ui, { wrapper: TooltipProvider })
}

describe('FeedbackDialog', () => {
  it('renders Memoria identity, build and upstream licensing without contribution promotions', () => {
    render(<FeedbackDialog open onClose={vi.fn()} buildNumber="b281" />)
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Memoria')
    expect(screen.getByText('b281')).toBeInTheDocument()
    expect(screen.getByText(/FYP2.*Sayyid Syamil.*Universiti Malaya/)).toBeInTheDocument()
    expect(screen.getByText(/Based on Tolaria by Luca Rossi/)).toHaveTextContent('AGPL-3.0-or-later')
    expect(screen.getByRole('link', { name: /upstream source/ })).toHaveAttribute('href', 'https://github.com/refactoringhq/tolaria')
    expect(screen.queryByText(/newsletter|sponsors|product board|copy diagnostics/i)).not.toBeInTheDocument()
  })

  it('does not render a dialog while closed', () => {
    render(<FeedbackDialog open={false} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('focuses the Close control when opened without a primary CTA', async () => {
    render(<FeedbackDialog open onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus())
  })

  it('closes with Escape and the top-right Close control', () => {
    const onClose = vi.fn()
    render(<FeedbackDialog open onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    onClose.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('reopens the command palette after closing when launched from it', () => {
    vi.useFakeTimers()
    const opener = document.createElement('input')
    opener.setAttribute('placeholder', 'Type a command...')
    document.body.appendChild(opener)
    rememberFeedbackDialogOpener(opener)
    const onClose = vi.fn()
    const handleReopen = vi.fn()
    window.addEventListener(APP_COMMAND_EVENT_NAME, handleReopen)
    try {
      render(<FeedbackDialog open onClose={onClose} />)
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      vi.advanceTimersByTime(100)
      expect(onClose).toHaveBeenCalledOnce()
      expect(handleReopen).toHaveBeenCalledTimes(1)
      expect(handleReopen.mock.calls[0]?.[0]).toMatchObject({ detail: APP_COMMAND_IDS.viewCommandPalette })
    } finally {
      window.removeEventListener(APP_COMMAND_EVENT_NAME, handleReopen)
      opener.remove()
      vi.useRealTimers()
    }
  })

  it('restores focus to a connected opener after closing', () => {
    vi.useFakeTimers()
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    rememberFeedbackDialogOpener(opener)
    try {
      const onClose = vi.fn()
      const view = render(<FeedbackDialog open onClose={onClose} />)
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      expect(onClose).toHaveBeenCalledOnce()
      view.rerender(<FeedbackDialog open={false} onClose={onClose} />)
      vi.advanceTimersByTime(100)
      expect(opener).toHaveFocus()
    } finally {
      opener.remove()
      vi.useRealTimers()
    }
  })
})
